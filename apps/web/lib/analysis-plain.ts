/**
 * Bahasa awam untuk PDF Analisis Soal dan PDF Laporan Siswa: kategori kesulitan dan daya pembeda,
 * kesimpulan per soal, catatan sesuai bentuk soal, serta ringkasan dan saran untuk tiap siswa.
 *
 * Murni (tanpa DOM) agar dapat diuji. Dasar batas dan rujukan: docs/laporan-analisis-hasil-pdf-2026-11-16.md
 * (bagian "Penyederhanaan 19 November 2026").
 */
import type { AssessmentReport, ItemStat, MasteryBand, StudentItem, StudentReport } from './assessment-report';

/** Kelompok bentuk soal menurut cara penskorannya; menentukan jenis catatan analisis. */
export type ItemFamily = 'pilihan' | 'berbagian' | 'isian' | 'uraian';

interface TypeInfo { label: string; family: ItemFamily; scoring: string }
const TYPES: Record<string, TypeInfo> = {
    mcq: { label: 'Pilihan ganda', family: 'pilihan', scoring: 'Benar atau salah' },
    mcq_complex: { label: 'Pilihan ganda kompleks', family: 'pilihan', scoring: 'Benar jika semua pilihan tepat' },
    true_false: { label: 'Benar-salah', family: 'berbagian', scoring: 'Skor sebagian per pernyataan' },
    categorization: { label: 'Pengelompokan', family: 'berbagian', scoring: 'Skor sebagian per butir' },
    matching: { label: 'Menjodohkan', family: 'berbagian', scoring: 'Skor sebagian per pasangan' },
    ordering: { label: 'Mengurutkan', family: 'berbagian', scoring: 'Skor sebagian per urutan' },
    short_answer: { label: 'Isian singkat', family: 'isian', scoring: 'Dicocokkan dengan kunci' },
    essay: { label: 'Uraian', family: 'uraian', scoring: 'Dinilai guru dengan rubrik' },
};
TYPES.esay = TYPES.uraian = TYPES.essay;

export function typeInfo(type: string): TypeInfo {
    return TYPES[String(type || 'mcq').toLowerCase().trim()] ?? { label: 'Lainnya', family: 'berbagian', scoring: 'Sesuai kunci soal' };
}

export type Difficulty = 'Mudah' | 'Sedang' | 'Sulit';
/** Tiga kategori Panduan Analisis Butir Soal (Depdiknas 2008): 0,00–0,30 sulit; 0,31–0,70 sedang; 0,71–1,00 mudah. */
export function difficultyLabel(p: number | null): Difficulty | '-' {
    if (p == null || !Number.isFinite(p)) return '-';
    return p <= 0.3 ? 'Sulit' : p <= 0.7 ? 'Sedang' : 'Mudah';
}

export type Discrimination = 'Baik' | 'Cukup' | 'Kurang' | 'Terbalik';
/** Daya pembeda D (Ebel & Frisbie 1991): >= 0,30 baik; 0,20–0,29 cukup; 0–0,19 kurang; negatif terbalik. */
export function discriminationLabel(d: number | null): Discrimination | '-' {
    if (d == null || !Number.isFinite(d)) return '-';
    return d < 0 ? 'Terbalik' : d < 0.2 ? 'Kurang' : d < 0.3 ? 'Cukup' : 'Baik';
}

export type Conclusion = 'Layak dipakai' | 'Perlu diperbaiki' | 'Periksa ulang' | 'Belum dapat disimpulkan';
export interface ItemReading {
    number: number; typeLabel: string; family: ItemFamily; topic: string;
    /** Capaian kelas pada soal ini: rata-rata skor ÷ skor maksimum (0–1). */
    achievement: number | null;
    difficulty: Difficulty | '-'; discrimination: Discrimination | '-';
    conclusion: Conclusion; notes: string[];
}

/** Ambang "setara menebak" untuk pilihan ganda: peluang tebakan 1/k ditambah 5 poin persen. */
const GUESS_MARGIN = 0.05;
const MIN_FOR_GUESS_CHECK = 10;
export const percentText = (value: number | null | undefined, digits = 0) =>
    value == null || !Number.isFinite(value) ? '-' : `${(value * 100).toFixed(digits).replace('.', ',')}%`;
/** Rincian sesuai EYD: "a dan b"; "a, b, dan c". */
export const listText = (items: Array<string | number>) => items.length <= 2 ? items.join(' dan ')
    : `${items.slice(0, -1).join(', ')}, dan ${items[items.length - 1]}`;

const IMPROVE: Record<ItemFamily, string> = {
    pilihan: 'Perbaiki kalimat soal atau pilihan jawabannya.',
    berbagian: 'Perjelas petunjuk serta setiap pernyataan atau bagian soal.',
    isian: 'Perjelas pertanyaan dan lengkapi kunci dengan variasi jawaban benar yang wajar.',
    uraian: 'Perjelas pertanyaan dan pedoman penskorannya.',
};

export function readItem(item: ItemStat, analyzed: number): ItemReading {
    const info = typeInfo(item.type);
    const notes: string[] = [];
    let severity = 0; // 0 layak, 1 perbaiki, 2 periksa ulang
    const raise = (level: number) => { severity = Math.max(severity, level); };
    const p = item.p, d = item.d;

    if (item.ritc != null && item.ritc < 0 || d != null && d < 0) {
        notes.push('Siswa yang nilai totalnya tinggi justru lebih banyak salah pada soal ini. Periksa kunci jawaban dan pastikan kalimat soal tidak bermakna ganda.');
        raise(2);
    }
    const attractive = item.distractors.filter(option => option.flag === 'Menarik kelompok atas').map(option => option.letter);
    if (attractive.length) {
        notes.push(`Pilihan ${listText(attractive)} lebih banyak dipilih siswa berkemampuan tinggi daripada siswa berkemampuan rendah. Pastikan pilihan tersebut memang salah.`);
        raise(2);
    }
    const options = item.distractors.length;
    if (item.type === 'mcq' && options >= 2 && p != null && analyzed >= MIN_FOR_GUESS_CHECK && p <= 1 / options + GUESS_MARGIN && severity < 2) {
        notes.push(`Jawaban benar hanya ${percentText(p)}, setara dengan hasil menebak (${percentText(1 / options)} untuk ${options} pilihan). Periksa kunci dan pastikan materinya sudah diajarkan.`);
        raise(2);
    }
    const veryEasy = p != null && p > 0.9;
    if (veryEasy) notes.push('Hampir semua siswa menjawab benar. Soal ini cocok untuk memastikan materi dasar, tetapi kurang dapat membedakan kemampuan siswa.');
    else if (p != null && p <= 0.2 && severity < 2) {
        notes.push('Sebagian besar siswa belum dapat menjawab. Periksa kunci, kejelasan soal, dan apakah materinya sudah diajarkan.');
        raise(1);
    }
    if (!veryEasy && d != null && d >= 0 && d < 0.2 && severity < 2) {
        notes.push(`Soal belum dapat membedakan siswa yang sudah menguasai materi dengan yang belum. ${IMPROVE[info.family]}`);
        raise(1);
    }
    // Tanpa catatan pilihan sama sekali (data pilihan tidak tersedia), semua pengecoh akan tampak "tidak dipilih".
    const recorded = item.distractors.some(option => option.share > 0);
    const dead = recorded ? item.distractors.filter(option => option.flag?.startsWith('Tidak berfungsi')).map(option => option.letter) : [];
    if (dead.length) {
        notes.push(`Pilihan ${listText(dead)} hampir tidak dipilih (kurang dari 5% siswa) sehingga tidak berfungsi sebagai pengecoh. Ganti dengan pilihan yang lebih masuk akal.`);
        // Satu pengecoh lemah lazim terjadi (Haladyna & Downing 1993); perbaikan wajib bila tersisa paling banyak satu pengecoh yang berfungsi.
        if (options - 1 - dead.length <= 1) raise(1);
    }
    if (info.family === 'berbagian' && (item.partialShare ?? 0) >= 0.4) {
        notes.push(`${percentText(item.partialShare)} siswa hanya benar sebagian. Pemahaman mereka belum utuh; bahas kembali bagian yang paling sering keliru.`);
    }
    if (info.family === 'uraian' && item.graded > 0 && (item.zeroShare ?? 0) >= 0.5) {
        notes.push(`${percentText(item.zeroShare)} siswa memperoleh skor nol. Periksa apakah pertanyaan dan tuntutan jawabannya sudah jelas.`);
    }
    if (analyzed > 0 && item.omitted / analyzed > 0.2) {
        notes.push(`${percentText(item.omitted / analyzed)} siswa tidak menjawab. Kemungkinan waktu kurang atau soal sulit dipahami.`);
        raise(1);
    }
    if (item.ungraded > 0) notes.push(`${item.ungraded} jawaban belum dinilai guru; hasil soal ini dapat berubah.`);

    const conclusion: Conclusion = p == null ? 'Belum dapat disimpulkan'
        : severity === 2 ? 'Periksa ulang' : severity === 1 ? 'Perlu diperbaiki' : 'Layak dipakai';
    return { number: item.number, typeLabel: info.label, family: info.family, topic: item.topic, achievement: p,
        difficulty: difficultyLabel(p), discrimination: discriminationLabel(d), conclusion, notes };
}

export interface TypeSummary { label: string; family: ItemFamily; scoring: string; count: number; achievement: number | null; good: number; fix: number }
/** Ringkasan per bentuk soal untuk analisis umum. */
export function summarizeTypes(items: ItemStat[], readings: ItemReading[]): TypeSummary[] {
    const groups = new Map<string, TypeSummary & { sum: number; valued: number }>();
    items.forEach((item, index) => {
        const info = typeInfo(item.type);
        const group = groups.get(info.label) ?? { ...info, count: 0, achievement: null, good: 0, fix: 0, sum: 0, valued: 0 };
        group.count++;
        if (item.p != null) { group.sum += item.p; group.valued++; }
        if (readings[index].conclusion === 'Layak dipakai') group.good++;
        else if (readings[index].conclusion !== 'Belum dapat disimpulkan') group.fix++;
        groups.set(info.label, group);
    });
    return [...groups.values()].map(({ sum, valued, ...group }) => ({ ...group, achievement: valued ? sum / valued : null }));
}

/** Makna kategori capaian untuk pembaca awam (interval KKTP). */
export const BAND_MEANING: Record<MasteryBand, string> = {
    bimbingan: 'belum mencapai tujuan pembelajaran dan memerlukan bimbingan',
    remedial: 'sebagian tujuan pembelajaran belum tercapai sehingga perlu perbaikan pada bagian tertentu',
    tuntas: 'sudah mencapai tujuan pembelajaran',
    pengayaan: 'sudah mencapai tujuan pembelajaran dengan sangat baik',
};

export const RELIABILITY_PLAIN = (value: number | null) => value == null ? 'Belum dapat dihitung'
    : value >= 0.7 ? 'Baik' : value >= 0.6 ? 'Cukup' : 'Kurang';

const fmt = (value: number | null | undefined, digits = 0) =>
    value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits).replace('.', ',');

/** Paragraf ringkasan hasil kelas. */
export function classNarrative(report: AssessmentReport, readings: ItemReading[]): string {
    const d = report.descriptives;
    const passed = report.bandCounts.tuntas + report.bandCounts.pengayaan;
    const graded = Object.values(report.bandCounts).reduce((a, b) => a + b, 0);
    const count = (conclusion: Conclusion) => readings.filter(reading => reading.conclusion === conclusion).length;
    const parts = [`Ujian ini diikuti oleh ${report.analyzed} dari ${report.registered} siswa terdaftar.`];
    if (d) parts.push(`Rata-rata nilai kelas adalah ${fmt(d.mean, 1)} dengan nilai tertinggi ${fmt(d.max, 0)} dan terendah ${fmt(d.min, 0)}.`);
    if (graded) parts.push(`Sebanyak ${passed} siswa (${percentText(passed / graded)}) sudah tuntas, yaitu memperoleh nilai di atas 65.`);
    const weak = report.topics.filter(topic => topic.name !== 'Tanpa materi' && topic.percent != null && topic.percent <= 65)
        .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));
    if (weak.length) parts.push(`Materi yang paling perlu diajarkan ulang adalah ${listText(weak.slice(0, 3).map(topic => `${topic.name} (${fmt(topic.percent, 0)}%)`))}.`);
    const fix = count('Perlu diperbaiki'), check = count('Periksa ulang');
    parts.push(`Dari ${report.itemCount} soal, ${count('Layak dipakai')} soal layak dipakai${fix || check ? `, ${fix} soal perlu diperbaiki, dan ${check} soal perlu diperiksa ulang` : ''}.`);
    return parts.join(' ');
}

export interface StudentTypeRow { label: string; count: number; full: number; partial: number; wrong: number; empty: number; pending: number; achievement: number | null }
/** Hasil siswa per bentuk soal. */
export function studentTypeRows(items: StudentItem[]): StudentTypeRow[] {
    const groups = new Map<string, StudentTypeRow & { earned: number; max: number }>();
    for (const item of items) {
        const label = typeInfo(item.type).label;
        const row = groups.get(label) ?? { label, count: 0, full: 0, partial: 0, wrong: 0, empty: 0, pending: 0, achievement: null, earned: 0, max: 0 };
        row.count++;
        if (item.status === 'ungraded' || item.credit == null) row.pending++;
        else {
            if (item.status === 'unanswered') row.empty++;
            else if (item.credit >= 1) row.full++;
            else if (item.credit > 0) row.partial++;
            else row.wrong++;
            row.earned += item.credit * item.maxScore; row.max += item.maxScore;
        }
        groups.set(label, row);
    }
    return [...groups.values()].map(({ earned, max, ...row }) => ({ ...row, achievement: max > 0 ? earned / max : null }));
}

export function resultText(row: Pick<StudentTypeRow, 'full' | 'partial' | 'wrong' | 'empty' | 'pending'>): string {
    return [row.full && `${row.full} benar`, row.partial && `${row.partial} benar sebagian`, row.wrong && `${row.wrong} salah`,
        row.empty && `${row.empty} tidak dijawab`, row.pending && `${row.pending} belum dinilai`].filter(Boolean).join(', ') || '-';
}

/** Paragraf ringkasan untuk siswa dan orang tua. */
export function studentNarrative(student: StudentReport, classMean: number | null | undefined): string {
    const first = student.name.trim() || 'Ananda';
    const parts: string[] = [];
    if (student.score == null) parts.push(`Nilai akhir ${first} belum dapat ditetapkan karena sebagian jawaban masih menunggu penilaian guru.`);
    else {
        parts.push(`${first} memperoleh nilai ${fmt(student.score, 0)} dari 100${student.band ? ` dan termasuk kategori ${student.band.label}, artinya ${BAND_MEANING[student.band.id]}` : ''}.`);
        if (classMean != null && Number.isFinite(classMean)) {
            const diff = Math.round(student.score) - Math.round(classMean);
            parts.push(diff === 0 ? `Nilai ini sama dengan rata-rata kelas (${fmt(classMean, 0)}).`
                : `Nilai ini ${Math.abs(diff)} poin ${diff > 0 ? 'di atas' : 'di bawah'} rata-rata kelas (${fmt(classMean, 0)}).`);
        }
    }
    const total = student.items.length;
    const all = studentTypeRows(student.items).reduce((sum, row) => ({ full: sum.full + row.full, partial: sum.partial + row.partial,
        wrong: sum.wrong + row.wrong, empty: sum.empty + row.empty, pending: sum.pending + row.pending }), { full: 0, partial: 0, wrong: 0, empty: 0, pending: 0 });
    parts.push(`Dari ${total} soal, hasilnya: ${resultText(all)}.`);
    if (student.strengths.length) parts.push(`Materi yang sudah dikuasai dengan baik: ${listText(student.strengths.map(topic => topic.name))}.`);
    return parts.join(' ');
}

/** Saran tindak lanjut untuk siswa, ditulis dengan kalimat positif. */
export function studentAdvice(student: StudentReport): string[] {
    const advice: string[] = [];
    if (student.needs.length) advice.push(`Pelajari kembali materi ${listText(student.needs.slice(0, 3).map(topic => topic.name))}, lalu kerjakan latihan soal sejenis.`);
    if (student.missedEasy.length) advice.push(`Periksa kembali soal nomor ${listText(student.missedEasy.map(item => item.number))}. Soal ini dijawab benar oleh sebagian besar teman sekelas, jadi kemungkinan ada konsep yang terlewat atau kurang teliti.`);
    if (student.unanswered > 0) advice.push(`Ada ${student.unanswered} soal yang tidak dijawab. Latih pengaturan waktu agar semua soal sempat dijawab.`);
    if (student.band?.id === 'pengayaan') advice.push('Pertahankan cara belajar yang sudah baik dan coba latihan soal yang lebih menantang.');
    else if (student.band?.id === 'tuntas' && !student.needs.length) advice.push('Pertahankan hasil ini dan tingkatkan ketelitian pada soal yang masih salah.');
    else if (!advice.length && student.band) advice.push('Ikuti kegiatan perbaikan bersama guru dan ulangi latihan pada soal yang masih salah.');
    if (student.ungraded > 0) advice.push(`${student.ungraded} jawaban masih menunggu penilaian guru sehingga nilai dapat berubah.`);
    return advice;
}

export function parentAdvice(band: MasteryBand | undefined | null): string {
    switch (band) {
        case 'bimbingan': case 'remedial':
            return 'Dampingi Ananda saat belajar di rumah, terutama pada materi yang perlu ditingkatkan, dan hubungi guru mata pelajaran untuk mengetahui jadwal perbaikan.';
        case 'tuntas':
            return 'Berikan apresiasi atas usaha Ananda dan dorong Ananda untuk terus berlatih pada materi yang masih lemah.';
        case 'pengayaan':
            return 'Berikan apresiasi dan dukung Ananda untuk mengembangkan kemampuannya melalui bacaan atau latihan yang lebih menantang.';
        default:
            return 'Nilai akhir akan tersedia setelah guru selesai menilai semua jawaban.';
    }
}

/** Nomor soal yang belum tepat (salah, sebagian, atau kosong), dikelompokkan per materi. */
export function missedByTopic(items: StudentItem[]): Array<{ topic: string; numbers: number[] }> {
    const groups = new Map<string, number[]>();
    for (const item of items) {
        if (item.status === 'ungraded' || item.credit == null || item.credit >= 1) continue;
        groups.set(item.topic, [...(groups.get(item.topic) ?? []), item.number]);
    }
    return [...groups.entries()].map(([topic, numbers]) => ({ topic, numbers }));
}
