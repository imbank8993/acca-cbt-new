'use client';
import { useState } from 'react';
import type { PASClassSchedule } from '@/app/types/pas';
import { Modal, ModalBody, ModalFooter } from './ui/modal';
import { Button } from './ui/button';

export function isPASScheduleReady(schedule: PASClassSchedule) {
    return schedule.readiness?.ready === true && schedule.readiness.issues.length === 0;
}

export function PASScheduleStatus({ schedule }: { schedule: PASClassSchedule }) {
    const [showDetails, setShowDetails] = useState(false);
    const ready = isPASScheduleReady(schedule);
    const issues = schedule.readiness?.issues?.length ? schedule.readiness.issues : ready ? [] : ['Kelengkapan belum dapat dipastikan. Muat ulang daftar.'];
    const label = schedule.status === 'cancelled' ? 'Dibatalkan' : schedule.status === 'finished' ? 'Selesai'
        : schedule.status === 'active' ? 'Sedang ujian' : ready ? 'Siap' : 'Belum lengkap';
    const tone = ['cancelled', 'finished'].includes(schedule.status) ? 'text-slate-500' : ready ? 'text-emerald-600' : 'text-amber-600';
    return <div className="text-xs">
        <p className={`mb-1 font-semibold ${schedule.is_activated === true ? 'text-blue-600' : 'text-slate-500'}`}>
            {schedule.is_activated == null ? 'Aktivasi belum diperiksa' : schedule.is_activated ? 'Aktif' : 'Nonaktif'}
        </p>
        {!ready && !['finished', 'cancelled'].includes(schedule.status)
            ? <button type="button" aria-haspopup="dialog" onClick={() => setShowDetails(true)}
                className={`text-left font-medium underline decoration-dotted underline-offset-4 ${tone}`}>
                {label}
            </button>
            : <span className={`font-medium ${tone}`}>{label}</span>}
        {showDetails && <Modal open onClose={() => setShowDetails(false)} labelledBy={`pas-readiness-${schedule.id}`} title="Kelengkapan Jadwal" subtitle={schedule.question_banks?.title || schedule.classes?.name} size="md">
            <ModalBody>
                <p className="mb-3 text-sm text-slate-600">Lengkapi kebutuhan berikut sebelum mengaktifkan ujian.</p>
                <ul className="list-disc space-y-3 pl-5 text-sm text-slate-700" aria-label="Kelengkapan yang perlu diatur">
                    {issues.map(issue => <li key={issue}>{issue}</li>)}
                </ul>
            </ModalBody>
            <ModalFooter><Button variant="outline" onClick={() => setShowDetails(false)}>Tutup</Button></ModalFooter>
        </Modal>}
    </div>;
}
