import { assertAnswerKeysReleased } from '../common/answer-key-release';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { loadFrozenExamQuestions } from '../common/exam-question-snapshots';
import { isScoreExcluded } from '../common/score-exclusion';
import { examUsesQuestionGroups, orderQuestionsForStudent } from '../common/question-order';
import { DbService } from '../prisma/prisma-db-adapter';

/**
 * Label tipe soal untuk rincian "per tipe" di ringkasan review.
 * Disalin dari `apps/web/app/types/review.ts` supaya teksnya tetap sama.
 */
const QUESTION_TYPE_LABELS: Record<string, string> = {
    mcq: 'Pilihan Ganda',
    mcq_complex: 'PG Kompleks',
    true_false: 'Benar/Salah',
    essay: 'Esai',
    uraian: 'Esai',
    short_answer: 'Isian Singkat',
    matching: 'Menjodohkan',
    categorization: 'Pengelompokan',
    sjt: 'SJT',
    ordering: 'Pengurutan',
    likert: 'Skala Likert',
    forced_choice: 'Forced-Choice',
    checklist: 'Checklist',
    ranking: 'Ranking',
    paired_comparison: 'Paired Comparison',
};

/** Hanya `grade` dan `label` yang menyeberang ke frontend; kelas warna urusan tampilan. */
function gradeOf(percentage: number): { grade: string; label: string } {
    if (percentage >= 90) return { grade: 'A', label: 'Sangat Baik' };
    if (percentage >= 80) return { grade: 'B', label: 'Baik' };
    if (percentage >= 70) return { grade: 'C', label: 'Cukup' };
    if (percentage >= 60) return { grade: 'D', label: 'Kurang' };
    return { grade: 'E', label: 'Sangat Kurang' };
}

/**
 * Review hasil ujian untuk siswa: jawabannya sendiri berikut kunci jawaban.
 *
 * Dipindahkan dari `apps/web/app/actions/exam-review.ts`. Versi asalnya
 * menyaring `.eq('user_id', userId)` memakai userId kiriman browser —
 * penyaringnya konsisten, tetapi tidak membuktikan pemanggil MEMANG orang itu.
 * Cukup kirim attemptId dan UUID siswa lain untuk memperoleh seluruh jawabannya
 * berikut kunci jawabannya, karena `is_correct` tiap opsi ikut dikembalikan.
 *
 * Di sini identitas datang dari token, dan pemilik pengerjaan dibandingkan
 * dengan `user.id`. Staf ujian tetap boleh melihat, lewat `assertExamStaff`.
 *
 * DAFTAR SOALNYA TIDAK LAGI DARI `cbt_exam_attempt_questions`. Tabel itu kosong
 * sama sekali di basis data dan tidak ada satu pun INSERT ke sana di seluruh
 * kode — ia hanya pernah dibaca. Akibatnya review ini SELALU menampilkan 0 soal,
 * skor 0, nilai E, untuk setiap siswa dan setiap ujian; fiturnya tidak pernah
 * benar-benar berfungsi.
 *
 * Sumbernya sekarang sama dengan sumber yang dipakai saat ujian berlangsung:
 * seluruh soal di bank milik ujian, diurutkan lewat `orderQuestionsForStudent`
 * sehingga nomor soal di review cocok dengan nomor soal yang dikerjakan siswa.
 */
@Injectable()
export class ExamReviewService {
    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    async getReview(user: AuthUser, attemptId: string) {
        const { data: attempt } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `*,
                exams:cbt_exams (
                    *,
                    subjects:cbt_subjects (name)
                )`,
            )
            .eq('id', attemptId)
            .maybeSingle();

        if (!attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');

        const record = attempt as any;

        // Pemilik pengerjaan boleh melihat miliknya sendiri; staf boleh melihat
        // pengerjaan pada ujian yang menjadi tanggung jawabnya.
        if (record.user_id !== user.id) {
            await this.authz.assertExamStaff(user, record.exam_id);
        }

        if (record.user_id === user.id && !['submitted', 'auto_submitted'].includes(record.status)) {
            throw new ForbiddenException('Review hanya tersedia setelah pengerjaan selesai.');
        }

        if (!record.exams?.show_results) {
            throw new ForbiddenException('Hasil ujian ini belum dibuka oleh guru.');
        }

        if (record.user_id === user.id) await assertAnswerKeysReleased(this.db, record.exams);

        // Soal diambil dari bank milik ujian — sumber yang sama dengan yang
        // dibaca layar ujian. Soal yang TIDAK dijawab ikut terbawa, sehingga
        // `unansweredCount` bisa terisi; menyusunnya dari `cbt_answers` saja
        // akan membuat soal kosong hilang sama sekali dari review.
        const bankQuestions = await loadFrozenExamQuestions(
            this.db,
            record.exam_id,
            record.exams?.question_bank_id,
        );

        const orderedQuestions = orderQuestionsForStudent(bankQuestions, {
            userId: record.user_id,
            examId: record.exam_id,
            randomize: record.exams?.randomize_questions,
            groups: examUsesQuestionGroups(record.exams?.metadata),
        });

        const { data: answers } = await this.db
            .from('cbt_answers')
            .select('*')
            .eq('attempt_id', attemptId);

        const answerMap = new Map<string, any>();
        ((answers as any[]) || []).forEach((a) => answerMap.set(a.question_id, a));

        const questions: any[] = [];
        let totalCorrect = 0;
        let totalIncorrect = 0;
        let totalUnanswered = 0;
        let totalPartial = 0;
        let totalScore = 0;
        let maxScore = 0;

        const typeStats = new Map<string, { total: number; correct: number }>();
        const difficultyStats = new Map<string, { total: number; correct: number }>();

        orderedQuestions.forEach((question: any, index) => {
            const answer = answerMap.get(question.id);
            const options = question.bank_question_options || [];

            let status = 'unanswered';
            let scoreObtained = 0;
            let selectedOptionText: string | undefined;

            // Poin yang BENAR-BENAR diberikan mesin penilaian, bukan hitungan
            // ulang. Versi lama memberi `score_default` penuh untuk setiap PG
            // yang benar, dan hasilnya meleset dari nilai resmi siswa: 57 dari
            // 79 (72%, nilai C) padahal nilainya 61 dari 79 (77,22%, nilai B).
            // Siswa melihat huruf mutu yang berbeda dari rapornya.
            const awarded = answer?.score != null ? Number(answer.score) || 0 : null;
            const correctOptions = options.filter((o: any) => o.is_correct);
            const correctOptionId = correctOptions[0]?.id;

            if (answer?.selected_option_id) {
                selectedOptionText = options.find(
                    (o: any) => o.id === answer.selected_option_id,
                )?.option_text;
            }

            const qtype = String(question.type).toLowerCase();
            // Soal dibatalkan tetap ditampilkan, tetapi tidak masuk skor maupun skor maksimum.
            const excluded = isScoreExcluded(question);
            if (excluded) status = 'voided';
            const academic = !excluded && !['likert', 'sjt', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'].includes(qtype);
            const maximum = Math.max(Number(question.score_default ?? 1), 0);
            if (academic) {
                scoreObtained = awarded ?? (answer?.is_correct === true ? maximum : 0);
                if (answer?.is_correct === true && scoreObtained >= maximum) {
                    status = 'correct';
                    totalCorrect++;
                } else if (scoreObtained > 0) {
                    status = 'partial';
                    totalPartial++;
                } else if (answer?.is_correct === false) {
                    status = 'incorrect';
                    totalIncorrect++;
                } else {
                    totalUnanswered++;
                }
                totalScore += scoreObtained;
                maxScore += maximum;
            }

            const formattedOptions = options.map((o: any) => ({
                id: o.id,
                text: o.option_text,
                isCorrect: o.is_correct,
                isSelected: o.id === answer?.selected_option_id,
            }));

            const qType = question.type as string;
            if (!typeStats.has(qType)) typeStats.set(qType, { total: 0, correct: 0 });
            const typeData = typeStats.get(qType)!;
            typeData.total++;
            if (status === 'correct') typeData.correct++;

            const qDifficulty = question.difficulty || 'medium';
            if (!difficultyStats.has(qDifficulty)) {
                difficultyStats.set(qDifficulty, { total: 0, correct: 0 });
            }
            const diffData = difficultyStats.get(qDifficulty)!;
            diffData.total++;
            if (status === 'correct') diffData.correct++;

            questions.push({
                // Dulu id baris `cbt_exam_attempt_questions`. Tabel itu tidak
                // dipakai lagi; id soal sama-sama unik dalam satu review dan
                // itulah yang dibutuhkan frontend sebagai kunci daftar.
                id: question.id,
                questionId: question.id,
                questionNumber: index + 1,
                questionText: question.question_text,
                questionType: qType,
                scoreDefault: excluded ? 0 : question.score_default ?? 1,
                scoreObtained,
                status,
                scoreExcluded: excluded,
                selectedOptionId: answer?.selected_option_id,
                selectedOptionText,
                essayAnswer: answer?.essay_answer,
                correctOptionId,
                correctOptionText: correctOptions[0]?.option_text,
                correctOptions: correctOptions.map((o: any) => ({
                    id: o.id,
                    text: o.option_text,
                })),
                options: formattedOptions,
                metadata: {
                    image_url: question.metadata?.image_url,
                    explanation: question.metadata?.explanation,
                    difficulty: question.difficulty,
                    topic: question.metadata?.topic,
                },
            });
        });

        const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
        const gradeInfo = gradeOf(percentage);

        const byType = Array.from(typeStats.entries()).map(([type, data]) => ({
            type,
            label: QUESTION_TYPE_LABELS[type] || type,
            total: data.total,
            correct: data.correct,
            percentage: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
        }));

        const byDifficulty = Array.from(difficultyStats.entries()).map(([difficulty, data]) => ({
            difficulty,
            total: data.total,
            correct: data.correct,
            percentage: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
        }));

        const timeSpentSeconds =
            record.finished_at && record.started_at
                ? Math.floor(
                      (new Date(record.finished_at).getTime() -
                          new Date(record.started_at).getTime()) /
                          1000,
                  )
                : 0;

        return {
            attemptId: record.id,
            examId: record.exams?.id,
            examTitle: record.exams?.title || 'Ujian',
            subjectName: record.exams?.subjects?.name,
            startedAt: record.started_at,
            finishedAt: record.finished_at,
            submittedAt: record.finished_at,
            showCorrectAnswers: true,
            showExplanations: true,
            showTimeSpent: true,
            summary: {
                totalQuestions: questions.length,
                correctCount: totalCorrect,
                incorrectCount: totalIncorrect,
                unansweredCount: totalUnanswered,
                partialCount: totalPartial,
                totalScore,
                maxScore,
                percentage,
                grade: gradeInfo.grade,
                gradeLabel: gradeInfo.label,
                timeSpentSeconds: Math.floor(timeSpentSeconds),
                averageTimePerQuestion:
                    questions.length > 0 ? Math.floor(timeSpentSeconds / questions.length) : 0,
                byType,
                byDifficulty,
                comparedToAverage: 0,
                percentile: 0,
            },
            questions,
        };
    }
}
