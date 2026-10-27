'use client';

import { useId, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { TopicAnalysis, TopicResult } from '@acca-cbt/shared';
import { Button } from '@/app/components/ui/button';
import './topic-analysis.css';

function topicLevel(topic: TopicResult) {
    if (topic.percentage == null) return { label: 'Menunggu penilaian', tone: 'pending' };
    if (topic.percentage < 60) return { label: 'Prioritas penguatan', tone: 'weak' };
    if (topic.percentage < 80) return { label: 'Perlu latihan', tone: 'developing' };
    return { label: 'Hasil kuat', tone: 'strong' };
}

/** The same evidence and labels for the cohort and a student's own results. */
export function TopicAnalysisPanel({ analysis, personal = false }: { analysis?: TopicAnalysis | null; personal?: boolean }) {
    const headingId = useId();
    const [showAll, setShowAll] = useState(false);
    if (!analysis || (personal && !analysis.topics.length)) return null;
    const assessed = analysis.topics.filter(topic => topic.percentage != null);
    const priorities = assessed.filter(topic => topic.percentage! < 80).slice(0, 3);
    const strengths = assessed.filter(topic => topic.percentage! >= 80).sort((a, b) => b.percentage! - a.percentage!).slice(0, 3);
    const visible = showAll ? analysis.topics : analysis.topics.slice(0, 8);
    const summary = !analysis.topics.length ? 'Belum ada materi yang dipetakan. Isi materi pada kisi-kisi soal agar ringkasan dapat dibuat.'
        : !analysis.participantCount ? 'Ringkasan tersedia setelah ada peserta yang selesai mengerjakan ujian.'
        : !assessed.length ? 'Ringkasan akan dilengkapi setelah jawaban selesai dinilai.'
        : priorities.length ? `${personal ? 'Prioritaskan latihan pada materi' : 'Prioritaskan penguatan peserta pada materi'} ${priorities.map(topic => topic.name).join(', ')}.`
        : 'Hasil pada materi yang sudah dinilai menunjukkan ketepatan jawaban yang kuat.';

    return <section className="topic-analysis" aria-labelledby={headingId}>
        <header className="topic-analysis__header">
            <BookOpen size={19} aria-hidden="true" />
            <div><h2 id={headingId}>{personal ? 'Penguasaan materi kamu' : 'Analisis penguasaan materi'}</h2>
                <p>{personal ? 'Berdasarkan jawabanmu pada ujian ini.' : `Ringkasan seluruh ${analysis.participantCount} peserta yang selesai pada ujian terpilih.`}</p>
            </div>
        </header>
        <div className="topic-analysis__summary"><p>{summary}</p>
            {priorities.length > 0 && strengths.length > 0 && <p className="topic-analysis__strengths">Hasil kuat pada materi {strengths.map(topic => topic.name).join(', ')}.</p>}
            {analysis.topics.some(topic => topic.pending > 0) && <p className="topic-analysis__strengths">Masih ada jawaban menunggu koreksi; ringkasan ini bersifat sementara.</p>}
        </div>
        {analysis.topics.length > 0 && <>
            <ul className="topic-analysis__list">{visible.map(topic => {
                const level = topicLevel(topic);
                return <li key={topic.name} className={`topic-analysis__row is-${level.tone}`}>
                    <div className="topic-analysis__material"><h3>{topic.name}</h3>
                        <span>{topic.questionCount} soal{topic.questionCount === 1 ? ' · indikasi dari satu soal' : ''}</span>
                    </div>
                    <div className="topic-analysis__result"><div className="topic-analysis__metric">
                        <span className="topic-analysis__level">{level.label}</span><strong>{topic.percentage == null ? '—' : `${topic.percentage.toFixed(0)}%`}</strong>
                    </div>
                        <div className="topic-analysis__track" aria-hidden="true"><span style={{ width: `${topic.percentage ?? 0}%` }} /></div>
                        <p>{topic.correct} / {topic.assessed} jawaban benar · {topic.incorrect} salah · {topic.unanswered} kosong{topic.pending > 0 && ` · ${topic.pending} menunggu koreksi`}</p>
                    </div>
                </li>;
            })}</ul>
            {analysis.topics.length > 8 && <div className="topic-analysis__more"><Button variant="ghost" size="sm" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}>
                {showAll ? 'Tampilkan lebih sedikit' : `Lihat semua ${analysis.topics.length} materi`}
            </Button></div>}
            <footer className="topic-analysis__footer">
                <p>Ketepatan = jawaban benar ÷ (benar + salah + kosong). Jawaban menunggu koreksi tidak dihitung.</p>
                <p>Penguatan &lt;60% · Perlu latihan 60–79% · Hasil kuat ≥80%.</p>
                <p>{analysis.mappedQuestions} soal memiliki materi{analysis.unmappedQuestions > 0 && `; ${analysis.unmappedQuestions} soal belum dipetakan dan tidak masuk ringkasan ini`}. Soal dibatalkan dan penilaian kepribadian dikecualikan.</p>
            </footer>
        </>}
    </section>;
}
