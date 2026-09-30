import type { ParsedQuestion } from './excel-parser';
import type { QuestionType } from './api/questions';
import { optionIndex } from './option-label';

interface TransferContent {
    id: string;
    title?: string | null;
    content?: string | null;
}

interface TransferKisiKisi extends TransferContent {
    materi?: string | null;
    indikator_soal?: string | null;
    level_kognitif?: string | null;
}

interface TransferDimension {
    id?: string;
    name?: string | null;
}

interface TransferOption {
    id?: string;
    option_text?: string;
    text?: string;
    is_correct?: boolean;
    isCorrect?: boolean;
    order?: number;
    weight?: number;
    dimension_id?: string | null;
    metadata?: { dimension_id?: string | null; [key: string]: unknown };
}

export interface TransferQuestion {
    type: QuestionType;
    question_text?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    scoreDefault?: number;
    score_default?: number;
    stimulus_id?: string | null;
    instruction_id?: string | null;
    kisi_kisi_id?: string | null;
    dimension_id?: string | null;
    bank_question_options?: TransferOption[];
    options?: TransferOption[];
    metadata?: Record<string, unknown>;
    stimulus?: TransferContent | null;
    instruction?: TransferContent | null;
    kisi_kisi?: TransferKisiKisi | null;
    dimension?: TransferDimension | null;
    question_dimensions?: TransferDimension | null;
}

interface TransferRelatedData {
    stimuli?: TransferContent[];
    instructions?: TransferContent[];
    kisiKisi?: TransferKisiKisi[];
    dimensions?: TransferDimension[];
}

/** Portable content: database IDs must never point back into the source bank. */
export function portableQuestion(q: TransferQuestion, related: TransferRelatedData = {}): ParsedQuestion {
    const options = [...(q.bank_question_options || q.options || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
        materi: kisi.materi,
        indikator_soal: kisi.indikator_soal, level_kognitif: kisi.level_kognitif,
    };
    if (dimension) metadata.dimension = dimension.name;
    if (q.type === 'ordering') {
        const keys = Array.isArray(metadata.correct_order)
            ? metadata.correct_order
            : options.map((o, i) => o.id || String(i + 1));
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
        question_text: q.question_text || '', type: q.type, difficulty: q.difficulty || 'medium',
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
