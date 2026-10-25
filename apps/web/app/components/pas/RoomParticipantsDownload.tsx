"use client";

import { useRef, useState } from 'react';
import { Download, Users } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { listPASRoomParticipants } from '@/lib/api/pas';
import type { RoomParticipantsPeriod } from '@/lib/pas/room-participants-pdf';

export function RoomParticipantsDownload({ period, rooms }: {
    period: RoomParticipantsPeriod & { id: string };
    rooms: Array<{ id: string; name: string }>;
}) {
    const [selectedRoom, setSelectedRoom] = useState('all');
    const [isDownloading, setIsDownloading] = useState(false);
    const [error, setError] = useState('');
    const inFlight = useRef(false);
    const roomId = rooms.some(room => room.id === selectedRoom) ? selectedRoom : 'all';

    const download = async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setIsDownloading(true);
        setError('');
        try {
            const [{ downloadRoomParticipantsPdf }, allRooms] = await Promise.all([
                import('@/lib/pas/room-participants-pdf'),
                listPASRoomParticipants(period.id),
            ]);
            const chosen = roomId === 'all' ? allRooms : allRooms.filter(room => room.id === roomId);
            await downloadRoomParticipantsPdf(period, chosen);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Daftar peserta belum berhasil diunduh. Silakan coba lagi.');
        } finally {
            inFlight.current = false;
            setIsDownloading(false);
        }
    };

    return (
        <section aria-label="Unduh daftar peserta ruang"
            className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#3083FF]">
                    <Users size={17} />
                </span>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-slate-900">Daftar Peserta</h4>
                    <p className="mt-0.5 text-xs text-slate-500">
                        {rooms.length ? `${rooms.length} ruang · satu kop untuk setiap ruang` : 'Belum ada ruang ujian'}
                    </p>
                </div>
            </div>
            <div className="mt-auto flex flex-col gap-2">
                <InlineSelect
                    value={roomId}
                    onChange={setSelectedRoom}
                    disabled={isDownloading || !rooms.length}
                    title="Pilih ruang untuk daftar peserta"
                    minWidth="100%"
                    height="34px"
                    options={[{ value: 'all', label: 'Semua ruang' }, ...rooms.map(room => ({ value: room.id, label: room.name }))]}
                />
                <Button variant="outline" size="sm" className="w-full" disabled={isDownloading || !rooms.length}
                    isLoading={isDownloading} leftIcon={<Download size={14} />}
                    onClick={() => void download()}>
                    Unduh PDF
                </Button>
            </div>
            {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </section>
    );
}
