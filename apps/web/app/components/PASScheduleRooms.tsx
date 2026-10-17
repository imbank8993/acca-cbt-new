import type { PASClassSchedule } from '@/app/types/pas';
import { getRoomSessionInvigilators, type PASRoom } from '@/lib/api/pas';

/** Names in master data are suggestions. Supervision follows actual participant placement by room ID. */
export function PASScheduleRooms({ schedule, rooms, onManage }: {
    schedule: PASClassSchedule; rooms: PASRoom[]; onManage: () => void;
}) {
    const roomIds = schedule.allocated_room_ids || [];
    return <div className="space-y-2 text-xs">
        {roomIds.length ? roomIds.map(id => {
            const room = rooms.find(room => room.id === id);
            if (!room) return <p key={id} className="text-slate-500">Data ruang belum dimuat</p>;
            const supervisors = getRoomSessionInvigilators(room, schedule.session_id);
            const names = supervisors.map(person => person.profiles?.full_name || 'Nama pengawas belum tersedia');
            return <div key={id}>
                <p className="font-medium text-slate-800">{room.name}</p>
                {supervisors.length ? <p className="mt-0.5 text-[11px] text-slate-500">{names.join(', ')}</p>
                    : <button type="button" onClick={onManage} className="mt-0.5 text-[11px] text-amber-600">Atur pengawas</button>}
            </div>;
        }) : <>
            {schedule.room && <p className="font-medium text-slate-800">{schedule.room}</p>}
            <button type="button" onClick={onManage} className="text-[11px] text-amber-600">Atur penempatan peserta</button>
        </>}
    </div>;
}
