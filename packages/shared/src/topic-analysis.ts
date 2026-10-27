export interface TopicQuestion {
    id: string;
    type: string;
    topic?: string | null;
    metadata?: unknown;
    kisi_kisi?: unknown;
    score_default?: unknown;
}

export interface TopicResponse {
    participantId: string;
    questionId: string;
    answered: boolean;
    isCorrect?: boolean | null;
}

export interface TopicResult {
    name: string;
    questionCount: number;
    participantCount: number;
    correct: number;
    incorrect: number;
    unanswered: number;
    pending: number;
    assessed: number;
    percentage: number | null;
}

export interface TopicAnalysis {
    participantCount: number;
    mappedQuestions: number;
    unmappedQuestions: number;
    topics: TopicResult[];
}

const NON_ACADEMIC = new Set(['sjt', 'likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison']);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function topicText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ').trim();
    return text || null;
}

/** Only teacher-supplied material names; never infer a topic from question text. */
export function questionTopic(question: TopicQuestion): string | null {
    const metadata = record(question.metadata);
    const syllabus = record(Array.isArray(question.kisi_kisi) ? question.kisi_kisi[0] : question.kisi_kisi);
    return topicText(question.topic) || topicText(syllabus.materi)
        || topicText(record(metadata.kisi_kisi_data).materi) || topicText(record(metadata.kisi_kisi).materi)
        || topicText(metadata.materi) || topicText(metadata.topic);
}

export function isAcademicTopicQuestion(question: TopicQuestion): boolean {
    return !NON_ACADEMIC.has(question.type.toLowerCase().trim())
        && record(question.metadata).score_excluded !== true
        && (question.score_default == null || Number(question.score_default) > 0);
}

/** Accuracy over completed participants; unanswered counts, pending grading does not. */
export function buildTopicAnalysis(questions: TopicQuestion[], participantIds: string[], responses: TopicResponse[]): TopicAnalysis {
    const participants = new Set(participantIds);
    const academic = [...new Map(questions.filter(isAcademicTopicQuestion).map(question => [question.id, question])).values()];
    const answers = new Map<string, Map<string, TopicResponse>>();
    for (const response of responses) {
        if (!participants.has(response.participantId)) continue;
        if (!answers.has(response.questionId)) answers.set(response.questionId, new Map());
        answers.get(response.questionId)!.set(response.participantId, response);
    }
    const groups = new Map<string, TopicResult>();
    let mappedQuestions = 0;
    for (const question of academic) {
        const name = questionTopic(question);
        if (!name) continue;
        mappedQuestions += 1;
        const key = name.toLocaleLowerCase('id');
        if (!groups.has(key)) groups.set(key, { name, questionCount: 0, participantCount: participants.size,
            correct: 0, incorrect: 0, unanswered: 0, pending: 0, assessed: 0, percentage: null });
        const group = groups.get(key)!;
        group.questionCount += 1;
        for (const participant of participants) {
            const answer = answers.get(question.id)?.get(participant);
            if (!answer?.answered) group.unanswered += 1;
            else if (answer.isCorrect === true) group.correct += 1;
            else if (answer.isCorrect === false) group.incorrect += 1;
            else group.pending += 1;
        }
    }
    const topics = [...groups.values()].map(topic => {
        const assessed = topic.correct + topic.incorrect + topic.unanswered;
        return { ...topic, assessed, percentage: assessed ? 100 * topic.correct / assessed : null };
    }).sort((a, b) => (a.percentage ?? Infinity) - (b.percentage ?? Infinity) || a.name.localeCompare(b.name, 'id'));
    return { participantCount: participants.size, mappedQuestions, unmappedQuestions: academic.length - mappedQuestions, topics };
}
