import type { PASClassSchedule } from '@/app/types/pas';
import { getRoomSessionInvigilators, type PASRoom } from '@/lib/api/pas';
import { Button } from './ui/button';

/** Names in master data are suggestions. Supervision follows actual participant placement by room ID. */
export function PASScheduleRooms({ schedule, rooms, onManage }: {
    schedule: PASClassSchedule; rooms: PASRoom[]; onManage: () => void;
}) {
    const roomIds = schedule.allocated_room_ids || [];
    return <div className="space-y-2 text-xs">
        {roomIds.length ? roomIds.map(id => {
            const room = rooms.find(room => room.id === id);
            if (!room) return <p key={id} className="text-slate-500">Data ruang belum dimuat</p>;
            const supervisors = getRoomSessionInvigilators(room, schedule.session_id, schedule.scheduled_date);
            const names = supervisors.map(person => person.profiles?.full_name || 'Nama pengawas belum tersedia');
            return <div key={id}>
                <p className="font-medium text-slate-800">{room.name}
                    {schedule.allocated_room_counts?.[id] != null && <span className="ml-1 font-normal text-slate-500">· {schedule.allocated_room_counts[id]} siswa</span>}
                </p>
                {supervisors.length ? <p className="mt-0.5 text-[11px] text-slate-500">{names.join(', ')}</p>
                    : <Button type="button" variant="ghost" size="sm" onClick={onManage} className="mt-0.5 text-amber-700">Atur pengawas</Button>}
            </div>;
        }) : <>
            {schedule.room && <p className="font-medium text-slate-800">{schedule.room}</p>}
            <Button type="button" variant="ghost" size="sm" onClick={onManage} className="text-amber-700">Atur penempatan peserta</Button>
        </>}
    </div>;
}
