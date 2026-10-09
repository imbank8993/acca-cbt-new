'use client';

import React, { useEffect, useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { formatStudentName, monitoringEventLabels } from '@/lib/monitoring-health';
import { formatSchoolDateTime, getSchoolTimeZone } from '@/lib/school-time';
import {
  History,
  Clock,
  User,
  ShieldAlert,
  WifiOff,
  Wifi,
  RotateCcw,
  AlertTriangle,
  Info,
  CheckCircle2,
  FileText,
} from 'lucide-react';

export interface AttemptHistoryModalProps {
  open: boolean;
  attempt: ExamAttemptRecord | null;
  onClose: () => void;
}

export function AttemptHistoryModal({
  open,
  attempt,
  onClose,
}: AttemptHistoryModalProps) {
  const [zone, setZone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getSchoolTimeZone()
      .then((val) => {
        if (alive) setZone(val);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!open || !attempt) return null;

  const studentName = formatStudentName(attempt.profiles?.full_name, 'Siswa');
  const className = attempt.kelas_name || '—';
  const nis = attempt.profiles?.identity_number || '—';
  const historyList = attempt.monitoring_history || [];

  const formatDate = (value?: string | null) => {
    if (!value) return 'Belum tercatat';
    if (zone) return formatSchoolDateTime(value, zone);
    return new Date(value).toLocaleString('id-ID');
  };

  const formatSeconds = (totalSec?: number | null) => {
    if (totalSec == null) return null;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins > 0) return `${mins} menit ${secs} detik`;
    return `${secs} detik`;
  };

  const getEventBadge = (type: string) => {
    const label = monitoringEventLabels[type] || type;
    if (type.includes('offline') || type.includes('disconnect') || type.includes('interruption')) {
      return {
        label,
        icon: WifiOff,
        style: 'bg-amber-100 text-amber-800 border-amber-300',
      };
    }
    if (type.includes('reconnect') || type.includes('heartbeat') || type.includes('online')) {
      return {
        label,
        icon: Wifi,
        style: 'bg-[#3083FF]/10 text-[#3083FF] border-[#3083FF]/30',
      };
    }
    if (type.includes('reset') || type.includes('recovery') || type.includes('makeup')) {
      return {
        label,
        icon: RotateCcw,
        style: 'bg-purple-100 text-purple-800 border-purple-300',
      };
    }
    if (type.includes('terminate') || type.includes('violation')) {
      return {
        label,
        icon: ShieldAlert,
        style: 'bg-red-100 text-red-800 border-red-300',
      };
    }
    return {
      label,
      icon: Clock,
      style: 'bg-slate-100 text-slate-700 border-slate-300',
    };
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      variant="default"
      labelledBy="history-modal-title"
    >
      <ModalHeader
        id="history-modal-title"
        title="Riwayat Kontak & Pemantauan Sesi"
        subtitle={`Jejak riwayat aktivitas dan koneksi server untuk ${studentName}`}
        icon={<History className="text-[#3083FF]" size={20} />}
        onClose={onClose}
      />

      <ModalBody className="space-y-4">
        {/* Student Info Bar */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#3083FF]/10 text-[#3083FF] font-bold text-sm">
              <User size={16} />
            </div>
            <div>
              <p className="font-bold text-slate-800">{studentName}</p>
              <p className="text-slate-500">
                NIS: <span className="font-mono text-slate-700">{nis}</span> · Kelas: <span className="font-medium text-slate-700">{className}</span>
              </p>
            </div>
          </div>
          <span className="rounded-md bg-white px-2.5 py-1 border border-slate-200 font-bold text-[#3083FF]">
            Total {historyList.length} Catatan Riwayat
          </span>
        </div>

        {/* Informative Note */}
        <div className="rounded-xl border border-blue-200/80 bg-blue-50/50 p-3 text-xs text-blue-900 flex items-start gap-2.5">
          <Info size={16} className="text-[#3083FF] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Kontak server diperiksa secara berkala. Jeda koneksi dapat disebabkan oleh jaringan terputus, browser ditutup, atau perangkat masuk mode tidur — <em>bukan bukti pasti kecurangan</em>. Waktu perangkat merupakan laporan lokal siswa.
          </p>
        </div>

        {/* Timeline Events List */}
        <div className="pt-2">
          {historyList.length === 0 ? (
            <div className="py-12 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
              <Clock size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-600">Belum Ada Catatan Riwayat</p>
              <p className="text-xs text-slate-400 mt-1">
                Aktivitas kontak server akan muncul di sini setelah peserta berinteraksi dengan ujian.
              </p>
            </div>
          ) : (
            <div className="relative border-l-2 border-slate-200 ml-4 space-y-4">
              {historyList.map((event, index) => {
                const badge = getEventBadge(event.type);
                const EventIcon = badge.icon;
                const reasonText = event.reason === 'browser_offline'
                  ? 'Browser mendeteksi jaringan offline'
                  : event.reason === 'server_unreachable'
                    ? 'Permintaan ke server ujian tidak berhasil'
                    : event.reason;

                return (
                  <div key={`${event.at}:${index}`} className="relative pl-6 group">
                    {/* Node Dot */}
                    <span className="absolute -left-[9px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-[#3083FF]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#3083FF]" />
                    </span>

                    {/* Event Card */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs transition-all hover:border-[#3083FF]/30 hover:shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold border ${badge.style}`}>
                          <EventIcon size={13} />
                          {badge.label}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                          {formatDate(event.at)}
                        </span>
                      </div>

                      {/* Event Details Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600 pt-1">
                        {event.actor_id && (
                          <div>
                            <span className="text-slate-400 font-medium">Oleh:</span>{' '}
                            <span className="font-semibold text-slate-800">{event.actor_name || event.actor_id}</span>
                          </div>
                        )}
                        {reasonText && (
                          <div className="sm:col-span-2">
                            <span className="text-slate-400 font-medium">Alasan:</span>{' '}
                            <span className="font-medium text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60 inline-block mt-0.5">{reasonText}</span>
                          </div>
                        )}
                        {event.recovery_until && (
                          <div>
                            <span className="text-slate-400 font-medium">Tenggat Baru:</span>{' '}
                            <span className="font-semibold text-[#3083FF]">{formatDate(event.recovery_until)}</span>
                          </div>
                        )}
                        {event.last_seen_at && (
                          <div>
                            <span className="text-slate-400 font-medium">Kontak Terakhir:</span>{' '}
                            <span className="font-medium text-slate-700">{formatDate(event.last_seen_at)}</span>
                          </div>
                        )}
                        {event.observed_again_at && (
                          <div>
                            <span className="text-slate-400 font-medium">Terhubung Kembali:</span>{' '}
                            <span className="font-medium text-emerald-700">{formatDate(event.observed_again_at)}</span>
                          </div>
                        )}
                        {event.disconnected_at && (
                          <div className="sm:col-span-2">
                            <span className="text-slate-400 font-medium">Gangguan Perangkat:</span>{' '}
                            <span className="font-medium text-slate-700">{formatDate(event.disconnected_at)}</span>
                          </div>
                        )}
                        {event.remaining_at_disconnect_seconds != null && (
                          <div>
                            <span className="text-slate-400 font-medium">Sisa Waktu (Gangguan):</span>{' '}
                            <span className="font-semibold text-slate-700">{formatSeconds(event.remaining_at_disconnect_seconds)}</span>
                          </div>
                        )}
                        {event.remaining_at_last_seen_seconds != null && (
                          <div>
                            <span className="text-slate-400 font-medium">Sisa Waktu (Kontak):</span>{' '}
                            <span className="font-semibold text-slate-700">{formatSeconds(event.remaining_at_last_seen_seconds)}</span>
                          </div>
                        )}
                        {event.remaining_at_reconnect_seconds != null && (
                          <div>
                            <span className="text-slate-400 font-medium">Sisa Waktu (Kembali):</span>{' '}
                            <span className="font-semibold text-slate-700">{formatSeconds(event.remaining_at_reconnect_seconds)}</span>
                          </div>
                        )}
                        {event.gap_seconds != null && (
                          <div>
                            <span className="text-slate-400 font-medium">Jeda Perkiraan:</span>{' '}
                            <span className="font-semibold text-amber-700">{event.gap_seconds} detik</span>
                          </div>
                        )}
                        {event.pending_answer_count != null && (
                          <div>
                            <span className="text-slate-400 font-medium">Jawaban Belum Terkirim:</span>{' '}
                            <span className="font-semibold text-slate-700">{event.pending_answer_count}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter align="end">
        <Button type="button" variant="cancel" onClick={onClose}>
          Tutup
        </Button>
      </ModalFooter>
    </Modal>
  );
}
