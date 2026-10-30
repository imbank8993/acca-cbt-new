export interface QuestionGroupOption { name: string; count: number }
type GroupQuestion = { metadata?: Record<string, unknown> | null; stimulus_id?: string | null; stimulus?: { id?: string } | null };

export function normalizeQuestionGroup(value: string): string { return value.trim().toLowerCase(); }

export function collectQuestionGroups(questions: GroupQuestion[]): QuestionGroupOption[] {
    const groups = new Map<string, QuestionGroupOption>();
    for (const question of questions) {
        const name = typeof question.metadata?.group_key === 'string' ? question.metadata.group_key.trim() : '';
        if (!name) continue;
        const key = normalizeQuestionGroup(name);
        const group = groups.get(key);
        if (group) group.count++;
        else groups.set(key, { name, count: 1 });
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));
}

export function questionGroupLabel(question: GroupQuestion, questions: GroupQuestion[], groups: QuestionGroupOption[]): string | null {
    const manual = typeof question.metadata?.group_key === 'string' ? question.metadata.group_key.trim() : '';
    if (manual) {
        const group = groups.find(group => normalizeQuestionGroup(group.name) === normalizeQuestionGroup(manual));
        return `Grup ${group?.name || manual} · ${group?.count || 1} soal`;
    }
    const stimulusId = question.stimulus?.id || question.stimulus_id;
    if (!stimulusId) return null;
    const count = questions.filter(item => {
        const hasManualGroup = typeof item.metadata?.group_key === 'string' && item.metadata.group_key.trim();
        return !hasManualGroup && (item.stimulus?.id || item.stimulus_id) === stimulusId;
    }).length;
    return count > 1 ? `Grup stimulus · ${count} soal` : null;
}
