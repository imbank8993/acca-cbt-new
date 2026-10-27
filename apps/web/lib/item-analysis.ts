import type { ExamAttemptRecord, ItemAnalysis, StudentAnswerSummary, getExamAnswersForAnalysisAction } from '@/lib/api/proctor';
import { formatStudentName } from '@/lib/monitoring-health';

export type ExamAnalysisData = Awaited<ReturnType<typeof getExamAnswersForAnalysisAction>>;

/**
 * Analisis butir soal untuk tab Analisis monitoring.
 *
 * Memakai analisis rinci dari layanan penilaian bila tersedia; bila belum,
 * dihitung dari jawaban mentah. Hasil diurutkan dari % salah tertinggi.
 */
export function buildItemAnalysis(data: ExamAnalysisData, attempts: ExamAttemptRecord[]): ItemAnalysis[] {
    const byIncorrect = (a: ItemAnalysis, b: ItemAnalysis) =>
        (b.incorrectPercentage - a.incorrectPercentage) || ((a.number || 0) - (b.number || 0));

    if (data.detailed?.items?.length) {
        return data.detailed.items.map((item): ItemAnalysis => ({
            id: item.id,
            topic: data.questions.find(question => question.id === item.id)?.topic,
            number: item.number,
            qText: item.question_text,
            type: item.type,
            options: item.options || [],
            total: item.total_answered,
            correct: item.total_correct,
            incorrect: item.total_incorrect,
            ungraded: item.total_ungraded,
            unanswered: item.total_unanswered,
            keyDisplay: item.key_display,
            difficultyIndex: item.difficulty_index,
            difficultyLabel: item.difficulty_label,
            discriminationIndex: item.discrimination_index,
            discriminationLabel: item.discrimination_label,
            wrongStudents: item.wrong_students || [],
            correctStudents: item.correct_students || [],
            ungradedStudents: item.ungraded_students || [],
            unansweredStudents: item.unanswered_students || [],
            distractorDistribution: item.distractor_distribution || [],
            incorrectPercentage: item.incorrect_percentage,
        })).sort(byIncorrect);
    }

    // Cadangan bila layanan analisis belum mengembalikan data rinci.
    const studentByAttempt = new Map<string, { name: string; class: string; nis: string }>();
    attempts.forEach(attempt => {
        studentByAttempt.set(attempt.id, {
            name: formatStudentName(attempt.profiles?.full_name, 'Tanpa Nama'),
            class: attempt.kelas_name || '-',
            nis: attempt.profiles?.identity_number || '-',
        });
    });

    const stats: Record<string, {
        total: number; correct: number; incorrect: number; ungraded: number;
        wrongStudents: StudentAnswerSummary[]; correctStudents: StudentAnswerSummary[];
    }> = {};
    data.answers.forEach(answer => {
        const questionId = answer.question_id;
        if (!stats[questionId]) stats[questionId] = { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
        const stat = stats[questionId];
        stat.total += 1;
        const student = studentByAttempt.get(answer.attempt_id ?? '') || { name: 'Tanpa Nama', class: '-', nis: '-' };
        const summary: StudentAnswerSummary = {
            attempt_id: answer.attempt_id ?? '',
            student_name: student.name,
            class_name: student.class,
            student_nis: student.nis,
            score: answer.score != null ? Number(answer.score) : (answer.is_correct ? 1 : 0),
            display_answer: answer.selected_option_id || (typeof answer.essay_answer === 'string' ? answer.essay_answer : '-'),
            is_correct: answer.is_correct ?? null,
        };
        if (answer.is_correct === true) {
            stat.correct += 1;
            stat.correctStudents.push(summary);
        } else if (answer.is_correct === false) {
            stat.incorrect += 1;
            stat.wrongStudents.push(summary);
        } else {
            stat.ungraded += 1;
        }
    });

    return data.questions.map((question): ItemAnalysis => {
        const stat = stats[question.id] || { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
        const graded = stat.correct + stat.incorrect;
        return {
            id: question.id,
            topic: question.topic,
            number: question.number ?? 0,
            qText: question.question_text,
            type: question.type,
            options: question.options || [],
            total: stat.total,
            correct: stat.correct,
            incorrect: stat.incorrect,
            ungraded: stat.ungraded,
            wrongStudents: [...stat.wrongStudents].sort((a, b) => a.student_name.localeCompare(b.student_name)),
            correctStudents: [...stat.correctStudents].sort((a, b) => a.student_name.localeCompare(b.student_name)),
            incorrectPercentage: graded > 0 ? (stat.incorrect / graded) * 100 : 0,
        };
    }).sort(byIncorrect);
}
