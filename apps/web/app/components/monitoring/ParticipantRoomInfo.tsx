import type { ExamAttemptRecord } from '@/lib/api/proctor';

/** Plain text keeps room context readable without adding badges or table columns. */
export function ParticipantRoomInfo({ attempt }: { attempt: Pick<ExamAttemptRecord, 'pas_location'> }) {
    const location = attempt.pas_location;
    if (!location) return null;
    return <div className="mt-2 space-y-0.5 break-words text-xs font-normal text-slate-500" aria-label="Ruang dan pengawas peserta">
        {location.status === 'unavailable' ? <p>Informasi ruang dan pengawas belum tersedia.</p> : <>
            <p><span className="font-medium">Ruang:</span> {location.room_name || 'Belum ditempatkan'}{location.session_name ? ` · ${location.session_name}` : ''}</p>
            {location.status === 'assigned' && <p><span className="font-medium">Pengawas:</span> {location.invigilators.length
                ? location.invigilators.map(person => person.full_name || 'Nama belum tersedia').join(', ')
                : 'Belum ditugaskan'}</p>}
        </>}
    </div>;
}
