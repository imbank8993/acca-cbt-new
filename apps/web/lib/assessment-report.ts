/**
 * Perhitungan Laporan Analisis Hasil (PDF tab Hasil): statistik kelas, reliabilitas,
 * analisis butir & pengecoh, penguasaan materi, dan laporan per peserta.
 *
 * Murni (tanpa DOM) agar dapat diuji. Dasar rumus dan batas: docs/laporan-analisis-hasil-pdf-2026-11-16.md.
 */
import { classicalDifficulty, hasThetaIrtScale, irtScaledScore, isAcademicTopicQuestion, questionTopic, type ItemDifficultyCategory } from '@acca-cbt/shared';

export const FINISHED_STATUSES = ['submitted', 'auto_submitted'];
/** Batas kelompok atas/bawah (Kelley 1939). */
export const EXTREME_GROUP_SHARE = 0.27;
export const MIN_STABLE_PARTICIPANTS = 10;
/** Butir yang sebagian besar kelas jawab benar; bila siswa salah, layak dicek ulang. */
export const EASY_ITEM_P = 0.75;
const UNTOPICAL = 'Tanpa materi';

export interface ReportQuestion {
    id: string;
    number?: number;
    type: string;
    question_text?: string;
    score_default?: number | null;
    topic?: string | null;
    metadata?: unknown;
    options?: Array<{ id?: string; option_text?: string | null; text?: string | null; is_correct?: boolean | null }>;
}
export interface ReportCell { score?: number | null; status: 'correct' | 'wrong' | 'ungraded' | 'unanswered'; display_answer?: string }
export interface ReportMatrixRow {
    attempt_id: string;
    student_name: string;
    student_nis?: string;
    class_name?: string;
    status: string;
    items: Record<string, ReportCell | undefined>;
}
export interface ReportAttempt {
    id: string;
    status: string;
    total_score?: number | null;
    score_irt?: number | null;
    detailed_scores?: Record<string, number | null | undefined> | null;
    metadata?: Record<string, unknown> | null;
    needs_manual_grading?: boolean;
}
export interface ReportAnswer { attempt_id?: string; question_id: string; selected_option_id?: string | null }
export interface ReportIrtItem { question_id: string; b: number; a: number; c: number }
export interface ReportIrt { models: string[]; items: ReportIrtItem[]; participant_count?: number }

export interface AssessmentReportInput {
    questions: ReportQuestion[];
    matrix: ReportMatrixRow[];
    attempts: ReportAttempt[];
    answers?: ReportAnswer[];
    irt?: ReportIrt | null;
    scoringType?: string | null;
    /** Kunci tampilan per soal (dari analisis rinci). */
    keyDisplay?: Record<string, string>;
}

export type MasteryBand = 'bimbingan' | 'remedial' | 'tuntas' | 'pengayaan';
export const MASTERY_BANDS: Array<{ id: MasteryBand; label: string; min: number; max: number; advice: string }> = [
    { id: 'bimbingan', label: 'Perlu bimbingan', min: 0, max: 40, advice: 'Remedial menyeluruh dengan pendampingan.' },
    { id: 'remedial', label: 'Remedial sebagian', min: 40, max: 65, advice: 'Remedial pada bagian yang belum dikuasai.' },
    { id: 'tuntas', label: 'Tuntas', min: 65, max: 85, advice: 'Penguatan pada bagian yang masih lemah.' },
    { id: 'pengayaan', label: 'Pengayaan', min: 85, max: 100, advice: 'Pengayaan / tantangan berpikir tingkat tinggi.' },
];
/** Interval KKTP: 0–40, 41–65, 66–85, 86–100 (nilai kontinu: batas atas inklusif). */
export function masteryBand(score: number | null | undefined) {
    if (score == null || !Number.isFinite(score)) return null;
    return MASTERY_BANDS.find(band => score <= band.max) ?? MASTERY_BANDS[MASTERY_BANDS.length - 1];
}

// ── Statistik dasar ──────────────────────────────────────────────────────────
export const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
/** Varians populasi (pembagi n), konsisten dengan KR-20/α. */
export function variance(values: number[]) {
    if (!values.length) return NaN;
    const m = mean(values);
    return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
}
/** Kuantil interpolasi linear (tipe 7). */
export function quantile(values: number[], q: number) {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * (position - lower);
}
export function pearson(x: number[], y: number[]): number | null {
    if (x.length !== y.length || x.length < 3) return null;
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) {
        sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2;
    }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
/**
 * Cronbach α dari matriks skor (baris = peserta, kolom = butir, tanpa data hilang).
 * Untuk butir 0/1 hasilnya identik dengan KR-20.
 */
export function cronbachAlpha(rows: number[][]): number | null {
    const k = rows[0]?.length ?? 0;
    if (rows.length < 2 || k < 2) return null;
    const totalVariance = variance(rows.map(row => row.reduce((sum, value) => sum + value, 0)));
    if (!(totalVariance > 0)) return null;
    const itemVariance = Array.from({ length: k }, (_, column) => variance(rows.map(row => row[column]))).reduce((sum, value) => sum + value, 0);
    return (k / (k - 1)) * (1 - itemVariance / totalVariance);
}
export function reliabilityLabel(alpha: number | null) {
    if (alpha == null) return 'Belum dapat dihitung';
    if (alpha >= 0.9) return 'Sangat tinggi';
    if (alpha >= 0.8) return 'Tinggi';
    if (alpha >= 0.7) return 'Memadai';
    if (alpha >= 0.6) return 'Cukup';
    return 'Rendah';
}
/** Kategori daya beda Ebel & Frisbie (1991), sama dengan layanan analitik. */
export function discriminationCategory(d: number | null) {
    if (d == null) return '-';
    if (d >= 0.4) return 'Sangat baik';
    if (d >= 0.3) return 'Baik';
    if (d >= 0.2) return 'Cukup';
    if (d >= 0) return 'Jelek';
    return 'Dibuang';
}

// ── IRT ──────────────────────────────────────────────────────────────────────
const IRT_ORDER = ['irt_3pl', 'irt_2pl', 'irt_1pl'];
/** Parameter Kalkulasi IRT disimpan untuk model tertinggi yang dipakai (3PL > 2PL > 1PL). */
export function calibrationModel(models: string[] = []) {
    return IRT_ORDER.find(model => models.includes(model)) ?? null;
}
export function irtProbability(theta: number, item: ReportIrtItem, model: string) {
    const d = model === 'irt_1pl' ? 1 : 1.7;
    const a = model === 'irt_1pl' ? 1 : item.a;
    const c = model === 'irt_3pl' ? item.c : 0;
    return c + (1 - c) / (1 + Math.exp(-d * a * (theta - item.b)));
}
/** Informasi butir Birnbaum: D²a² · (Q/P) · ((P − c)/(1 − c))². */
export function irtItemInformation(theta: number, item: ReportIrtItem, model: string) {
    const d = model === 'irt_1pl' ? 1 : 1.7;
    const a = model === 'irt_1pl' ? 1 : item.a;
    const c = model === 'irt_3pl' ? item.c : 0;
    const p = Math.min(1 - 1e-12, Math.max(1e-12, irtProbability(theta, item, model)));
    return d * d * a * a * ((1 - p) / p) * ((p - c) / (1 - c)) ** 2;
}
export function testInformation(theta: number, items: ReportIrtItem[], model: string) {
    return items.reduce((sum, item) => sum + irtItemInformation(theta, item, model), 0);
}
/** θ EAP dengan prior N(0,1): galat baku ≈ 1/√(I(θ) + 1). */
export function thetaStandardError(theta: number, items: ReportIrtItem[], model: string) {
    return 1 / Math.sqrt(testInformation(theta, items, model) + 1);
}

// ── Hasil ────────────────────────────────────────────────────────────────────
export interface ItemFlag { code: 'easy' | 'hard' | 'negative' | 'low_disc' | 'dead_distractor' | 'upper_distractor' | 'omitted'; label: string; advice: string }
export interface DistractorStat { optionId: string; letter: string; text: string; isKey: boolean; share: number; upperShare: number; lowerShare: number; flag: string | null }
export interface ItemStat {
    id: string; number: number; type: string; topic: string; text: string; maxScore: number; keyDisplay: string;
    graded: number; omitted: number; ungraded: number;
    /** Bagian jawaban yang sudah dinilai: skor penuh, sebagian (0 < x < 1), dan nol (termasuk kosong). */
    fullShare: number | null; partialShare: number | null; zeroShare: number | null;
    p: number | null; difficulty: ItemDifficultyCategory | null;
    ritc: number | null; d: number | null; discrimination: string; alphaIfDeleted: number | null;
    irt: ReportIrtItem | null;
    distractors: DistractorStat[];
    flags: ItemFlag[];
    decision: 'Baik' | 'Revisi' | 'Tinjau ulang';
}
export interface TopicStat { name: string; questionCount: number; percent: number | null; band: ReturnType<typeof masteryBand> }
export interface StudentTopic { name: string; percent: number | null; earned: number; max: number; band: ReturnType<typeof masteryBand> }
export interface StudentItem { id: string; number: number; type: string; maxScore: number; status: ReportCell['status']; credit: number | null; answer: string; key: string; topic: string; p: number | null }
export interface StudentReport {
    attemptId: string; name: string; nis: string; className: string;
    score: number | null; band: ReturnType<typeof masteryBand>; percentile: number | null;
    sem: number | null; correct: number; wrong: number; unanswered: number; ungraded: number; partial: number;
    theta: number | null; thetaSe: number | null; scaled: number | null;
    topics: StudentTopic[]; items: StudentItem[];
    strengths: StudentTopic[]; needs: StudentTopic[]; missedEasy: StudentItem[];
    recommendations: string[];
}
export interface Descriptives { n: number; mean: number; sd: number; median: number; q1: number; q3: number; min: number; max: number }
export interface AssessmentReport {
    registered: number; completed: number; analyzed: number;
    itemCount: number; maxPoints: number;
    descriptives: Descriptives | null;
    histogram: number[];
    bandCounts: Record<MasteryBand, number>;
    reliability: { method: 'KR-20' | 'Cronbach Alpha'; value: number | null; label: string; n: number; k: number; semPoints: number | null; sem: number | null } ;
    items: ItemStat[];
    topics: TopicStat[];
    students: StudentReport[];
    irt: null | { model: string; label: string; meanTheta: number | null; sdTheta: number | null; meanSe: number | null; curve: Array<{ theta: number; info: number }>; peak: number | null; hasCalibration: boolean };
    warnings: string[];
}

const round = (value: number, digits = 4) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value;
const plain = (html: unknown) => String(html ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();

/** Skor butir 0–1; kosong = 0, belum dinilai = null (data hilang, bukan salah). */
export function itemCredit(cell: ReportCell | undefined, maxScore: number): number | null {
    if (!cell || cell.status === 'unanswered') return 0;
    if (cell.status === 'ungraded') return null;
    const raw = Number(cell.score);
    let credit = Number.isFinite(raw) && maxScore > 0 ? Math.min(1, Math.max(0, raw / maxScore)) : 0;
    if (cell.status === 'correct' && credit === 0) credit = 1;
    return credit;
}

function officialScore(attempt: ReportAttempt | undefined): number | null {
    if (!attempt || !FINISHED_STATUSES.includes(attempt.status) || attempt.needs_manual_grading) return null;
    const value = attempt.detailed_scores?.classical ?? attempt.total_score;
    return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function studentTheta(attempt: ReportAttempt | undefined, model: string | null): number | null {
    if (!attempt || !model || !hasThetaIrtScale(attempt)) return null;
    const value = attempt.detailed_scores?.[model] ?? attempt.score_irt;
    return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function buildAssessmentReport(input: AssessmentReportInput): AssessmentReport {
    const warnings: string[] = [];
    const questions = input.questions
        .filter(question => isAcademicTopicQuestion({ ...question, type: question.type || 'mcq' }))
        .map((question, index) => ({
            ...question,
            number: question.number ?? index + 1,
            maxScore: Number(question.score_default ?? 1) > 0 ? Number(question.score_default ?? 1) : 1,
            topicName: questionTopic(question) || UNTOPICAL,
        }))
        .sort((a, b) => a.number - b.number);
    const attemptById = new Map(input.attempts.map(attempt => [attempt.id, attempt]));
    const rows = input.matrix.filter(row => FINISHED_STATUSES.includes(row.status) || FINISHED_STATUSES.includes(attemptById.get(row.attempt_id)?.status || ''));
    const n = rows.length;
    const credit = rows.map(row => questions.map(question => itemCredit(row.items[question.id], question.maxScore)));
    const maxPoints = questions.reduce((sum, question) => sum + question.maxScore, 0);

    // Persentase skor atas butir yang sudah dinilai: dasar pengurutan kelompok atas/bawah.
    const percentGraded = credit.map(values => {
        let earned = 0, max = 0;
        values.forEach((value, index) => { if (value != null) { earned += value * questions[index].maxScore; max += questions[index].maxScore; } });
        return max > 0 ? earned / max * 100 : 0;
    });
    const order = rows.map((_, index) => index).sort((a, b) => percentGraded[b] - percentGraded[a]);
    const groupSize = n >= 4 ? Math.max(1, Math.round(n * EXTREME_GROUP_SHARE)) : 0;
    const upper = new Set(order.slice(0, groupSize));
    const lower = new Set(order.slice(n - groupSize));

    // Kasus lengkap (tanpa butir belum dinilai) untuk reliabilitas.
    const complete = credit.map((values, index) => ({ values, index })).filter(row => row.values.every(value => value != null));
    const pointRows = complete.map(row => row.values.map((value, column) => (value as number) * questions[column].maxScore));
    const alpha = cronbachAlpha(pointRows);
    const dichotomous = questions.every((_, column) => credit.every(values => values[column] == null || values[column] === 0 || values[column] === 1));
    const totalPoints = pointRows.map(row => row.reduce((sum, value) => sum + value, 0));
    const semPoints = alpha != null ? Math.sqrt(variance(totalPoints)) * Math.sqrt(Math.max(0, 1 - alpha)) : null;
    const sem = semPoints != null && maxPoints > 0 ? semPoints / maxPoints * 100 : null;
    if (n < MIN_STABLE_PARTICIPANTS && n > 0) warnings.push(`Baru ${n} peserta dianalisis; statistik butir dan reliabilitas belum stabil (disarankan ≥ ${MIN_STABLE_PARTICIPANTS}).`);
    if (complete.length < n) warnings.push(`${n - complete.length} peserta masih memiliki jawaban belum dinilai; tidak dihitung pada reliabilitas.`);

    // ── IRT ──
    const model = calibrationModel(input.irt?.models) ?? calibrationModel(String(input.scoringType || '').split(',').map(type => type.trim() === 'irt' ? 'irt_1pl' : type.trim()));
    const irtItems = input.irt?.items ?? [];
    const irtByQuestion = new Map<string, ReportIrtItem>();
    for (const item of irtItems) if (!irtByQuestion.has(item.question_id)) irtByQuestion.set(item.question_id, item);

    // ── Pilihan peserta untuk analisis pengecoh ──
    const selected = new Map<string, string>();
    for (const answer of input.answers ?? []) if (answer.attempt_id && answer.selected_option_id) selected.set(`${answer.attempt_id}:${answer.question_id}`, String(answer.selected_option_id));

    const items: ItemStat[] = questions.map((question, column) => {
        const graded: number[] = [], rest: number[] = [];
        let omitted = 0, ungraded = 0;
        rows.forEach((row, index) => {
            const cell = row.items[question.id];
            if (!cell || cell.status === 'unanswered') omitted++;
            const value = credit[index][column];
            if (value == null) { ungraded++; return; }
            graded.push(value);
            let earned = 0, max = 0;
            credit[index].forEach((other, otherColumn) => {
                if (otherColumn === column || other == null) return;
                earned += other * questions[otherColumn].maxScore; max += questions[otherColumn].maxScore;
            });
            rest.push(max > 0 ? earned / max : 0);
        });
        const p = graded.length ? mean(graded) : null;
        const ritc = pearson(graded, rest);
        const groupMean = (group: Set<number>) => {
            const values = [...group].map(index => credit[index][column]).filter((value): value is number => value != null);
            return values.length ? mean(values) : null;
        };
        const pu = groupMean(upper), pl = groupMean(lower);
        const d = pu != null && pl != null ? pu - pl : null;
        const alphaIfDeleted = questions.length > 2 ? cronbachAlpha(pointRows.map(row => row.filter((_, other) => other !== column))) : null;

        const distractors: DistractorStat[] = String(question.type).toLowerCase() === 'mcq' && n > 0
            ? (question.options || []).filter(option => option.id).map((option, index) => {
                const chose = (group: Iterable<number>, size: number) => size ? [...group].filter(i => selected.get(`${rows[i].attempt_id}:${question.id}`) === option.id).length / size : 0;
                const share = chose(rows.keys(), n);
                const upperShare = chose(upper, upper.size), lowerShare = chose(lower, lower.size);
                const isKey = option.is_correct === true;
                const flag = isKey ? null : share < 0.05 ? 'Tidak berfungsi (< 5%)'
                    : groupSize && upperShare > lowerShare ? 'Menarik kelompok atas' : null;
                return { optionId: String(option.id), letter: String.fromCharCode(65 + index), text: plain(option.option_text ?? option.text).slice(0, 80),
                    isKey, share: round(share), upperShare: round(upperShare), lowerShare: round(lowerShare), flag };
            }) : [];

        const flags: ItemFlag[] = [];
        if (p != null && p > 0.9) flags.push({ code: 'easy', label: 'Terlalu mudah', advice: 'Pertahankan bila menguji materi esensial; untuk membedakan kemampuan, naikkan tuntutan berpikirnya.' });
        if (p != null && p <= 0.2) flags.push({ code: 'hard', label: 'Terlalu sulit', advice: 'Periksa kunci dan kejelasan redaksi, serta apakah materinya sudah diajarkan.' });
        if (ritc != null && ritc < 0 || d != null && d < 0) flags.push({ code: 'negative', label: 'Daya beda negatif', advice: 'Siswa berkemampuan tinggi justru lebih banyak salah: periksa kunci jawaban dan ambiguitas soal.' });
        else if (ritc != null && ritc < 0.2 || d != null && d < 0.2) flags.push({ code: 'low_disc', label: 'Daya beda rendah', advice: 'Perbaiki redaksi atau pengecoh agar soal membedakan siswa yang menguasai dan belum.' });
        const dead = distractors.filter(option => option.flag?.startsWith('Tidak berfungsi'));
        if (dead.length) flags.push({ code: 'dead_distractor', label: `Pengecoh ${dead.map(option => option.letter).join(', ')} tidak berfungsi`, advice: 'Ganti pengecoh yang hampir tidak dipilih dengan miskonsepsi yang lazim.' });
        const attractive = distractors.filter(option => option.flag === 'Menarik kelompok atas');
        if (attractive.length) flags.push({ code: 'upper_distractor', label: `Pengecoh ${attractive.map(option => option.letter).join(', ')} menarik kelompok atas`, advice: 'Pengecoh ini mungkin juga benar atau redaksinya menjebak; tinjau ulang.' });
        if (n > 0 && omitted / n > 0.2) flags.push({ code: 'omitted', label: 'Banyak dikosongkan', advice: 'Kemungkinan waktu kurang, soal membingungkan, atau berada di akhir tes.' });
        const decision: ItemStat['decision'] = flags.some(flag => flag.code === 'negative' || flag.code === 'upper_distractor') ? 'Tinjau ulang'
            : flags.length ? 'Revisi' : 'Baik';

        return {
            id: question.id, number: question.number, type: question.type, topic: question.topicName,
            text: plain(question.question_text), maxScore: question.maxScore,
            keyDisplay: input.keyDisplay?.[question.id] || '-',
            graded: graded.length, omitted, ungraded,
            fullShare: graded.length ? round(graded.filter(value => value >= 1).length / graded.length) : null,
            partialShare: graded.length ? round(graded.filter(value => value > 0 && value < 1).length / graded.length) : null,
            zeroShare: graded.length ? round(graded.filter(value => value <= 0).length / graded.length) : null,
            p: p != null ? round(p) : null, difficulty: classicalDifficulty(p),
            ritc: ritc != null ? round(ritc) : null, d: d != null ? round(d) : null, discrimination: discriminationCategory(d),
            alphaIfDeleted: alphaIfDeleted != null ? round(alphaIfDeleted) : null,
            irt: irtByQuestion.get(question.id) ?? null,
            distractors, flags, decision,
        };
    });
    const pById = new Map(items.map(item => [item.id, item.p]));

    // ── Materi ──
    const topicNames = [...new Set(questions.map(question => question.topicName))];
    const topicOf = (name: string) => questions.map((question, column) => ({ question, column })).filter(entry => entry.question.topicName === name);
    const topicPercent = (values: Array<number | null>, entries: ReturnType<typeof topicOf>) => {
        let earned = 0, max = 0;
        entries.forEach(({ question, column }) => { const value = values[column]; if (value != null) { earned += value * question.maxScore; max += question.maxScore; } });
        return { earned, max, percent: max > 0 ? earned / max * 100 : null };
    };
    const topics: TopicStat[] = topicNames.map(name => {
        const entries = topicOf(name);
        let earned = 0, max = 0;
        credit.forEach(values => { const result = topicPercent(values, entries); earned += result.earned; max += result.max; });
        const percent = max > 0 ? round(earned / max * 100, 2) : null;
        return { name, questionCount: entries.length, percent, band: masteryBand(percent) };
    }).sort((a, b) => (a.name === UNTOPICAL ? 1 : 0) - (b.name === UNTOPICAL ? 1 : 0) || a.name.localeCompare(b.name, 'id', { numeric: true }));
    const mappedTopics = topics.some(topic => topic.name !== UNTOPICAL);

    // ── Nilai ──
    const scores = rows.map((row, index) => officialScore(attemptById.get(row.attempt_id)) ?? (credit[index].every(value => value != null) ? round(percentGraded[index], 2) : null));
    const valid = scores.filter((score): score is number => score != null);
    const descriptives: Descriptives | null = valid.length ? {
        n: valid.length, mean: mean(valid), sd: Math.sqrt(variance(valid)), median: quantile(valid, 0.5),
        q1: quantile(valid, 0.25), q3: quantile(valid, 0.75), min: Math.min(...valid), max: Math.max(...valid),
    } : null;
    const histogram = Array.from({ length: 10 }, () => 0);
    valid.forEach(score => { histogram[Math.min(9, Math.max(0, Math.floor(score / 10)))]++; });
    const bandCounts = Object.fromEntries(MASTERY_BANDS.map(band => [band.id, 0])) as Record<MasteryBand, number>;
    valid.forEach(score => { const band = masteryBand(score); if (band) bandCounts[band.id]++; });

    // ── IRT ringkasan ──
    const thetas = rows.map(row => studentTheta(attemptById.get(row.attempt_id), model));
    const ses = thetas.map(theta => theta != null && model && irtItems.length ? thetaStandardError(theta, irtItems, model) : null);
    const validThetas = thetas.filter((theta): theta is number => theta != null);
    const validSes = ses.filter((se): se is number => se != null);
    const curve = model && irtItems.length ? Array.from({ length: 33 }, (_, index) => { const theta = -4 + index * 0.25; return { theta, info: testInformation(theta, irtItems, model) }; }) : [];
    const irt = model ? {
        model, label: `IRT ${model.replace('irt_', '').toUpperCase()}`,
        meanTheta: validThetas.length ? mean(validThetas) : null, sdTheta: validThetas.length ? Math.sqrt(variance(validThetas)) : null,
        meanSe: validSes.length ? mean(validSes) : null, curve,
        peak: curve.length ? curve.reduce((best, point) => point.info > best.info ? point : best).theta : null,
        hasCalibration: irtItems.length > 0,
    } : null;
    if (model && !irtItems.length) warnings.push('Kalkulasi IRT belum dijalankan; parameter butir dan galat baku θ belum tersedia.');

    // ── Per peserta ──
    const students: StudentReport[] = rows.map((row, index) => {
        const score = scores[index];
        const band = masteryBand(score);
        const studentItems: StudentItem[] = questions.map((question, column) => {
            const cell = row.items[question.id];
            return { id: question.id, number: question.number, type: question.type, maxScore: question.maxScore, status: cell?.status ?? 'unanswered', credit: credit[index][column],
                answer: plain(cell?.display_answer || '-').slice(0, 60) || '-', key: plain(input.keyDisplay?.[question.id] || '-').slice(0, 60),
                topic: question.topicName, p: pById.get(question.id) ?? null };
        });
        const studentTopics: StudentTopic[] = topicNames.map(name => {
            const result = topicPercent(credit[index], topicOf(name));
            const percent = result.percent != null ? round(result.percent, 2) : null;
            return { name, percent, earned: result.earned, max: result.max, band: masteryBand(percent) };
        }).sort((a, b) => (a.name === UNTOPICAL ? 1 : 0) - (b.name === UNTOPICAL ? 1 : 0) || a.name.localeCompare(b.name, 'id', { numeric: true }));
        const named = studentTopics.filter(topic => topic.name !== UNTOPICAL && topic.percent != null);
        const strengths = named.filter(topic => (topic.percent as number) > 65).sort((a, b) => (b.percent as number) - (a.percent as number)).slice(0, 3);
        const needs = named.filter(topic => (topic.percent as number) <= 65).sort((a, b) => (a.percent as number) - (b.percent as number));
        const missedEasy = studentItems.filter(item => item.p != null && item.p >= EASY_ITEM_P && (item.status === 'wrong' || item.status === 'unanswered') && (item.credit ?? 0) < 1);
        const count = (status: ReportCell['status']) => studentItems.filter(item => item.status === status).length;
        const partial = studentItems.filter(item => item.credit != null && item.credit > 0 && item.credit < 1).length;
        const percentile = score != null && valid.length > 1 ? round(valid.filter(other => other < score).length / valid.length * 100 + valid.filter(other => other === score).length / valid.length * 50, 0) : null;

        const recommendations: string[] = [];
        if (band) recommendations.push(`${band.label}: ${band.advice}`);
        if (needs.length) recommendations.push(`Pelajari ulang materi ${needs.slice(0, 3).map(topic => `"${topic.name}"`).join(', ')} lalu kerjakan latihan sejenis.`);
        else if (mappedTopics && band && band.id !== 'pengayaan') recommendations.push('Semua materi sudah di atas batas tuntas; perkuat ketelitian pada soal yang masih salah.');
        if (strengths.length && band?.id !== 'bimbingan') recommendations.push(`Pertahankan penguasaan ${strengths.map(topic => `"${topic.name}"`).join(', ')}; dapat menjadi tutor sebaya.`);
        if (missedEasy.length) recommendations.push(`Soal nomor ${missedEasy.map(item => item.number).join(', ')} dijawab benar oleh sebagian besar kelas: cek kembali konsep atau ketelitian.`);
        if (count('unanswered') > 0) recommendations.push(`${count('unanswered')} soal tidak dijawab: latih pengelolaan waktu dan usahakan menjawab semua soal.`);
        if (count('ungraded') > 0) recommendations.push(`${count('ungraded')} jawaban masih menunggu penilaian guru; nilai dapat berubah.`);

        const theta = thetas[index];
        return {
            attemptId: row.attempt_id, name: row.student_name || 'Tanpa Nama', nis: row.student_nis || '-', className: row.class_name || '-',
            score, band, percentile, sem,
            correct: count('correct'), wrong: count('wrong'), unanswered: count('unanswered'), ungraded: count('ungraded'), partial,
            theta, thetaSe: ses[index] != null ? round(ses[index] as number) : null, scaled: theta != null ? irtScaledScore(theta) : null,
            topics: studentTopics, items: studentItems, strengths, needs, missedEasy, recommendations,
        };
    }).sort((a, b) => a.className.localeCompare(b.className, 'id', { numeric: true }) || a.name.localeCompare(b.name, 'id'));

    return {
        registered: input.attempts.length,
        completed: input.attempts.filter(attempt => FINISHED_STATUSES.includes(attempt.status)).length,
        analyzed: n, itemCount: questions.length, maxPoints,
        descriptives, histogram, bandCounts,
        reliability: { method: dichotomous ? 'KR-20' : 'Cronbach Alpha', value: alpha != null ? round(alpha) : null, label: reliabilityLabel(alpha),
            n: complete.length, k: questions.length, semPoints: semPoints != null ? round(semPoints) : null, sem: sem != null ? round(sem, 2) : null },
        items, topics, students, irt, warnings,
    };
}
