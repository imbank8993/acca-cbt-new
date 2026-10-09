'use client';

import React, { useState, useEffect } from 'react';
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
  Sparkles,
  BookOpen,
  Flame,
} from 'lucide-react';

export type ResetMode = 'PULIHKAN' | 'SUSULAN';

export interface ResetExamModalProps {
  open: boolean;
  attempt: ExamAttemptRecord | null;
  onClose: () => void;
  onSuccess?: () => void;
  onConfirm?: (attemptId: string, mode: ResetMode, reason: string, durationMinutes: number) => Promise<void>;
}

const PRESET_REASONS = [
  'Gangguan koneksi internet',
  'Listrik padam / Laptop mati',
  'Browser crash atau terkeluar',
  'Izin sakit / Ujian susulan',
  'Salah menekan tombol selesai',
];

const QUICK_DURATIONS = [15, 30, 45, 60, 90, 120];

export function ResetExamModal({
  open,
  attempt,
  onClose,
  onSuccess,
  onConfirm,
}: ResetExamModalProps) {
  const [mode, setMode] = useState<ResetMode>('PULIHKAN');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<number>(15);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset form state when modal opens with attempt
  useEffect(() => {
    if (open && attempt) {
      setMode('PULIHKAN');
      setReason('');
      setDuration(15);
      setErrorMessage(null);
    }
  }, [open, attempt]);

  // Adjust default duration when mode changes
  const handleModeSelect = (newMode: ResetMode) => {
    setMode(newMode);
    if (newMode === 'PULIHKAN' && duration > 45) {
      setDuration(15);
    } else if (newMode === 'SUSULAN' && duration < 30) {
      setDuration(60);
    }
  };

  if (!open || !attempt) return null;

  const studentName = formatStudentName(attempt.profiles?.full_name, 'Siswa');
  const className = attempt.kelas_name || '—';
  const nis = attempt.profiles?.identity_number || '—';
  const savedAnswers = attempt.saved_answer_count ?? 0;
  const totalQuestions = attempt.total_questions ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      variant={mode === 'SUSULAN' ? 'delete' : 'add'}
      labelledBy="reset-exam-modal-title"
    >
      <ModalHeader
        id="reset-exam-modal-title"
        title="Tindakan Pemulihan / Susulan Ujian"
        subtitle={`Atur sesi pengerjaan ujian untuk ${studentName}`}
        icon={<RotateCcw className="text-[#3083FF]" size={20} />}
        onClose={isSubmitting ? undefined : onClose}
      />

      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          {/* Student Info Summary Card */}
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

          {/* Mode Selection Cards */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Pilih Jenis Tindakan <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: PULIHKAN */}
              <button
                type="button"
                onClick={() => handleModeSelect('PULIHKAN')}
                className={`relative flex flex-col justify-between rounded-xl border-2 p-4 text-left transition-all ${
                  mode === 'PULIHKAN'
                    ? 'border-[#3083FF] bg-blue-50/60 shadow-md ring-2 ring-[#3083FF]/20'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        mode === 'PULIHKAN' ? 'bg-[#3083FF] text-white' : 'bg-blue-100 text-[#3083FF]'
                      }`}>
                        <ShieldCheck size={18} />
                      </span>
                      <span className="font-bold text-sm text-slate-800">PULIHKAN</span>
                    </div>
                    {mode === 'PULIHKAN' && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#3083FF] text-white">
                        <CheckCircle2 size={14} />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Mempertahankan semua jawaban tersimpan di server. Mengaktifkan kembali sesi agar siswa bisa melanjutkan / mengirim jawaban.
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-[#3083FF] bg-white/80 border border-blue-200/80 rounded-lg px-2.5 py-1 w-fit">
                  <Sparkles size={12} /> Jawaban Lama Dipertahankan
                </div>
              </button>

              {/* Option 2: SUSULAN */}
              <button
                type="button"
                onClick={() => handleModeSelect('SUSULAN')}
                className={`relative flex flex-col justify-between rounded-xl border-2 p-4 text-left transition-all ${
                  mode === 'SUSULAN'
                    ? 'border-amber-500 bg-amber-50/60 shadow-md ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        mode === 'SUSULAN' ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-600'
                      }`}>
                        <Flame size={18} />
                      </span>
                      <span className="font-bold text-sm text-slate-800">SUSULAN</span>
                    </div>
                    {mode === 'SUSULAN' && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white">
                        <CheckCircle2 size={14} />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Menghapus SEMUA jawaban & nilai lama. Memulai sesi baru dari awal dengan waktu pengerjaan utuh.
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-white/80 border border-amber-200/80 rounded-lg px-2.5 py-1 w-fit">
                  <AlertTriangle size={12} /> Jawaban Lama Dihapus
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
                  {mode === 'PULIHKAN' ? 'Default: 15 menit' : 'Default: 60 menit'}
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
                  {QUICK_DURATIONS.map((mins) => (
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
                  Semua {savedAnswers} jawaban dan nilai lama milik <strong>{studentName}</strong> akan dihapus permanen. Hasil ujian baru akan dimasukkan ke dalam rekap ujian.
                </p>
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
                ? `Aktifkan Ujian Susulan (${duration} Min)`
                : `Konfirmasi Pulihkan Ujian (${duration} Min)`}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
