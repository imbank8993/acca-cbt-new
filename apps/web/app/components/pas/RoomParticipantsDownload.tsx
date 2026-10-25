"use client";

import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
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
        <section aria-label="Unduh daftar peserta ruang" className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
                <InlineSelect
                    value={roomId}
                    onChange={setSelectedRoom}
                    disabled={isDownloading}
                    title="Pilih ruang untuk daftar peserta"
                    minWidth="220px"
                    height="36px"
                    options={[{ value: 'all', label: 'Semua ruang' }, ...rooms.map(room => ({ value: room.id, label: room.name }))]}
                />
                <Button variant="outline" size="sm" disabled={isDownloading || !rooms.length}
                    isLoading={isDownloading} leftIcon={<Download size={14} />}
                    onClick={() => void download()}>
                    Unduh Daftar Peserta
                </Button>
                <p className="text-xs text-slate-500">PDF A4 dengan kop sekolah untuk setiap ruang.</p>
            </div>
            {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </section>
    );
}
