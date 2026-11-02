import type { LearningMaterial } from './learning-api';

export const learningGrades = [
    { value: '10', label: 'Kelas X' }, { value: '11', label: 'Kelas XI' },
    { value: '12', label: 'Kelas XII' }, { value: '', label: 'Umum' },
];
export const learningKey = (value?: string) => (value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
export const learningGradeLabel = (grade?: string) => learningGrades.find(item => item.value === (grade || ''))?.label || `Kelas ${grade}`;
export const chapterKey = (item: Pick<LearningMaterial, 'grade_level' | 'subject' | 'topic'>) =>
    JSON.stringify([item.grade_level || '', learningKey(item.subject), learningKey(item.topic)]);
export function compareSubchapters(a: LearningMaterial, b: LearningMaterial) {
    const order = (a.subtopic_order || Number.MAX_SAFE_INTEGER) - (b.subtopic_order || Number.MAX_SAFE_INTEGER);
    return order || (a.subtopic || a.title).localeCompare(b.subtopic || b.title, 'id', { numeric: true }) || a.id.localeCompare(b.id);
}
export interface LearningChapter {
    key: string; grade: string; subject: string; title: string; items: LearningMaterial[]; completed: number;
}
export function groupLearningChapters(materials: LearningMaterial[]): LearningChapter[] {
    const chapters = new Map<string, LearningChapter>();
    for (const item of materials) {
        const key = chapterKey(item);
        if (!chapters.has(key)) chapters.set(key, { key, grade: item.grade_level || '', subject: item.subject?.trim() || 'Umum', title: item.topic?.trim() || 'Belum dikelompokkan', items: [], completed: 0 });
        const chapter = chapters.get(key)!;
        chapter.items.push(item);
        if (item.completed) chapter.completed++;
    }
    const rank = (grade: string) => { const index = learningGrades.findIndex(item => item.value === grade); return index < 0 ? 4 : index; };
    return [...chapters.values()].map(chapter => ({ ...chapter, items: chapter.items.sort(compareSubchapters) }))
        .sort((a, b) => rank(a.grade) - rank(b.grade) || a.grade.localeCompare(b.grade, 'id', { numeric: true }) || a.subject.localeCompare(b.subject, 'id') || a.title.localeCompare(b.title, 'id', { numeric: true }));
}
