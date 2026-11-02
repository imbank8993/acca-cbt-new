"use client";

import React from 'react';
import { BookMarked, KeyRound, Lightbulb } from 'lucide-react';
import type { DimensionItem, KisiKisiItem, QuestionRecord } from '@/lib/api/questions';
import { QuestionContent } from '@/app/components/questions/QuestionRenderer';

/** Relasi dari API review dapat berupa objek tunggal atau larik. */
type ReviewQuestion = QuestionRecord & { kisi_kisi?: KisiKisiItem | KisiKisiItem[] | null };

function first<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/**
 * Konteks yang dibutuhkan untuk menelaah butir: kisi-kisi (materi, indikator,
 * level kognitif), petunjuk pengerjaan, dan dimensi.
 */
export function ValidationQuestionContext({ question }: { question: ReviewQuestion }) {
    const kisi = first(question.kisi_kisi);
    const legacyKisi = typeof question.metadata?.kisi_kisi === 'string' ? question.metadata.kisi_kisi.trim() : '';
    const instruction = first(question.instruction)?.content;
    const dimension: DimensionItem | null = first(question.dimension) || first(question.question_dimensions);
    const hasKisi = Boolean(kisi?.materi || kisi?.indikator_soal || kisi?.level_kognitif || legacyKisi);

    return (
        <div className="space-y-2">
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 text-xs space-y-1.5">
                <p className="flex items-center gap-1.5 font-bold text-indigo-800 dark:text-indigo-300">
                    <BookMarked size={14} aria-hidden="true" /> Kisi-kisi butir
                </p>
                {hasKisi ? (
                    <dl className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-slate-700 dark:text-slate-200">
                        {kisi?.materi && (<><dt className="font-semibold text-slate-500 dark:text-slate-400">Materi</dt><dd>{kisi.materi}</dd></>)}
                        {kisi?.indikator_soal && (<><dt className="font-semibold text-slate-500 dark:text-slate-400">Indikator soal</dt><dd>{kisi.indikator_soal}</dd></>)}
                        {kisi?.level_kognitif && (<><dt className="font-semibold text-slate-500 dark:text-slate-400">Level kognitif</dt><dd>{kisi.level_kognitif}</dd></>)}
                        {!kisi && legacyKisi && (<><dt className="font-semibold text-slate-500 dark:text-slate-400">Kisi-kisi</dt><dd>{legacyKisi}</dd></>)}
                    </dl>
                ) : (
                    <p className="text-amber-700 dark:text-amber-300">Butir ini belum terhubung ke kisi-kisi, sehingga kesesuaian dengan indikator tidak dapat diperiksa.</p>
                )}
                {dimension?.name && (
                    <p className="text-slate-600 dark:text-slate-300"><span className="font-semibold">Dimensi:</span> {dimension.name}</p>
                )}
            </div>
            {instruction && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3 text-xs space-y-1">
                    <p className="font-bold text-slate-600 dark:text-slate-300">Petunjuk pengerjaan</p>
                    <div className="prose dark:prose-invert max-w-none text-xs">
                        <QuestionContent content={instruction} />
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Kunci yang tidak tampak dari daftar opsi: jawaban isian, urutan benar, dan
 * pembahasan/pedoman penskoran (termasuk uraian).
 */
export function ValidationAnswerKey({ question }: { question: ReviewQuestion }) {
    const metadata = question.metadata || {};
    const options = question.bank_question_options || question.options || [];
    const pembahasan = typeof metadata.pembahasan === 'string' ? metadata.pembahasan.trim() : '';
    const blocks: React.ReactNode[] = [];

    if (question.type === 'short_answer') {
        const blanks = Array.isArray(metadata.blanks) ? metadata.blanks : [];
        blocks.push(
            <div key="blanks" className="space-y-1">
                <p className="font-bold text-emerald-800 dark:text-emerald-300">Kunci isian</p>
                {blanks.length ? (
                    <ol className="list-decimal pl-5 space-y-0.5">
                        {blanks.map((blank, index) => {
                            const variations = (Array.isArray(blank.variations) ? blank.variations : []).filter(Boolean);
                            return (
                                <li key={index}>
                                    <span className="font-semibold">{blank.answer || '—'}</span>
                                    {variations.length > 0 && <span className="text-slate-500 dark:text-slate-400"> (juga diterima: {variations.join(', ')})</span>}
                                </li>
                            );
                        })}
                    </ol>
                ) : <p className="text-amber-700 dark:text-amber-300">Kunci isian belum diisi.</p>}
            </div>,
        );
    }

    if (question.type === 'ordering' || question.type === 'ranking') {
        const order = Array.isArray(metadata.correct_order) ? metadata.correct_order.map(String) : [];
        const byKey = new Map(options.map((option, index) => [String(option.id ?? option.order ?? index), option]));
        const sequence = order.length
            ? order.map(key => byKey.get(key)).filter((option): option is NonNullable<typeof option> => Boolean(option))
            : options;
        blocks.push(
            <div key="order" className="space-y-1">
                <p className="font-bold text-emerald-800 dark:text-emerald-300">Urutan yang benar</p>
                {!order.length && <p className="text-amber-700 dark:text-amber-300">Urutan kunci belum diatur; ditampilkan sesuai urutan opsi tersimpan.</p>}
                <ol className="list-decimal pl-5 space-y-0.5">
                    {sequence.map((option, index) => (
                        <li key={option.id || index}><QuestionContent content={option.option_text || option.text || ''} /></li>
                    ))}
                </ol>
            </div>,
        );
    }

    if (question.type === 'essay' && !pembahasan) {
        blocks.push(
            <p key="essay" className="text-amber-700 dark:text-amber-300">
                Soal uraian dinilai manual, tetapi belum ada pembahasan atau pedoman penskoran yang dapat diperiksa.
            </p>,
        );
    }

    if (pembahasan) {
        blocks.push(
            <div key="pembahasan" className="space-y-1">
                <p className="flex items-center gap-1 font-bold text-emerald-800 dark:text-emerald-300">
                    <Lightbulb size={13} aria-hidden="true" /> {question.type === 'essay' ? 'Pedoman penskoran / pembahasan' : 'Pembahasan'}
                </p>
                <div className="prose dark:prose-invert max-w-none text-xs"><QuestionContent content={pembahasan} /></div>
            </div>,
        );
    }

    if (!blocks.length) return null;
    return (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-xs text-slate-700 dark:text-slate-200 space-y-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <KeyRound size={13} aria-hidden="true" /> Kunci & pembahasan
            </p>
            {blocks}
        </div>
    );
}
