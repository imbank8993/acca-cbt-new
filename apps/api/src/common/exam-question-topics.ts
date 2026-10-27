import { BadRequestException } from '@nestjs/common';
import { questionTopic, type TopicQuestion } from '@acca-cbt/shared';
import type { DbSession } from '../prisma/prisma-db-adapter';
import { chunk } from './chunk';

/** Older snapshots omitted the syllabus link. Resolve labels without changing keys or scores. */
export async function withQuestionTopics<T extends TopicQuestion>(db: DbSession, questions: T[]): Promise<Array<T & { topic: string | null }>> {
    const missing = questions.filter(question => !questionTopic(question)).map(question => question.id);
    const currentTopics = new Map<string, string>();
    for (const ids of chunk(missing, 300)) {
        const { data, error } = await db.from('cbt_bank_questions')
            .select('id, type, metadata, kisi_kisi:cbt_question_kisi_kisi(materi)')
            .in('id', ids);
        if (error) throw new BadRequestException('Materi soal belum dapat dimuat.');
        for (const question of (data || []) as TopicQuestion[]) {
            const topic = questionTopic(question);
            if (topic) currentTopics.set(question.id, topic);
        }
    }
    return questions.map(question => ({ ...question, topic: questionTopic(question) || currentTopics.get(question.id) || null }));
}
