import type { ExamAttemptRecord } from './api/proctor';

/** Nilai filter untuk peserta ujian folder yang belum ditempatkan di ruang mana pun. */
export const UNASSIGNED_ROOM = '__unassigned__';

type Located = Pick<ExamAttemptRecord, 'pas_location'>;

/**
 * Pilihan filter ruang dari lokasi peserta ujian ASAS/ASAT/AM. Kosong untuk
 * ujian biasa (tanpa lokasi ruang), sehingga filter tidak ditampilkan.
 */
export function monitoringRoomOptions(attempts: Located[]): Array<{ value: string; label: string; count: number }> {
    const rooms = new Map<string, { value: string; label: string; count: number }>();
    let unassigned = 0;
    for (const attempt of attempts) {
        const location = attempt.pas_location;
        if (!location) continue;
        if (location.room_id) {
            const room = rooms.get(location.room_id) || { value: location.room_id, label: location.room_name || 'Ruang', count: 0 };
            room.count += 1;
            rooms.set(location.room_id, room);
        } else if (location.status === 'unassigned') {
            unassigned += 1;
        }
    }
    const options = [...rooms.values()].sort((a, b) => a.label.localeCompare(b.label, 'id', { numeric: true }));
    return unassigned ? [...options, { value: UNASSIGNED_ROOM, label: 'Belum ditempatkan', count: unassigned }] : options;
}

/** Filter yang tersimpan tetapi tidak ada di ujian terpilih dianggap "semua ruang", agar daftar tidak mendadak kosong. */
export function effectiveRoomFilter(value: string, options: Array<{ value: string }>): string {
    return value && options.some(option => option.value === value) ? value : '';
}

export function matchesRoomFilter(attempt: Located, room: string): boolean {
    if (!room) return true;
    if (room === UNASSIGNED_ROOM) return !attempt.pas_location?.room_id;
    return attempt.pas_location?.room_id === room;
}
