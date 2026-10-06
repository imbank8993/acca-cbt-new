export type MaterialFormat = 'html' | 'word' | 'latex' | 'text' | 'pdf' | 'image' | 'audio' | 'video' | 'attachment';
export interface LearningMaterial {
    grade_level: string; topic: string; subtopic: string;
    id: string; title: string; description: string; subject: string; status: 'draft' | 'published';
    format: MaterialFormat; content_html: string; conversion_notes: string; hasFile: boolean; hasRenderedPdf?: boolean;
    file_name: string | null; file_size: number | null; revision: number; content_version: number; updated_at: string; completed?: boolean; materialUpdated?: boolean;
}
export class LearningRequestError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function learningRequest<T>(path = '', init: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api/learning${path}`, { ...init, cache: 'no-store',
        headers: init.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...init.headers } });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success === false || !body) throw new LearningRequestError(body?.error || body?.message || (response.status === 413 ? 'Berkas terlalu besar untuk server.' : 'Permintaan gagal. Silakan coba lagi.'), response.status);
    return body as T;
}
export function saveMaterial(material: LearningMaterial, status = material.status) {
    return learningRequest<{ material: LearningMaterial }>(`/${material.id}`, { method: 'PUT', body: JSON.stringify({
        gradeLevel: material.grade_level || '', topic: material.topic || '', subtopic: material.subtopic || '',
        revision: material.revision, title: material.title, description: material.description, subject: material.subject,
        status, format: material.format, contentHtml: material.content_html, conversionNotes: material.conversion_notes,
    }) });
}
