import type { DbService } from '../prisma/prisma-db-adapter';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExamSubjectSource {
    id: string;
    subject_id?: string | null;
    question_bank_id?: string | null;
}

export interface ExamBankInfo {
    /** Nama mapel. */
    subject?: string;
    /** Alamat cover bank soal utama ujian (bila ada). */
    cover?: string;
}

/**
 * Mapel dan cover bank soal per ujian. Mapel memakai aturan yang sama dengan
 * daftar ujian staf: `subject_id` ujian, lalu mapel bank soal (termasuk bank
 * tambahan di cbt_exam_question_sources). Cover diambil dari bank pertama yang
 * punya cover.
 *
 * Ujian folder ASAS/ASAT/AM berjudul nama folder ("ASAS Ganjil 2026/2027"), jadi
 * tanpa mapel dan cover siswa tidak dapat membedakan ujian satu dengan lainnya.
 * Satu kueri per tabel untuk seluruh daftar, bukan per ujian.
 */
export async function examBankInfo(db: Pick<DbService, 'from'>, exams: ExamSubjectSource[]): Promise<Map<string, ExamBankInfo>> {
    const result = new Map<string, ExamBankInfo>();
    const ids = [...new Set(exams.map(exam => exam.id).filter(id => UUID.test(id || '')))];
    if (!ids.length) return result;
    const subjectIds = [...new Set(exams.map(exam => exam.subject_id).filter((id): id is string => typeof id === 'string' && UUID.test(id)))];
    const [subjects, sources] = await Promise.all([
        subjectIds.length ? db.from('cbt_subjects').select('id, name').in('id', subjectIds) : Promise.resolve({ data: [], error: null }),
        db.from('cbt_exam_question_sources').select('exam_id, bank_id').in('exam_id', ids),
    ]);
    const subjectById = new Map(((subjects.data || []) as Array<{ id: string; name?: string | null }>)
        .map(subject => [subject.id, (subject.name || '').trim()]));
    const banksByExam = new Map<string, string[]>();
    for (const exam of exams) if (exam.question_bank_id) banksByExam.set(exam.id, [exam.question_bank_id]);
    for (const source of ((sources.data || []) as Array<{ exam_id: string; bank_id: string }>)) {
        const list = banksByExam.get(source.exam_id) || [];
        if (!list.includes(source.bank_id)) list.push(source.bank_id);
        banksByExam.set(source.exam_id, list);
    }
    const bankIds = [...new Set([...banksByExam.values()].flat().filter(id => UUID.test(id)))];
    const banks = bankIds.length ? await db.from('cbt_question_banks').select('id, subject, image_url').in('id', bankIds) : { data: [] };
    const bankById = new Map(((banks.data || []) as Array<{ id: string; subject?: string | null; image_url?: string | null }>)
        .map(bank => [bank.id, bank]));
    for (const exam of exams) {
        const examBanks = (banksByExam.get(exam.id) || []).map(id => bankById.get(id)).filter(Boolean);
        const subject = (exam.subject_id && subjectById.get(exam.subject_id)) ||
            examBanks.map(bank => (bank!.subject || '').trim()).find(Boolean);
        const cover = examBanks.map(bank => (bank!.image_url || '').trim()).find(Boolean);
        if (subject || cover) result.set(exam.id, { ...(subject ? { subject } : {}), ...(cover ? { cover } : {}) });
    }
    return result;
}

/** Nama mapel per ujian (lihat examBankInfo). */
export async function examSubjectNames(db: Pick<DbService, 'from'>, exams: ExamSubjectSource[]): Promise<Map<string, string>> {
    const info = await examBankInfo(db, exams);
    return new Map([...info].filter(([, value]) => value.subject).map(([id, value]) => [id, value.subject!]));
}
