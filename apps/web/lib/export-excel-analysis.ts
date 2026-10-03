import { formatAnswerKey, formatStudentAnswer, type DisplayQuestion } from './answer-display';
import { gradingLabel } from './monitoring-health';
import type {
    DetailedItemAnalysisResponse,
    ExamAttemptRecord,
    OrganizationExam,
    StudentAnswerSummary,
    ExamAnswerRecord,
} from './api/proctor';
import type { QuestionOptionRecord, QuestionRecord } from './api/questions';

interface ExportItemAnalysis {
    id: string;
    number?: number;
    qText: string;
    type: string;
    options: QuestionOptionRecord[];
    total: number;
    correct: number;
    incorrect: number;
    ungraded?: number;
    keyDisplay?: string;
    difficultyIndex?: number;
    difficultyLabel?: string;
    discriminationIndex?: number;
    discriminationLabel?: string;
    wrongStudents: Array<StudentAnswerSummary | string>;
    correctStudents: Array<StudentAnswerSummary | string>;
    incorrectPercentage: number;
}

export interface ExportAnalysisOptions {
    exam: OrganizationExam | undefined;
    attempts: ExamAttemptRecord[];
    analysis: ExportItemAnalysis[];
    detailedAnalysis: DetailedItemAnalysisResponse | null;
    timeZone?: string;
    questions?: QuestionRecord[];
    answers?: ExamAnswerRecord[];
}

function cleanHtml(text: string | null | undefined): string {
    if (!text) return '';
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

export async function buildAnalysisWorkbook({
    exam,
    attempts,
    analysis,
    detailedAnalysis,
    timeZone = 'UTC',
    questions = [],
    answers = [],
}: ExportAnalysisOptions) {
    if (!attempts?.length && !analysis?.length && !detailedAnalysis?.items?.length) {
        throw new Error('Tidak ada data untuk diekspor');
    }

    // `xlsx-js-style` mempertahankan API SheetJS yang sudah digunakan aplikasi,
    // sekaligus benar-benar menulis font, warna, border, dan alignment ke berkas.
    const XLSX = await import('xlsx-js-style');
    const wb = XLSX.utils.book_new();

    // Reuse the full, type-aware display formatter. Do not export UUID/JSON
    // fragments or truncated Python display strings as the student's answer.
    if (detailedAnalysis && questions.length) {
        detailedAnalysis = structuredClone(detailedAnalysis);
        const displayQuestions = new Map<string, DisplayQuestion>(questions.map(question => [question.id, {
            type: question.type, question_text: question.question_text, metadata: question.metadata,
            options: (question.options || question.bank_question_options || []).map(option => ({ ...option, id: option.id || '' })),
        }]));
        for (const item of detailedAnalysis.items) {
            const question = displayQuestions.get(item.id);
            if (question) item.key_display = formatAnswerKey(question).join('; ') ||
                (['essay', 'esay', 'uraian'].includes(question.type) ? 'Rubrik / koreksi manual' : 'Tidak ada kunci objektif');
        }
        const raw = new Map(answers.map(answer => [`${answer.attempt_id}:${answer.question_id}`, answer]));
        for (const student of detailedAnalysis.matrix) {
            for (const [questionId, cell] of Object.entries(student.items)) {
                const question = displayQuestions.get(questionId);
                const answer = raw.get(`${student.attempt_id}:${questionId}`);
                if (question && answer) cell.display_answer = formatStudentAnswer(question, answer.selected_option_id, answer.essay_answer).join('; ') || '-';
            }
        }
    }

    const examTitle = exam?.title || 'Ujian';
    const date = (value?: string | null) => value && Number.isFinite(Date.parse(value))
        ? new Intl.DateTimeFormat('id-ID', { timeZone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) : 'Belum tercatat';
    const generatedAt = new Date().toISOString();
    const attemptById = new Map(attempts.map(attempt => [attempt.id, attempt]));
    // ─────────────────────────────────────────────────────────────────────────────
    // SHEET 1: Rekap_Hasil (Hasil & Ringkasan Siswa)
    // ─────────────────────────────────────────────────────────────────────────────
    if (attempts?.length) {
        const rowsHasil = attempts.map((a, idx) => {
            const bd = a.violation_breakdown || {
                pindah_tab: a.tab_switch_count ?? 0,
                close_tab: 0,
                lainnya: 0,
            };
            const statusLabel =
                a.status === 'submitted'
                    ? 'Selesai'
                    : a.status === 'auto_submitted'
                    ? 'Ditutup otomatis / pengawas'
                    : a.status === 'in_progress'
                    ? 'Sedang Mengerjakan'
                    : a.status === 'belum'
                    ? 'Belum Mengerjakan'
                    : a.status;

            return {
                'No': idx + 1,
                'Nama Peserta': a.profiles?.full_name || '-',
                'NIS / ID': a.profiles?.identity_number || '-',
                'Kelas': a.kelas_name || '-',
                'Status': statusLabel,
                'Nilai Klasik': !['submitted', 'auto_submitted'].includes(a.status) ? 'Belum dikumpulkan' : a.total_score == null ? 'Menunggu penilaian' : Number(a.detailed_scores?.classical ?? a.total_score).toFixed(2),
                'Status Penilaian': gradingLabel(a),
                'ID Pengerjaan': a.id,
                'Soal terisi di server': a.saved_answer_count ?? 'Belum diketahui',
                'Soal kosong di server': a.unanswered_count ?? 'Belum diketahui',
                'Tenggat pribadi': date(a.deadline_at),
                'Simpan terakhir (server)': date(a.last_answer_saved_at),
                'Nilai IRT': a.detailed_scores?.irt_1pl != null
                    ? Number(a.detailed_scores.irt_1pl).toFixed(2)
                    : a.score_irt != null
                    ? Number(a.score_irt).toFixed(2)
                    : '-',
                'Pelanggaran Total': a.warning_count ?? 0,
                'Pindah Tab': bd.pindah_tab,
                'Close Tab': bd.close_tab,
                'Pelanggaran Lain': bd.lainnya,
                'Lama pengerjaan (detik)': a.started_at && (a.finished_at || a.server_now) ? Math.max(0, Math.floor((Date.parse(a.finished_at || a.server_now!) - Date.parse(a.started_at)) / 1000)) : '-',
                'Mulai': date(a.started_at),
                'Selesai': date(a.finished_at),
            };
        });

        const wsHasil = XLSX.utils.json_to_sheet(rowsHasil);
        wsHasil['!cols'] = Object.keys(rowsHasil[0]).map(key => ({ wch: /Nama|Penilaian|Status|Tenggat|Simpan|Mulai|Selesai/.test(key) ? 30 : 20 }));
        XLSX.utils.book_append_sheet(wb, wsHasil, 'Rekap_Hasil');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SHEET 2: Jawaban_Siswa — identitas, soal/opsi/kunci, lalu jawaban siswa
    // ─────────────────────────────────────────────────────────────────────────────
    const matrixRows = detailedAnalysis?.matrix;
    const itemsList = detailedAnalysis?.items?.length
        ? detailedAnalysis.items
        : analysis.map((a, i) => ({
              id: a.id,
              number: a.number ?? i + 1,
              question_text: a.qText,
              type: a.type,
              key_display: a.keyDisplay || '-',
              score_default: 1,
              options: a.options || [],
          }));

    if (matrixRows?.length && itemsList?.length) {
        const sortedItems = [...itemsList].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
        const questionHeaders = sortedItems.map((question) => {
            const options = (question.options || [])
                .map((option, index) => {
                    const text = cleanHtml(option.option_text || option.text || '');
                    return text ? `${String.fromCharCode(65 + index)}. ${text}` : '';
                })
                .filter(Boolean)
                .join('\n');
            const questionText = cleanHtml(question.question_text).substring(0, 180);
            return `Soal Nomor ${question.number} [${String(question.type || 'soal').toUpperCase()}]\n${questionText}${options ? `\nOpsi:\n${options}` : ''}`;
        });

        const aoaData: Array<Array<string | number>> = [
            [`DATA JAWABAN SISWA — ${examTitle}`],
            [`Kunci dan jawaban ditampilkan sesuai jenis soal. Diekspor ${date(generatedAt)} (${timeZone}).`],
            [],
            ['Nama', 'Kelas', ...questionHeaders],
            ['Keterangan', 'Kunci jawaban →', ...sortedItems.map((question) => `Kunci: ${cleanHtml(question.key_display || '-')}`)],
        ];

        matrixRows.forEach((student) => {
            const row: Array<string | number> = [
                student.student_name,
                student.class_name || '-',
            ];
            sortedItems.forEach((question) => {
                const cell = student.items[question.id];
                const status = !cell || cell.status === 'unanswered'
                    ? 'Tidak menjawab'
                    : cell.status === 'correct'
                    ? 'Benar'
                    : cell.status === 'wrong'
                    ? 'Salah'
                    : 'Belum dinilai';
                const answer = cleanHtml(cell?.display_answer || '-') || '-';
                row.push(
                    `Jawaban: ${answer}\nStatus: ${status}\nSkor: ${cell?.status === 'ungraded' || attemptById.get(student.attempt_id)?.total_score == null ? 'Menunggu penilaian' : Number(cell?.score || 0).toFixed(2)} / ${Number(question.score_default || 1).toFixed(2)}`,
                );
            });
            aoaData.push(row);
        });

        const wsMatrix = XLSX.utils.aoa_to_sheet(aoaData);
        const lastColumn = XLSX.utils.encode_col(sortedItems.length + 1);
        wsMatrix['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: sortedItems.length + 1 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: sortedItems.length + 1 } },
        ];
        wsMatrix['!cols'] = [
            { wch: 28 },
            { wch: 16 },
            ...sortedItems.map(() => ({ wch: 42 })),
        ];
        wsMatrix['!rows'] = [
            { hpt: 28 },
            { hpt: 22 },
            { hpt: 8 },
            { hpt: 120 },
            { hpt: 38 },
            ...matrixRows.map(() => ({ hpt: 54 })),
        ];
        wsMatrix['!autofilter'] = { ref: `A4:${lastColumn}${aoaData.length}` };
        wsMatrix['!freeze'] = { xSplit: 2, ySplit: 5 };

        const setStyle = (row: number, column: number, style: Record<string, unknown>) => {
            const address = XLSX.utils.encode_cell({ r: row, c: column });
            const cell = wsMatrix[address];
            if (cell) (cell as typeof cell & { s: Record<string, unknown> }).s = style;
        };
        const border = {
            top: { style: 'thin', color: { rgb: 'D7E3F4' } },
            bottom: { style: 'thin', color: { rgb: 'D7E3F4' } },
            left: { style: 'thin', color: { rgb: 'D7E3F4' } },
            right: { style: 'thin', color: { rgb: 'D7E3F4' } },
        };
        for (let column = 0; column < sortedItems.length + 2; column++) {
            setStyle(3, column, {
                font: { bold: true, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: '2563EB' } },
                alignment: { wrapText: true, vertical: 'top', horizontal: column < 2 ? 'center' : 'left' },
                border,
            });
            setStyle(4, column, {
                font: { bold: true, color: { rgb: '92400E' } },
                fill: { fgColor: { rgb: 'FEF3C7' } },
                alignment: { wrapText: true, vertical: 'center' },
                border,
            });
        }
        setStyle(0, 0, {
            font: { bold: true, size: 16, color: { rgb: 'FFFFFF' } },
            fill: { fgColor: { rgb: '1E3A8A' } },
            alignment: { horizontal: 'center', vertical: 'center' },
        });
        setStyle(1, 0, {
            font: { italic: true, color: { rgb: '475569' } },
            fill: { fgColor: { rgb: 'EFF6FF' } },
            alignment: { horizontal: 'center' },
        });
        for (let row = 5; row < aoaData.length; row++) {
            for (let column = 0; column < sortedItems.length + 2; column++) {
                setStyle(row, column, {
                    fill: { fgColor: { rgb: row % 2 === 0 ? 'F8FAFC' : 'FFFFFF' } },
                    alignment: { wrapText: true, vertical: 'top' },
                    border,
                });
            }
        }

        XLSX.utils.book_append_sheet(wb, wsMatrix, 'Jawaban_Siswa');
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // SHEET 3: Analisis_Butir_Soal
    // ─────────────────────────────────────────────────────────────────────────────
    if (detailedAnalysis?.items?.length || analysis?.length) {
        const sourceItems = detailedAnalysis?.items?.length
            ? detailedAnalysis.items
            : analysis.map((a, idx) => ({
                  id: a.id,
                  number: a.number ?? idx + 1,
                  type: a.type,
                  question_text: a.qText,
                  key_display: a.keyDisplay || '-',
                  total_answered: a.total,
                  total_participants: attempts.filter(attempt => attempt.status !== 'belum').length,
                  total_unanswered: Math.max(0, attempts.filter(attempt => attempt.status !== 'belum').length - a.total),
                  total_correct: a.correct,
                  total_incorrect: a.incorrect,
                  total_ungraded: a.ungraded ?? 0,
                  incorrect_percentage: a.incorrectPercentage,
                  difficulty_label: a.difficultyLabel || '-',
                  discrimination_label: a.discriminationLabel || '-',
                  difficulty_index: a.difficultyIndex ?? 0,
                  discrimination_index: a.discriminationIndex ?? 0,
                  correct_students: Array.isArray(a.correctStudents) ? a.correctStudents : [],
                  wrong_students: Array.isArray(a.wrongStudents) ? a.wrongStudents : [],
              }));

        const sortedAnalysis = [...sourceItems].sort(
            (a, b) => (a.number ?? 0) - (b.number ?? 0),
        );

        const rowsAnalisis = sortedAnalysis.map((item) => {
            const correctNames = (item.correct_students || [])
                .map((s: StudentAnswerSummary | string) => {
                    const name = typeof s === 'string' ? s : (s?.student_name || '');
                    const cls = typeof s === 'object' && s?.class_name && s.class_name !== '-' ? ` (${s.class_name})` : '';
                    return `${name}${cls}`;
                })
                .filter(Boolean)
                .join(', ');
            const wrongNames = (item.wrong_students || [])
                .map((s: StudentAnswerSummary | string) => {
                    const name = typeof s === 'string' ? s : (s?.student_name || '');
                    const cls = typeof s === 'object' && s?.class_name && s.class_name !== '-' ? ` (${s.class_name})` : '';
                    return `${name}${cls}`;
                })
                .filter(Boolean)
                .join(', ');

            return {
                'No': item.number,
                'Tipe Soal': (item.type || 'mcq').toUpperCase(),
                'Teks Soal': cleanHtml(item.question_text).substring(0, 200),
                'Kunci Jawaban': cleanHtml(item.key_display || '-'),
                'Menjawab': item.total_answered,
                'Benar': item.total_correct,
                'Salah': item.total_incorrect,
                'Belum Ternilai': item.total_ungraded ?? 0,
                'Kosong': item.total_unanswered,
                '% Benar (peserta mulai)': item.total_participants ? (item.total_correct / item.total_participants * 100).toFixed(1) + '%' : '-',
                '% Kosong (peserta mulai)': item.total_participants ? (item.total_unanswered / item.total_participants * 100).toFixed(1) + '%' : '-',
                '% Salah': item.incorrect_percentage.toFixed(1) + '%',
                'Tingkat Kesukaran': item.difficulty_label ? item.difficulty_label.toUpperCase() : '-',
                'Indeks Kesukaran (P)': item.difficulty_index != null ? Number(item.difficulty_index).toFixed(3) : '-',
                'Daya Beda': item.discrimination_label ? item.discrimination_label.toUpperCase() : '-',
                'Indeks Daya Beda (D)': item.discrimination_index != null ? Number(item.discrimination_index).toFixed(3) : '-',
                'Daftar Siswa Benar': correctNames || '-',
                'Daftar Siswa Salah': wrongNames || '-',
            };
        });

        const wsAnalisis = XLSX.utils.json_to_sheet(rowsAnalisis);
        wsAnalisis['!cols'] = Object.keys(rowsAnalisis[0]).map(key => ({ wch: /Soal|Siswa|Jawaban/.test(key) ? 45 : 20 }));
        XLSX.utils.book_append_sheet(wb, wsAnalisis, 'Analisis_Butir_Soal');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SHEET 4: Distribusi_Pengecoh (Khusus Pilihan Ganda)
    // ─────────────────────────────────────────────────────────────────────────────
    const mcqItems = detailedAnalysis?.items?.filter(
        (it) => (it.type || '').toLowerCase() === 'mcq' && it.distractor_distribution?.length,
    );

    if (mcqItems?.length) {
        const rowsDistraktor = mcqItems.map((it) => {
            const rowObj: Record<string, string | number> = {
                'No Soal': it.number,
                'Teks Soal': cleanHtml(it.question_text).substring(0, 150),
                'Kunci': it.key_display || '-',
                'Total Menjawab': it.total_answered,
            };

            it.distractor_distribution.forEach((opt) => {
                const colHeaderCount = `Opsi ${opt.option_letter} (${opt.is_correct ? 'KUNCI' : 'Pengecoh'})`;
                const colHeaderNames = `Pemilih Opsi ${opt.option_letter}`;
                rowObj[colHeaderCount] = `${opt.count} (${opt.percentage.toFixed(1)}%)`;
                rowObj[colHeaderNames] = (opt.student_names || []).join(', ') || '-';
            });

            return rowObj;
        });

        const wsDistraktor = XLSX.utils.json_to_sheet(rowsDistraktor);
        wsDistraktor['!cols'] = [
            { wch: 8 },
            { wch: 45 },
            { wch: 15 },
            { wch: 14 },
            { wch: 22 },
            { wch: 40 },
            { wch: 22 },
            { wch: 40 },
            { wch: 22 },
            { wch: 40 },
            { wch: 22 },
            { wch: 40 },
            { wch: 22 },
            { wch: 40 },
        ];
        XLSX.utils.book_append_sheet(wb, wsDistraktor, 'Distribusi_Pengecoh');
    }

    for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name];
        if (name !== 'Jawaban_Siswa') {
            for (const address of Object.keys(sheet).filter(key => !key.startsWith('!'))) {
                const cell = sheet[address];
                cell.s = { ...cell.s, alignment: { ...cell.s?.alignment, wrapText: true, vertical: 'top' } };
            }
        }
    }
    return wb;
}

export async function exportDetailedAnalysisToExcel(options: ExportAnalysisOptions) {
    const wb = await buildAnalysisWorkbook(options);
    const XLSX = await import('xlsx-js-style');
    const safeTitle = (options.exam?.title || 'Ujian').replace(/[^a-z0-9]/gi, '_');
    XLSX.writeFile(wb, `Hasil_dan_Jawaban_${safeTitle}.xlsx`, { cellStyles: true });
}
