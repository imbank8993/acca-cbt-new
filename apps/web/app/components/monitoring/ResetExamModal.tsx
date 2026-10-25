'use client';

import React, { useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { deviceLabel, formatStudentName } from '@/lib/monitoring-health';
import { formatSchoolDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { resetExamAttempt, startMakeupExam, startMakeupForAbsentStudent } from '@/lib/api/proctoring';
import { hasIrtScore } from '@/lib/irt-status';
import {
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';

export type ResetMode = 'PULIHKAN' | 'SUSULAN';

export interface ResetExamModalProps {
  open: boolean;
  attempt: ExamAttemptRecord | null;
  participantSummary?: string;
  examDuration?: number;
  /** Jumlah peserta terpilih yang sudah punya skor IRT (reset massal). Default: dari `attempt`. */
  irtScoredCount?: number;
  onClose: () => void;
  onSuccess?: () => void;
  onConfirm?: (attemptId: string, mode: ResetMode, reason: string, durationMinutes: number) => Promise<void>;
}

const PRESET_REASONS = [
  'Gangguan koneksi',
  'Perangkat mati',
  'Browser keluar',
  'Izin / Susulan',
  'Salah kirim',
];

const QUICK_DURATIONS = [15, 30, 60];

export function ResetExamModal(props: ResetExamModalProps) {
  if (!props.open || !props.attempt || props.attempt.canReset !== true) return null;
  return <ResetExamForm key={props.attempt.id} {...props} />;
}

function ResetExamForm({
  open,
  attempt,
  examDuration,
  onClose,
  onSuccess,
  onConfirm,
  participantSummary,
  irtScoredCount,
}: ResetExamModalProps) {
  // Siswa yang belum pernah mulai: hanya susulan (pengerjaan baru dengan jendela pribadi).
  const notStarted = attempt?.status === 'belum';
  const resolvedExamDuration = Number(
    examDuration ??
    attempt?.exams?.duration_minutes ??
    attempt?.exams?.duration ??
    60
  ) || 60;

  const [mode, setMode] = useState<ResetMode>(notStarted ? 'SUSULAN' : 'PULIHKAN');
  const [reason, setReason] = useState('');
  const [durationInput, setDurationInput] = useState<string>(() =>
    String(notStarted ? resolvedExamDuration : 15)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedClear, setConfirmedClear] = useState(false);
  // Pindah perangkat hanya untuk satu siswa (bukan reset massal).
  const [releaseDevice, setReleaseDevice] = useState(false);
  const { timeZone } = useSchoolTimeZone();
  const formatTime = (value?: string | null) => value ? formatSchoolDateTime(value, timeZone) : '—';
  // Jenis pemulihan: hanya kirim jawaban dari perangkat (terkunci) atau lanjut mengerjakan.
  // Masih "mengerjakan" tetapi tenggat sudah lewat (penutupan otomatis belum
  // berjalan): bawaannya hanya kirim jawaban, bukan tambahan waktu mengerjakan.
  const [submitOnly, setSubmitOnly] = useState(
    attempt?.status !== 'in_progress' || attempt?.metadata?.recovery_submit_only === true ||
      (typeof attempt?.remaining_seconds === 'number' && attempt.remaining_seconds <= 0),
  );

  const parsedDuration = Number.parseInt(durationInput.trim(), 10);
  const duration = Number.isFinite(parsedDuration) ? parsedDuration : 0;

  // Adjust default duration when mode changes
  const handleModeSelect = (newMode: ResetMode) => {
    setMode(newMode);
    if (newMode === 'PULIHKAN') {
      setDurationInput('15');
    } else if (newMode === 'SUSULAN') {
      setDurationInput(String(resolvedExamDuration));
    }
  };

  const quickDurations = Array.from(
    new Set([...QUICK_DURATIONS, resolvedExamDuration])
  ).sort((a, b) => a - b);

  if (!open || !attempt || attempt.canReset !== true) return null;

  const studentName = formatStudentName(attempt.profiles?.full_name, 'Siswa');
  const className = attempt.kelas_name || '—';
  const nis = attempt.profiles?.identity_number || '—';
  const savedAnswers = attempt.saved_answer_count ?? 0;
  const totalQuestions = attempt.total_questions ?? 0;
  const isActive = attempt.status === 'in_progress';
  const irtScored = irtScoredCount ?? (hasIrtScore(attempt) ? 1 : 0);
  const offline = attempt.offline_review;
  const offlineNotes = [
    offline?.connection_lost_at_close
      ? `Terputus sebelum batas waktu${offline.connection_lost_at_close.gap_seconds != null
        ? ` (${Math.max(1, Math.round(offline.connection_lost_at_close.gap_seconds / 60))}m tanpa kontak)` : ''}.`
      : null,
    offline?.uncounted_local_answers
      ? `${offline.uncounted_local_answers.count} jawaban lokal di perangkat belum terkirim.`
      : null,
    offline?.late_security_evidence
      ? `${offline.late_security_evidence} catatan pengawasan saat offline.`
      : null,
  ].filter((note): note is string => Boolean(note));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const trimmedReason = reason.trim();

    if (trimmedReason.length < 5) {
      setErrorMessage('Alasan pemulihan/susulan wajib diisi (minimal 5 karakter).');
      return;
    }
    if (trimmedReason.length > 500) {
      setErrorMessage('Alasan maksimal 500 karakter.');
      return;
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
      setErrorMessage('Durasi harus berupa angka antara 1 dan 1440 menit.');
      return;
    }
    if (mode === 'SUSULAN' && !confirmedClear && !notStarted) {
      setErrorMessage('Konfirmasi penghapusan jawaban sebelum memulai ulang.');
      return;
    }

    const moveDevice = mode === 'PULIHKAN' && releaseDevice && !participantSummary;
    const lockAnswers = !moveDevice && (submitOnly || !isActive);

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (onConfirm) {
        await onConfirm(attempt.id, mode, trimmedReason, duration);
      } else {
        const result = mode === 'SUSULAN'
          ? notStarted
            ? await startMakeupForAbsentStudent(attempt.exam_id, attempt.user_id, trimmedReason, duration)
            : await startMakeupExam(attempt.id, trimmedReason, duration)
          : await resetExamAttempt(attempt.id, trimmedReason, duration, moveDevice, moveDevice ? undefined : lockAnswers);

        if (!result.success) {
          throw new Error('error' in result ? (result.error as string) : 'Gagal memproses pemulihan/susulan');
        }
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!isSubmitting) onClose(); }}
      size="lg"
      variant="default"
      labelledBy="reset-exam-modal-title"
    >
      <ModalHeader
        id="reset-exam-modal-title"
        title={notStarted ? 'Ujian Susulan' : isActive ? 'Reset Sesi Pengerjaan' : 'Pemulihan / Susulan Ujian'}
        icon={<RotateCcw className="text-[#3083FF]" size={18} />}
        onClose={isSubmitting ? undefined : onClose}
      />

      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-3.5">
          {participantSummary && (
            <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              {participantSummary} Pengaturan berlaku untuk semua siswa terpilih.
            </div>
          )}

          {/* Student Info Summary Card (Compact, without avatar) */}
          {!participantSummary && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-800 truncate">{studentName}</p>
                <p className="mt-0.5 text-slate-500 truncate">
                  {nis !== '—' ? `${nis} · ` : ''}{className}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  attempt.status === 'auto_submitted'
                    ? 'bg-pink-100 text-pink-700'
                    : attempt.status === 'submitted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-blue-100 text-blue-700'
                }`}>
                  {attempt.status === 'auto_submitted' ? 'Dihentikan' : attempt.status === 'submitted' ? 'Selesai' : notStarted ? 'Belum mulai' : 'Mengerjakan'}
                </span>
                <p className="mt-1 text-[11px] font-medium text-slate-500 tabular-nums">
                  {savedAnswers} / {totalQuestions || '—'} terjawab
                </p>
              </div>
            </div>
          )}

          {irtScored > 0 && (
            <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">
                <AlertTriangle size={13} className="mr-1 inline text-amber-600" />
                Skor IRT sudah dihitung
              </p>
              <p className="mt-0.5 text-amber-800">
                Skor IRT lama akan dihapus. Setelah siswa selesai, tekan <strong>Kalkulasi IRT</strong> lagi.
              </p>
            </div>
          )}

          {!participantSummary && offlineNotes.length > 0 && (
            <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">Catatan sesi offline:</p>
              <p className="mt-0.5 text-amber-800">{offlineNotes.join(' ')}</p>
            </div>
          )}

          {/* Perangkat lain mencoba membuka ujian */}
          {!participantSummary && !notStarted && offline?.other_device_attempts && (
            <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle size={13} className="shrink-0" /> Ujian dibuka dari lebih dari satu perangkat
              </p>
              <p className="text-amber-800">
                Terikat: <strong>{attempt.device_holder ? deviceLabel(attempt.device_holder) : 'tidak diketahui'}</strong> · Ditolak: <strong>{deviceLabel(offline.other_device_attempts.last_context)}</strong> ({offline.other_device_attempts.count}×, {formatTime(offline.other_device_attempts.last_at)}).
              </p>
              <p className="text-amber-800">
                Tanyakan siswa apakah perangkat ujian itu miliknya: pilih{' '}
                <button type="button" className="font-semibold text-blue-700 underline" onClick={() => { handleModeSelect('PULIHKAN'); setReleaseDevice(true); }}>Pindahkan ke perangkat baru</button>
                {' '}atau{' '}
                <button type="button" className="font-semibold text-amber-900 underline" onClick={() => handleModeSelect('SUSULAN')}>Susulan</button>.
              </p>
            </div>
          )}

          {/* Mode Selection */}
          {!notStarted && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleModeSelect('PULIHKAN')}
                className={`rounded-xl border p-2.5 text-left transition-all ${
                  mode === 'PULIHKAN'
                    ? 'border-[#3083FF] bg-[#3083FF]/5 ring-1 ring-[#3083FF]/30'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="font-bold text-xs text-slate-800">Pulihkan</div>
                <p className="mt-0.5 text-[11px] text-slate-500">Jawaban tersimpan tetap aman</p>
              </button>

              <button
                type="button"
                onClick={() => handleModeSelect('SUSULAN')}
                className={`rounded-xl border p-2.5 text-left transition-all ${
                  mode === 'SUSULAN'
                    ? 'border-amber-500 bg-amber-50/50 ring-1 ring-amber-500/30'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="font-bold text-xs text-slate-800">{isActive ? 'Mulai Ulang' : 'Susulan'}</div>
                <p className="mt-0.5 text-[11px] text-slate-500">Ulangi dari awal, hapus jawaban</p>
              </button>
            </div>
          )}

          {/* Durasi Waktu */}
          <div>
            <label htmlFor="reset-duration-input" className="block text-xs font-bold text-slate-700 mb-1.5">
              Durasi Waktu (Menit) <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                id="reset-duration-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Menit"
                value={durationInput}
                onChange={(e) => {
                  const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
                  setDurationInput(digitsOnly);
                }}
                className="h-9 w-24 rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-800 outline-none focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15"
              />
              {quickDurations.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDurationInput(String(mins))}
                  className={`h-9 px-2.5 rounded-lg text-xs font-semibold border transition-all ${
                    duration === mins
                      ? 'border-[#3083FF] bg-[#3083FF] text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>

          {/* Alasan Pemulihan / Susulan */}
          <div>
            <label htmlFor="reset-reason-input" className="block text-xs font-bold text-slate-700 mb-1.5">
              Alasan {mode === 'PULIHKAN' ? 'Pemulihan' : 'Susulan'} <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reset-reason-input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tuliskan alasan singkat (min. 5 karakter)..."
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 outline-none focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15 placeholder:text-slate-400"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {PRESET_REASONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:border-[#3083FF]/40 hover:bg-[#3083FF]/10 hover:text-[#3083FF]"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Panel Opsi Sesuai Mode (Tinggi Konsisten) */}
          {mode === 'PULIHKAN' && (
            <div className="min-h-[148px] flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 space-y-2">
              {!(releaseDevice && !participantSummary) && (
                <div className="space-y-1.5">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" name="recovery-kind" className="mt-0.5" checked={submitOnly || !isActive} onChange={() => setSubmitOnly(true)} />
                    <span className="leading-snug">
                      <span className="font-semibold text-slate-800">Kirim ulang jawaban saja</span>
                      <span className="block text-[11px] text-slate-500">Kirim jawaban dari perangkat siswa tanpa mengubah isinya.</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-2 cursor-pointer ${isActive ? '' : 'opacity-50'}`}>
                    <input type="radio" name="recovery-kind" className="mt-0.5" disabled={!isActive} checked={isActive && !submitOnly} onChange={() => setSubmitOnly(false)} />
                    <span className="leading-snug">
                      <span className="font-semibold text-slate-800">Lanjutkan mengerjakan</span>
                      <span className="block text-[11px] text-slate-500">
                        {isActive ? 'Siswa dapat mengubah jawaban hingga waktu habis.' : 'Hanya untuk sesi yang masih berjalan.'}
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {!participantSummary && (
                <div className={`${!(releaseDevice && !participantSummary) ? 'border-t border-slate-100 pt-2' : ''}`}>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={releaseDevice} onChange={event => setReleaseDevice(event.target.checked)} />
                    <span className="leading-snug">
                      <span className="font-semibold text-slate-800">Pindahkan ke perangkat baru</span>
                      <span className="block text-[11px] text-slate-500">Lepas kunci perangkat pertama jika perangkat lama rusak/mati.</span>
                    </span>
                  </label>
                  {releaseDevice && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
                      Melanjutkan <strong>{savedAnswers} jawaban di server</strong>.
                      {offline?.uncounted_local_answers
                        ? ` ${offline.uncounted_local_answers.count} jawaban di perangkat lama tidak ikut pindah.`
                        : ' Jawaban yang belum terkirim dari perangkat lama tidak ikut pindah.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Info / Konfirmasi untuk SUSULAN */}
          {mode === 'SUSULAN' && notStarted && (
            <div role="note" className="min-h-[148px] flex flex-col justify-center rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="font-semibold">Sesi Ujian Susulan</p>
              <p className="mt-1 text-blue-800 leading-relaxed">
                Jadwal ujian tidak berubah. Sesi khusus dibuka untuk <strong>{studentName}</strong> selama {duration || resolvedExamDuration} menit sejak diaktifkan.
              </p>
            </div>
          )}

          {mode === 'SUSULAN' && !notStarted && (
            <div className="min-h-[148px] flex flex-col justify-between rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-xs text-amber-900">
              <div>
                <p className="font-semibold text-amber-900">Konfirmasi Ujian Susulan</p>
                <p className="mt-1 text-[11px] text-amber-800 leading-relaxed">
                  Seluruh jawaban ({savedAnswers} soal) dan nilai lama milik <strong>{participantSummary || studentName}</strong> akan dihapus permanen agar siswa dapat mengulang ujian dari awal.
                </p>
              </div>
              <label className="mt-2 flex items-center gap-2 border-t border-amber-200/80 pt-2.5 font-semibold cursor-pointer">
                <input type="checkbox" checked={confirmedClear} onChange={event => setConfirmedClear(event.target.checked)} />
                <span>Saya memahami jawaban lama akan dihapus permanen.</span>
              </label>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-500 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </ModalBody>

        <ModalFooter align="between">
          <Button
            type="button"
            variant="cancel"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Batal
          </Button>

          <Button
            type="submit"
            variant={mode === 'SUSULAN' ? 'danger' : 'primary'}
            isLoading={isSubmitting}
          >
            {isSubmitting
              ? 'Memproses...'
              : mode === 'SUSULAN'
                ? `${notStarted ? 'Buat Ujian Susulan' : isActive ? 'Mulai Ulang' : 'Aktifkan Susulan'}${duration > 0 ? ` (${duration}m)` : ''}`
                : releaseDevice && !participantSummary
                  ? `Pindahkan Perangkat${duration > 0 ? ` (${duration}m)` : ''}`
                  : submitOnly || !isActive
                    ? `Buka Pengiriman Jawaban${duration > 0 ? ` (${duration}m)` : ''}`
                    : `Atur Ulang Waktu${duration > 0 ? ` (${duration}m)` : ''}`}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
