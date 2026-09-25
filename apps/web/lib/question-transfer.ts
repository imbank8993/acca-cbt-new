import { optionIndex } from './option-label';
import type { ParsedQuestion } from './excel-parser';

/** Portable content: database IDs must never point back into the source bank. */
export function portableQuestion(q: any, related: {
    stimuli?: any[]; instructions?: any[]; kisiKisi?: any[]; dimensions?: any[];
} = {}): ParsedQuestion {
    const options = [...(q.bank_question_options || q.options || [])].sort((a, b) => a.order - b.order);
    const metadata = { ...(q.metadata || {}) };
    delete metadata._deleted;
    delete metadata._deleted_at;
    delete metadata.order_index;
    const stimulus = q.stimulus || related.stimuli?.find(s => s.id === q.stimulus_id);
    const instruction = q.instruction || related.instructions?.find(s => s.id === q.instruction_id);
    const kisi = q.kisi_kisi || related.kisiKisi?.find(s => s.id === q.kisi_kisi_id);
    const dimension = q.dimension || q.question_dimensions || related.dimensions?.find(s => s.id === q.dimension_id);
    if (stimulus) Object.assign(metadata, { import_stimulus: stimulus.content, stimulus_title: stimulus.title });
    if (instruction) Object.assign(metadata, { import_instruction: instruction.content, instruction_title: instruction.title });
    if (kisi) metadata.kisi_kisi_data = {
        nomor_kd: kisi.nomor_kd, kd_cp: kisi.kd_cp, materi: kisi.materi,
        indikator_soal: kisi.indikator_soal, level_kognitif: kisi.level_kognitif,
    };
    if (dimension) metadata.dimension = dimension.name;
    if (q.type === 'ordering') {
        const keys = metadata.correct_order || options.map((o, i) => o.id || String(i + 1));
        const zeroBased = keys.some((key: unknown) => String(key) === '0');
        metadata.correct_order = keys.map((key: unknown) => {
            const idIndex = options.findIndex(o => o.id && o.id === key);
            if (idIndex >= 0) return String(idIndex + 1);
            const text = String(key);
            if (/^[A-Z]+$/i.test(text)) return String(optionIndex(text) + 1);
            return zeroBased ? String(Number(text) + 1) : text;
        });
    }
    return {
        question_text: q.question_text, type: q.type, difficulty: q.difficulty || 'medium',
        scoreDefault: q.scoreDefault ?? q.score_default ?? 1, metadata,
        options: options.map((o, order) => {
            const meta = { ...(o.metadata || {}) };
            const dim = related.dimensions?.find(d => d.id === (meta.dimension_id || o.dimension_id));
            if (dim) meta.dimension = dim.name;
            delete meta.dimension_id;
            return { text: o.option_text ?? o.text ?? '', isCorrect: o.is_correct ?? o.isCorrect ?? false,
                order, weight: o.weight ?? 0, metadata: meta };
        }),
    };
}
