export const CORRECTABLE_QUESTION_TYPES = ['mcq', 'mcq_complex', 'true_false', 'matching', 'categorization', 'short_answer', 'ordering'];
export interface KeyQuestion {
    id: string; type: string; metadata?: Record<string, any> | null;
    bank_question_options?: Array<{ id: string; is_correct?: boolean | null; order?: number; metadata?: Record<string, any> | null; [key: string]: unknown }>;
    [key: string]: unknown;
}
export function examQuestionKey(question: KeyQuestion): string {
    const options = question.bank_question_options || [];
    switch (question.type) {
        case 'mcq': return options.find(option => option.is_correct)?.id || '';
        case 'mcq_complex': return JSON.stringify(options.filter(option => option.is_correct).map(option => option.id));
        case 'true_false': return JSON.stringify(Object.fromEntries(options.map(option => [option.id, option.is_correct])));
        case 'matching': case 'categorization': {
            const multi = question.type === 'matching' ? 'match_texts' : 'category_names';
            const single = question.type === 'matching' ? 'match_text' : 'category_name';
            return JSON.stringify(Object.fromEntries(options.map(option => [option.id,
                option.metadata?.[multi] || (option.metadata?.[single] ? [option.metadata[single]] : [])])));
        }
        case 'short_answer': return JSON.stringify((question.metadata?.blanks || []).map((blank: any) => blank.answer || ''));
        case 'ordering': return JSON.stringify(question.metadata?.correct_order || [...options].sort((a,b) => (a.order || 0) - (b.order || 0)).map(option => option.id));
        default: return '';
    }
}
export function applyExamQuestionKey<T extends KeyQuestion>(question: T, key: string): T {
    if (!CORRECTABLE_QUESTION_TYPES.includes(question.type)) throw Error('Jenis soal ini menggunakan penilaian manual atau psikometri, bukan kunci benar/salah.');
    const revised = structuredClone(question);
    const options = revised.bank_question_options || [];
    const ids = options.map(option => option.id);
    const fail = () => { throw Error('Kunci belum lengkap atau tidak sesuai pilihan soal.'); };
    const unique = (values: unknown): values is string[] => Array.isArray(values) && values.length > 0 &&
        values.every(value => typeof value === 'string' && value.trim()) && new Set(values).size === values.length;
    let value: any = key;
    if (question.type !== 'mcq') { try { value = JSON.parse(key); } catch { return fail(); } }
    switch (question.type) {
        case 'mcq':
            if (!ids.includes(key)) return fail();
            options.forEach(option => { option.is_correct = option.id === key; }); break;
        case 'mcq_complex': case 'ordering':
            if (!unique(value) || value.some(id => !ids.includes(id)) || (question.type === 'ordering' && value.length !== ids.length)) return fail();
            if (question.type === 'ordering') revised.metadata = { ...revised.metadata, correct_order: value };
            else options.forEach(option => { option.is_correct = value.includes(option.id); });
            break;
        case 'true_false': case 'matching': case 'categorization': {
            if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== ids.length || ids.some(id => !(id in value))) return fail();
            if (question.type === 'true_false') {
                if (ids.some(id => typeof value[id] !== 'boolean')) return fail();
                options.forEach(option => { option.is_correct = value[option.id]; });
            } else {
                const multi = question.type === 'matching' ? 'match_texts' : 'category_names';
                const single = question.type === 'matching' ? 'match_text' : 'category_name';
                const allowed = question.metadata?.[question.type === 'matching' ? 'right_items' : 'categories'] ||
                    options.flatMap(option => option.metadata?.[multi] || (option.metadata?.[single] ? [option.metadata[single]] : []));
                if (ids.some(id => !unique(value[id]) || value[id].some((item: string) => !allowed.includes(item)))) return fail();
                options.forEach(option => { option.metadata = { ...option.metadata, [multi]: value[option.id], [single]: value[option.id][0] }; });
            }
            break;
        }
        case 'short_answer': {
            const blanks = revised.metadata?.blanks || [];
            if (!Array.isArray(value) || !blanks.length || value.length !== blanks.length || value.some(answer => typeof answer !== 'string' || !answer.trim() || answer.length > 2000)) return fail();
            revised.metadata = { ...revised.metadata, blanks: blanks.map((blank: any, index: number) => ({ ...blank,
                answer: value[index].trim(), variations: blank.answer === value[index].trim() ? blank.variations || [] : [] })) };
            break;
        }
    }
    return revised;
}
