import { createHash } from 'node:crypto';

type Row = Record<string, any>;

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function candidates(explicit: unknown, fallback: string[]): string[] {
    const supplied = strings(explicit);
    // Never preserve the order of answer mappings as a clue to their pairing.
    return [...new Set(supplied.length ? supplied : fallback)].sort();
}

function content(row: Row | null | undefined) {
    if (!row) return null;
    return { id: row.id, title: row.title, content: row.content };
}

/** Rendering allowlist. Never return raw question/option metadata to participants. */
export function studentQuestion(question: Row, seed: string) {
    const source = question.metadata || {};
    const options: Row[] = question.bank_question_options || [];
    const metadata: Row = {};
    for (const key of ['image_url', 'instructions'] as const) {
        if (typeof source[key] === 'string') metadata[key] = source[key];
    }
    for (const key of ['allow_file_upload', 'allow_video_link', 'is_multi_topic'] as const) {
        if (typeof source[key] === 'boolean') metadata[key] = source[key];
    }
    if (question.type === 'matching') {
        metadata.right_items = candidates(source.right_items, options.flatMap(option => {
            const meta = option.metadata || {};
            return strings(meta.match_texts).length ? strings(meta.match_texts) : strings([meta.match_text]);
        }));
    }
    if (question.type === 'categorization') {
        metadata.categories = candidates(source.categories, options.flatMap(option => {
            const meta = option.metadata || {};
            return strings(meta.category_names).length ? strings(meta.category_names) : strings([meta.category_name]);
        }));
    }
    const displayOptions = [...options];
    if (question.type === 'ordering') {
        // Stored order is the answer key. Produce a stable presentation independent of it.
        const key = (option: Row) => createHash('sha256').update(`${seed}:${question.id}:${option.id}`).digest('hex');
        displayOptions.sort((a, b) => key(a).localeCompare(key(b)));
    }
    return {
        id: question.id,
        question_text: question.question_text,
        type: question.type,
        score_default: question.score_default,
        metadata,
        stimulus: content(question.stimulus),
        instruction: content(question.instruction),
        bank_question_options: displayOptions.map((option, index) => ({
            id: option.id,
            option_text: option.option_text,
            order: question.type === 'ordering' ? index : option.order,
            metadata: typeof option.metadata?.image_url === 'string'
                ? { image_url: option.metadata.image_url } : {},
        })),
    };
}
