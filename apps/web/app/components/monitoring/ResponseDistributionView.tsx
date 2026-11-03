'use client';

import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import type { ResponseChoice, ResponseGroup } from '@/lib/api/proctor';
import { formatStudentName } from '@/lib/monitoring-health';
import { getQuestionSnippet } from '@/lib/question-snippet';

const FLAG_LABELS: Record<ResponseChoice['flags'][number], { text: string; hint: string }> = {
    nonfunctional: { text: 'Jarang dipilih', hint: 'Dipilih kurang dari 5% peserta: pengecoh tidak berfungsi, pertimbangkan untuk diganti.' },
    attracts_upper: { text: 'Menarik kelompok atas', hint: 'Lebih banyak dipilih siswa berkemampuan tinggi: periksa apakah opsi ini ambigu atau juga benar.' },
    key_negative: { text: 'Periksa kunci', hint: 'Jawaban benar lebih banyak dipilih kelompok bawah: periksa kemungkinan salah kunci atau soal menyesatkan.' },
};

const GROUP_TITLE: Record<ResponseGroup['kind'], string> = {
    single: 'Pilihan jawaban', multi: 'Opsi yang dipilih siswa', statement: 'Pernyataan', position: 'Urutan', free: 'Jawaban siswa',
};

const latexInline = '!font-sans !text-xs !leading-normal [&_p]:!m-0 [&_p]:inline';

/**
 * Sebaran jawaban untuk semua jenis soal objektif. Jawaban benar ditandai warna (hijau),
 * tanpa label teks. Daya beda per opsi (D) dan penanda pengecoh mengikuti analisis klasik:
 * pengecoh berfungsi bila dipilih ≥ 5% peserta; kunci seharusnya ber-D positif, pengecoh negatif.
 */
export function ResponseDistributionView({ groups }: { groups: ResponseGroup[] }) {
    const showD = groups.some(group => group.choices.some(choice => choice.discrimination !== null));
    const showPercentage = groups.some(group => group.kind === 'multi');
    return <div className="rd">
        <div className="rd-legend">
            <span><i className="rd-dot is-key" />Jawaban benar</span>
            <span><i className="rd-dot" />{groups[0]?.kind === 'free' ? 'Jawaban lain' : 'Pengecoh'}</span>
            {showD && <span title="Proporsi kelompok atas (27%) dikurangi kelompok bawah yang memilih jawaban ini. Jawaban benar idealnya positif, pengecoh negatif.">D = daya beda opsi</span>}
            {showPercentage && <span>Persentase PG Kompleks dihitung per opsi, jadi totalnya bisa lebih dari 100%.</span>}
        </div>
        {groups.map(group => <section key={group.id} className="rd-group">
            <header className="rd-group__head">
                {group.label && <span className="rd-group__label">{group.label}</span>}
                <div className="rd-group__text">
                    {group.text && group.kind !== 'position'
                        ? <LatexRenderer text={getQuestionSnippet(group.text, 160)} className={latexInline} />
                        : <span className="rd-group__title">{group.kind === 'position' ? `Urutan ke-${group.label}` : group.text || GROUP_TITLE[group.kind]}</span>}
                </div>
                <span className={`rd-group__pct${group.correct_percentage < 50 ? ' is-low' : ''}`}>{group.correct_percentage.toFixed(0)}% tepat</span>
            </header>
            <ul className="rd-choices">
                {group.choices.map(choice => <li key={`${choice.value}:${choice.text}`} className={`rd-choice${choice.is_key ? ' is-key' : ''}`}>
                    <div className="rd-choice__main">
                        <span className="rd-choice__value" title={choice.value}>{choice.value}</span>
                        {choice.text && group.kind !== 'statement' && <span className="rd-choice__text">
                            <LatexRenderer text={getQuestionSnippet(choice.text, 90)} className={latexInline} />
                        </span>}
                    </div>
                    <div className="rd-choice__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, choice.percentage)}%` }} /></div>
                    <span className="rd-choice__count">{choice.count}<small> ({choice.percentage.toFixed(0)}%)</small></span>
                    {showD && <span className={`rd-choice__d${choice.discrimination === null ? '' : (choice.is_key ? choice.discrimination > 0 : choice.discrimination < 0) ? ' is-good' : choice.discrimination === 0 ? '' : ' is-bad'}`}
                        title="Daya beda opsi">{choice.discrimination === null ? '–' : `${choice.discrimination > 0 ? '+' : ''}${choice.discrimination.toFixed(2)}`}</span>}
                    {(choice.flags.length > 0 || choice.students.length > 0) && <div className="rd-choice__extra">
                        {choice.flags.map(flag => <span key={flag} className={`rd-flag rd-flag--${flag}`} title={FLAG_LABELS[flag].hint}>{FLAG_LABELS[flag].text}</span>)}
                        {choice.students.length > 0 && <details className="rd-students">
                            <summary>{choice.students.length} siswa</summary>
                            <p>{choice.students.map(name => formatStudentName(name, 'Tanpa Nama')).join(', ')}</p>
                        </details>}
                    </div>}
                </li>)}
            </ul>
            {group.empty > 0 && <p className="rd-empty">{group.empty} siswa tidak menjawab bagian ini.</p>}
        </section>)}
    </div>;
}
