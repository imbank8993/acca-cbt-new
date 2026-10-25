'use client';

import React, { useEffect, useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { deviceLabel, formatStudentName, gradingLabel, monitoringAttention, monitoringEventLabels, storageLabels } from '@/lib/monitoring-health';
import { formatMonitoringDuration, monitoringTime } from '@/lib/monitoring-time';
import { unansweredQuestionCount } from '@/lib/monitoring-answer-count';
import { AttemptScreenshots } from './AttemptScreenshots';
import { ParticipantRoomInfo } from './ParticipantRoomInfo';
import { formatSchoolDateTime, getSchoolTimeZone } from '@/lib/school-time';
import {
  History,
  Clock,
  ShieldAlert,
  WifiOff,
  Wifi,
  RotateCcw,
} from 'lucide-react';

export interface AttemptHistoryModalProps {
  open: boolean;
  attempt: ExamAttemptRecord | null;
  onClose: () => void;
  showSessionDetails?: boolean;
  elapsedSeconds?: number;
  onViewAnswers?: (id: string) => void;
  onRecover?: (attempt: ExamAttemptRecord) => Promise<void> | void;
}

export function AttemptHistoryModal({
  open,
  attempt,
  onClose,
  showSessionDetails = false,
  elapsedSeconds = 0,
  onViewAnswers,
  onRecover,
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
  const timing = monitoringTime(attempt, elapsedSeconds);
  const health = attempt.sync_health;
  const reportAge = health && attempt.server_now
    ? (Date.parse(attempt.server_now) - Date.parse(health.receivedAt)) / 1000 + elapsedSeconds : Infinity;
  const fresh = health?.fresh && reportAge <= 45;
  const canRecoverAttempt = Boolean(
    onRecover &&
    attempt.canReset === true &&
    ['in_progress', 'submitted', 'auto_submitted', 'belum'].includes(attempt.status),
  );
  const recoverLabel = attempt.status === 'in_progress'
    ? 'Reset sesi'
    : attempt.status === 'belum'
      ? 'Susulan'
      : 'Susulan / Pulihkan';

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
        color: 'text-amber-700 dark:text-amber-400',
      };
    }
    if (type.includes('reconnect') || type.includes('heartbeat') || type.includes('online')) {
      return {
        label,
        icon: Wifi,
        color: 'text-[#3083FF] dark:text-blue-400',
      };
    }
    if (type.includes('reset') || type.includes('recovery') || type.includes('makeup')) {
      return {
        label,
        icon: RotateCcw,
        color: 'text-purple-700 dark:text-purple-400',
      };
    }
    if (type.includes('terminate') || type.includes('violation')) {
      return {
        label,
        icon: ShieldAlert,
        color: 'text-red-700 dark:text-red-400',
      };
    }
    return {
      label,
      icon: Clock,
      color: 'text-slate-800 dark:text-slate-100',
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
        title={showSessionDetails ? 'Detail Peserta & Riwayat' : 'Riwayat Kontak & Pemantauan Sesi'}
        icon={<History className="text-[#3083FF]" size={20} />}
        onClose={onClose}
      />

      <ModalBody className="space-y-4">
        {/* Student Info Bar */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 flex items-center justify-between gap-3 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-800 truncate">{studentName}</p>
            <p className="mt-0.5 text-slate-500 truncate">
              {nis !== '—' ? `${nis} · ` : ''}{className}
            </p>
            <ParticipantRoomInfo attempt={attempt} />
          </div>
          {canRecoverAttempt && onRecover && (
            <button
              type="button"
              onClick={() => {
                const current = attempt;
                onClose();
                void onRecover(current);
              }}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
            >
              <RotateCcw size={13} />
              {recoverLabel}
            </button>
          )}
        </div>

        {showSessionDetails && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-600">{attempt.status === 'in_progress' ? 'Mengerjakan' : ['submitted', 'auto_submitted'].includes(attempt.status) ? gradingLabel(attempt) : 'Belum mulai'}</p>
              {attempt.status === 'in_progress' && timing.remainingSeconds !== null && (
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-blue-700">
                  Sisa {Math.floor(timing.remainingSeconds / 60)}:{String(timing.remainingSeconds % 60).padStart(2, '0')}
                </span>
              )}
            </div>
            <dl className="grid grid-cols-3 divide-x divide-slate-200 rounded-lg bg-slate-50 py-3 text-center">
              <div className="px-2"><dt className="text-xs text-slate-500">Tersimpan</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{attempt.saved_answer_count ?? '—'} <span className="text-xs font-normal text-slate-500">/ {attempt.total_questions ?? '—'}</span></dd></div>
              <div className="px-2"><dt className="text-xs text-slate-500">Belum dijawab</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{unansweredQuestionCount(attempt) ?? '—'}</dd></div>
              <div className="px-2"><dt className="text-xs text-slate-500">Lama mengerjakan</dt><dd className="mt-1 font-semibold tabular-nums">{formatMonitoringDuration(timing.workedSeconds)}</dd></div>
            </dl>
            <dl className="space-y-2 text-xs">
              {[
                ['Mulai', formatDate(attempt.started_at)],
                [attempt.status === 'in_progress' ? 'Batas sesi' : 'Selesai', formatDate(attempt.status === 'in_progress' ? attempt.deadline_at : attempt.finished_at)],
                ['Simpan terakhir', formatDate(attempt.last_answer_saved_at)],
              ].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-slate-500">{label}</dt><dd className="text-slate-700">{value}</dd></div>)}
            </dl>
            {monitoringAttention(attempt, elapsedSeconds).length > 0 && (
              <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {monitoringAttention(attempt, elapsedSeconds).map(reason => <p key={reason}>{reason}</p>)}
              </div>
            )}
            <details key={`warnings-${attempt.id}`} open className="border-t border-slate-200 pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">Peringatan · {attempt.warning_count ?? 0}</summary>
              <p className="mt-2 text-xs text-slate-500">Pindah tab {attempt.violation_breakdown?.pindah_tab ?? attempt.tab_switch_count ?? 0} · Tutup tab {attempt.violation_breakdown?.close_tab ?? 0} · Lainnya {attempt.violation_breakdown?.lainnya ?? 0}</p>
            </details>
            <details key={`sync-${attempt.id}`} open className="border-t border-slate-200 pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">Detail sinkronisasi & koneksi</summary>
              <dl className="mt-3 space-y-2 text-xs">
                {[
                  ['Jawaban lokal', health ? String(health.localAnswerCount) : 'Belum ada laporan'],
                  ['Antrean pengiriman', health ? String(health.pendingAnswerCount) : 'Belum ada laporan'],
                  ['Penyimpanan perangkat', health ? storageLabels[health.storageState] : 'Belum ada laporan'],
                  ['Laporan perangkat', health ? `${formatDate(health.receivedAt)}${fresh ? '' : ' · Laporan lama'}` : 'Belum ada laporan'],
                  ['Perangkat ujian', attempt.device_holder ? `${deviceLabel(attempt.device_holder)} · sejak ${formatDate(attempt.device_holder.since)}` : 'Belum terikat ke perangkat'],
                  ['Kontak server terakhir', formatDate(attempt.last_seen_at)],
                  ['Batas sesi', formatDate(attempt.deadline_at)],
                  ['Waktu sesi', formatMonitoringDuration(timing.availableSeconds)],
                  ['Koneksi', attempt.status === 'belum' ? 'Belum mulai' : attempt.status !== 'in_progress' ? 'Sesi berakhir' : elapsedSeconds > 45 ? 'Data perlu diperbarui' : attempt.connection_status === 'online' ? 'Terhubung' : 'Tidak ada kontak terbaru'],
                ].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-slate-500">{label}</dt><dd className="text-slate-700">{value}</dd></div>)}
              </dl>
            </details>
          </div>
        )}

        {/* Timeline Events List */}
        <details key={`history-${attempt.id}`} open={!showSessionDetails} className="border-t border-slate-200 pt-3">
          <summary className="mb-3 cursor-pointer text-xs font-semibold text-slate-700">Riwayat aktivitas · {historyList.length} catatan</summary>
          {historyList.length === 0 ? (
            <div className="py-4 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
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
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold leading-none ${badge.color}`}>
                          <EventIcon size={14} className="shrink-0" />
                          <span className="leading-none">{badge.label}</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 leading-none">
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
                        {event.type === 'LATE_SECURITY_EVIDENCE' && event.original_event_type && (
                          <div className="sm:col-span-2">
                            <span className="text-slate-400 font-medium">Peringatan:</span>{' '}
                            <span className="font-semibold text-slate-800">{monitoringEventLabels[event.original_event_type] || event.original_event_type}</span>
                            {event.event_at && <> · terjadi {formatDate(event.event_at)}</>}
                            {' · '}{event.late_reason === 'before_reset' ? 'sebelum pemulihan dibuka' : 'baru diterima setelah ujian ditutup'}
                          </div>
                        )}
                        {reasonText && (
                          <div className="sm:col-span-2">
                            <span className="text-slate-400 font-medium">Alasan:</span>{' '}
                            <span className="font-medium text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60 inline-block mt-0.5">{reasonText}</span>
                          </div>
                        )}
                        {event.type === 'DEVICE_SWITCH_BLOCKED' && (
                          <div className="sm:col-span-2">
                            <span className="text-slate-400 font-medium">Perangkat ditolak:</span>{' '}
                            <span className="font-semibold text-slate-800">{deviceLabel(event.device_context)}</span>
                          </div>
                        )}
                        {event.device_released && (
                          <div className="sm:col-span-2">
                            <span className="font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60 inline-block">
                              Dipindahkan ke perangkat baru
                              {event.abandoned_local_answers ? ` · ${event.abandoned_local_answers} jawaban di perangkat lama tidak ikut` : ''}
                            </span>
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
        </details>
        <AttemptScreenshots key={attempt.id} attemptId={attempt.id} />
      </ModalBody>

      <ModalFooter align="end">
        {showSessionDetails && onViewAnswers && <Button type="button" variant="primary" onClick={() => { onViewAnswers(attempt.id); onClose(); }}>Rincian jawaban</Button>}
        <Button type="button" variant="cancel" onClick={onClose}>
          Tutup
        </Button>
      </ModalFooter>
    </Modal>
  );
}
