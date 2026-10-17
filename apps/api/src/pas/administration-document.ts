import { createHash } from 'node:crypto';

export type AdministrationSnapshot = Record<string, any>;

function canonical(value: any): any {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
        .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
    return value;
}

export function documentHash(snapshot: AdministrationSnapshot): string {
    return createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
}

/** Snapshot only document content, excluding mutable workflow/permission metadata. */
export function snapshotDocument(slot: AdministrationSnapshot, report: AdministrationSnapshot = slot.report): AdministrationSnapshot {
    const fields = ['notes', 'incident_summary', 'invigilator_id', 'invigilator_name', 'invigilator_nip',
        'proctor_id', 'proctor_name', 'proctor_nip', 'committee_chair_name', 'committee_chair_nip',
        'verification_code', 'attendance_verification_code'];
    return JSON.parse(JSON.stringify({
        organization: slot.organization, profil_sekolah: slot.profil_sekolah,
        period: slot.period, room: slot.room, session: slot.session, exam_date: slot.exam_date,
        schedules: slot.schedules, students: slot.students, counts: slot.counts,
        report: Object.fromEntries(fields.map(field => [field, report[field] ?? ''])),
    }));
}

export function intactDocument(report: AdministrationSnapshot): boolean {
    const snapshot = report.document_snapshot;
    if (!snapshot?.report || !Array.isArray(snapshot.students) || !snapshot.counts || documentHash(snapshot) !== report.signature_hash) return false;
    const date = report.exam_date instanceof Date ? report.exam_date.toISOString().slice(0, 10) : String(report.exam_date).slice(0, 10);
    if (snapshot.organization?.id !== report.organization_id || snapshot.period?.id !== report.pas_period_id ||
        snapshot.room?.id !== report.pas_room_id || snapshot.session?.id !== report.session_id || snapshot.exam_date !== date) return false;
    return ['notes', 'incident_summary', 'invigilator_id', 'invigilator_name', 'proctor_id', 'proctor_name',
        'proctor_nip', 'committee_chair_name', 'committee_chair_nip', 'verification_code', 'attendance_verification_code']
        .every(field => String(snapshot.report[field] ?? '') === String(report[field] ?? ''));
}
