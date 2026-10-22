import { redirect } from 'next/navigation';

/**
 * Halaman editor lama. Tidak lagi ditautkan dari mana pun dan berperilaku
 * berbeda dari editor utama (versi admin/proktor bahkan mengosongkan topik
 * soal esai multi-topik saat menyimpan). Tautan lama dialihkan ke halaman bank
 * soal, tempat editor yang dipelihara (QuestionEditorModal) dipakai.
 */
export default async function LegacyQuestionEditPage({ params }: { params: Promise<{ bankId: string }> }) {
    const { bankId } = await params;
    redirect(`/dashboard/proktor/questions/${encodeURIComponent(bankId)}`);
}
