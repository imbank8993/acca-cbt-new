'use client';

import React, { useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { formatStudentName } from '@/lib/monitoring-health';
import { resetExamAttempt, startMakeupExam } from '@/lib/api/proctoring';
import {
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  BookOpen,
  Flame,
} from 'lucide-react';

export type ResetMode = 'PULIHKAN' | 'SUSULAN';

export interface ResetExamModalProps {
  open: boolean;
  attempt: ExamAttemptRecord | null;
  participantSummary?: string;
  examDuration?: number;
  onClose: () => void;
  onSuccess?: () => void;
  onConfirm?: (attemptId: string, mode: ResetMode, reason: string, durationMinutes: number) => Promise<void>;
}

const PRESET_REASONS = [
  'Gangguan koneksi internet',
  'Listrik padam / Laptop mati',
  'Browser crash/keluar',
  'Izin sakit / Ujian susulan',
  'Salah menekan tombol selesai',
];

const QUICK_DURATIONS = [15, 30, 45, 60, 90, 120];

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
}: ResetExamModalProps) {
  const [mode, setMode] = useState<ResetMode>('PULIHKAN');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<number>(15);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedClear, setConfirmedClear] = useState(false);

  const resolvedExamDuration = Number(
    examDuration ??
    attempt?.exams?.duration_minutes ??
    attempt?.exams?.duration ??
    60
  ) || 60;

  // Adjust default duration when mode changes
  const handleModeSelect = (newMode: ResetMode) => {
    setMode(newMode);
    if (newMode === 'PULIHKAN') {
      setDuration(15);
    } else if (newMode === 'SUSULAN') {
      setDuration(resolvedExamDuration);
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
  const offline = attempt.offline_review;
  const offlineNotes = [
    offline?.connection_lost_at_close
      ? `Waktu habis saat perangkat tanpa kontak${offline.connection_lost_at_close.gap_seconds != null
        ? ` (terakhir terhubung ${Math.max(1, Math.round(offline.connection_lost_at_close.gap_seconds / 60))} menit sebelum batas waktu)` : ''}.`
      : null,
    offline?.uncounted_local_answers
      ? `${offline.uncounted_local_answers.count} jawaban di perangkat siswa belum masuk ke server dan belum dinilai.`
      : null,
    offline?.late_security_evidence
      ? `${offline.late_security_evidence} catatan pengawasan susulan dari masa offline (lihat Riwayat). Tidak dihitung ke batas pelanggaran.`
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
    if (mode === 'SUSULAN' && !confirmedClear) {
      setErrorMessage('Konfirmasi penghapusan jawaban sebelum memulai ulang.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (onConfirm) {
        await onConfirm(attempt.id, mode, trimmedReason, duration);
      } else {
        const result = mode === 'SUSULAN'
          ? await startMakeupExam(attempt.id, trimmedReason, duration)
          : await resetExamAttempt(attempt.id, trimmedReason, duration);

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
        title={isActive ? 'Reset Sesi Pengerjaan' : 'Tindakan Pemulihan / Susulan Ujian'}
        icon={<RotateCcw className="text-[#3083FF]" size={20} />}
        onClose={isSubmitting ? undefined : onClose}
      />

      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          {participantSummary && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{participantSummary} Pilihan tindakan, durasi, dan alasan berlaku untuk semua siswa terpilih. Mode Susulan menghapus semua jawaban dan nilai lama mereka.</div>}
          {/* Student Info Summary Card */}
          {!participantSummary && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#3083FF]/10 text-[#3083FF] font-bold text-sm">
                {studentName[0]?.toUpperCase() || 'S'}
              </div>
              <div>
                <p className="font-bold text-slate-800 text-sm">{studentName}</p>
                <p className="text-slate-500">
                  NIS: <span className="font-mono text-slate-700">{nis}</span> · Kelas: <span className="font-medium text-slate-700">{className}</span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-white px-2.5 py-1 border border-slate-200 font-medium text-slate-600">
                <BookOpen size={12} className="inline mr-1 text-[#3083FF]" />
                {savedAnswers} / {totalQuestions || '—'} Soal Tersimpan
              </span>
              <span className={`rounded-md px-2.5 py-1 font-semibold uppercase text-[10px] tracking-wider ${
                attempt.status === 'auto_submitted'
                  ? 'bg-pink-100 text-pink-700 border border-pink-200'
                  : attempt.status === 'submitted'
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : 'bg-blue-100 text-blue-700 border border-blue-200'
              }`}>
                {attempt.status === 'auto_submitted' ? 'Terminated' : attempt.status === 'submitted' ? 'Selesai' : 'Mengerjakan'}
              </span>
            </div>
          </div>
          )}

          {!participantSummary && offlineNotes.length > 0 && (
            <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
              <p className="mb-1.5 flex items-center gap-1.5 font-bold">
                <AlertTriangle size={14} className="shrink-0" /> Periksa masa offline sebelum memulihkan
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {offlineNotes.map(note => <li key={note}>{note}</li>)}
              </ul>
            </div>
          )}

          {/* Mode Selection Cards */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
              Pilih Jenis Tindakan <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option 1: PULIHKAN */}
              <button
                type="button"
                onClick={() => handleModeSelect('PULIHKAN')}
                className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
                  mode === 'PULIHKAN'
                    ? 'border-[#3083FF] bg-[#3083FF]/5 shadow-xs'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} className={mode === 'PULIHKAN' ? 'text-[#3083FF]' : 'text-slate-400'} />
                      <span className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">PULIHKAN</span>
                    </div>
                    {mode === 'PULIHKAN' && (
                      <CheckCircle2 size={15} className="text-[#3083FF]" />
                    )}
                  </div>
                  <p className="text-[11px] italic text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    {isActive
                      ? attempt.metadata?.recovery_submit_only === true
                        ? 'Perpanjang waktu pengiriman. Jawaban tetap aman dan tidak dapat diubah.'
                        : 'Atur ulang waktu. Jawaban tersimpan tetap aman.'
                      : 'Buka kembali sesi. Jawaban tersimpan tetap aman.'}
                  </p>
                </div>
              </button>

              {/* Option 2: SUSULAN */}
              <button
                type="button"
                onClick={() => handleModeSelect('SUSULAN')}
                className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
                  mode === 'SUSULAN'
                    ? 'border-amber-500 bg-amber-50/40 shadow-xs'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Flame size={16} className={mode === 'SUSULAN' ? 'text-amber-500' : 'text-slate-400'} />
                      <span className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">{isActive ? 'MULAI ULANG' : 'SUSULAN'}</span>
                    </div>
                    {mode === 'SUSULAN' && (
                      <CheckCircle2 size={15} className="text-amber-500" />
                    )}
                  </div>
                  <p className="text-[11px] italic text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    Ulangi ujian dari awal. Semua jawaban dan nilai lama dihapus.
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Form Controls */}
          <div className="space-y-3.5 pt-1">
            {/* Durasi Waktu */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Clock size={14} className="text-[#3083FF]" />
                  Durasi Tambahan / Ujian (Menit) <span className="text-red-500">*</span>
                </label>
                <span className="text-[11px] text-slate-500">
                  {mode === 'PULIHKAN' ? 'Default: 15 menit' : `Default: ${resolvedExamDuration} menit`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
                  className="h-9 w-28 rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-800 outline-none focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {quickDurations.map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setDuration(mins)}
                      className={`h-9 px-2.5 rounded-lg text-xs font-semibold border transition-all ${
                        duration === mins
                          ? 'border-[#3083FF] bg-[#3083FF] text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {mode === 'PULIHKAN'
                  ? 'Tenggat baru dihitung: Waktu Sekarang + Menit Tambahan (hanya untuk pengiriman jawaban tersimpan).'
                  : 'Peserta diberikan waktu pengerjaan utuh dari awal selama durasi ini.'}
              </p>
            </div>

            {/* Alasan Pemulihan / Susulan */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Alasan {mode === 'PULIHKAN' ? 'Pemulihan' : 'Ujian Susulan'} <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Tuliskan alasan lengkap (misal: jaringan lokal terputus, gangguan komputer, dll)..."
                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 outline-none focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15 placeholder:text-slate-400"
              />

              {/* Preset Chips */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-400 mr-1">Preset:</span>
                {PRESET_REASONS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setReason(preset)}
                    className="rounded-full border border-slate-200 bg-slate-100/70 px-2.5 py-0.5 text-[11px] text-slate-600 hover:bg-[#3083FF]/10 hover:text-[#3083FF] hover:border-[#3083FF]/30 transition-all"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Warning Banner for SUSULAN */}
          {mode === 'SUSULAN' && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Perhatian Penting:</p>
                <p className="mt-0.5 text-amber-800">
                  Semua jawaban dan nilai lama milik <strong>{participantSummary || studentName}</strong> akan dihapus permanen. Siswa perlu memuat ulang halaman ujian untuk memulai sesi baru.
                </p>
                <label className="mt-2 flex items-center gap-2 font-semibold">
                  <input type="checkbox" checked={confirmedClear} onChange={event => setConfirmedClear(event.target.checked)} />
                  Saya memahami jawaban lama akan dihapus.
                </label>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-500 shrink-0" />
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
                ? `${isActive ? 'Mulai Ulang' : 'Aktifkan Ujian Susulan'} (${duration} Min)`
                : `${isActive ? 'Atur Ulang Waktu' : 'Konfirmasi Pulihkan Ujian'} (${duration} Min)`}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
