import type {
    DetailedItemAnalysisResponse,
    ExamAttemptRecord,
    OrganizationExam,
    StudentAnswerSummary,
} from './api/proctor';
import type { QuestionOptionRecord } from './api/questions';

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

export async function exportDetailedAnalysisToExcel({
    exam,
    attempts,
    analysis,
    detailedAnalysis,
}: ExportAnalysisOptions) {
    if (!attempts?.length && !analysis?.length && !detailedAnalysis?.items?.length) {
        alert('Tidak ada data untuk diekspor');
        return;
    }

    // `xlsx-js-style` mempertahankan API SheetJS yang sudah digunakan aplikasi,
    // sekaligus benar-benar menulis font, warna, border, dan alignment ke berkas.
    const XLSX = await import('xlsx-js-style');
    const wb = XLSX.utils.book_new();

    const examTitle = exam?.title || 'Ujian';
    const safeTitle = examTitle.replace(/[^a-z0-9]/gi, '_');

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
                    ? 'Terminated / Auto'
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
                'Nilai Klasik': a.status === 'belum' ? '-' : Number(a.detailed_scores?.classical ?? a.total_score ?? 0).toFixed(2),
                'Nilai IRT': a.detailed_scores?.irt_1pl != null
                    ? Number(a.detailed_scores.irt_1pl).toFixed(2)
                    : a.score_irt != null
                    ? Number(a.score_irt).toFixed(2)
                    : '-',
                'Pelanggaran Total': a.warning_count ?? 0,
                'Pindah Tab': bd.pindah_tab,
                'Close Tab': bd.close_tab,
                'Pelanggaran Lain': bd.lainnya,
                'Mulai': a.started_at ? new Date(a.started_at).toLocaleString('id-ID') : '-',
                'Selesai': a.finished_at ? new Date(a.finished_at).toLocaleString('id-ID') : '-',
            };
        });

        const wsHasil = XLSX.utils.json_to_sheet(rowsHasil);
        wsHasil['!cols'] = [
            { wch: 5 },
            { wch: 30 },
            { wch: 15 },
            { wch: 15 },
            { wch: 18 },
            { wch: 12 },
            { wch: 12 },
            { wch: 15 },
            { wch: 12 },
            { wch: 12 },
            { wch: 15 },
            { wch: 20 },
            { wch: 20 },
        ];
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
            [`Kunci dan jawaban ditampilkan sesuai jenis soal. Diekspor ${new Date().toLocaleString('id-ID')}.`],
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
                    `Jawaban: ${answer}\nStatus: ${status}\nSkor: ${Number(cell?.score || 0).toFixed(2)} / ${Number(question.score_default || 1).toFixed(2)}`,
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
        wsAnalisis['!cols'] = [
            { wch: 5 },
            { wch: 12 },
            { wch: 50 },
            { wch: 25 },
            { wch: 10 },
            { wch: 8 },
            { wch: 8 },
            { wch: 13 },
            { wch: 10 },
            { wch: 18 },
            { wch: 18 },
            { wch: 15 },
            { wch: 18 },
            { wch: 60 },
            { wch: 60 },
        ];
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

    // ─────────────────────────────────────────────────────────────────────────────
    // SHEET 5: Detail_Transkrip_Respon (Detail Respon Per Siswa & Soal)
    // ─────────────────────────────────────────────────────────────────────────────
    if (detailedAnalysis?.matrix?.length && detailedAnalysis?.items?.length) {
        const rowsTranscript: Array<Record<string, string | number>> = [];

        detailedAnalysis.matrix.forEach((stu) => {
            detailedAnalysis.items.forEach((q) => {
                const cell = stu.items[q.id];
                const statusLabel =
                    !cell || cell.status === 'unanswered'
                        ? 'Tidak Menjawab'
                        : cell.status === 'correct'
                        ? 'Benar'
                        : cell.status === 'wrong'
                        ? 'Salah'
                        : 'Belum Ternilai';

                rowsTranscript.push({
                    'Nama Siswa': stu.student_name,
                    'NIS / ID': stu.student_nis || '-',
                    'Kelas': stu.class_name || '-',
                    'No Soal': q.number,
                    'Tipe Soal': (q.type || 'mcq').toUpperCase(),
                    'Kunci Jawaban': cleanHtml(q.key_display || '-'),
                    'Jawaban Siswa': cleanHtml(cell?.display_answer || '-'),
                    'Status': statusLabel,
                    'Skor Diperoleh': cell ? Number(cell.score || 0).toFixed(2) : '0.00',
                    'Skor Maks': Number(q.score_default || 1).toFixed(2),
                });
            });
        });

        if (rowsTranscript.length > 0) {
            const wsTranscript = XLSX.utils.json_to_sheet(rowsTranscript);
            wsTranscript['!cols'] = [
                { wch: 28 },
                { wch: 15 },
                { wch: 12 },
                { wch: 8 },
                { wch: 12 },
                { wch: 25 },
                { wch: 30 },
                { wch: 15 },
                { wch: 12 },
                { wch: 10 },
            ];
            XLSX.utils.book_append_sheet(wb, wsTranscript, 'Detail_Transkrip_Respon');
        }
    }

    if (wb.SheetNames.includes('Jawaban_Siswa')) {
        wb.SheetNames = [
            'Jawaban_Siswa',
            ...wb.SheetNames.filter((name) => name !== 'Jawaban_Siswa'),
        ];
    }
    XLSX.writeFile(wb, `Hasil_dan_Jawaban_${safeTitle}.xlsx`, { cellStyles: true });
}
