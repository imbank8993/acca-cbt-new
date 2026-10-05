export async function downloadLearningTemplate(format: 'word' | 'latex' | 'html') {
    let blob: Blob; let name: string;
    if (format === 'word') {
        const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');
        const document = new Document({ sections: [{ children: [
            new Paragraph({ text: 'Judul Bahan Ajar', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Tujuan Pembelajaran', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Setelah mempelajari materi ini, siswa dapat menjelaskan konsep utama dan menerapkannya.'),
            new Paragraph({ text: 'Mari Memahami', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Tuliskan penjelasan materi di sini. Gunakan Heading 1 dan Heading 2 untuk membuat daftar isi otomatis.'),
            new Paragraph({ text: 'Contoh dan Pembahasan', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ children: [new TextRun({ text: 'Contoh: ', bold: true }), new TextRun('Masukkan contoh yang dekat dengan kehidupan siswa.')] }),
            new Paragraph({ text: 'Refleksi', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: 'Apa hal baru yang kamu pahami?', bullet: { level: 0 } }),
            new Paragraph({ text: 'Bagian mana yang ingin kamu tanyakan kepada guru?', bullet: { level: 0 } }),
        ] }] });
        blob = await Packer.toBlob(document); name = 'template-bahan-ajar.docx';
    } else if (format === 'latex') {
        blob = new Blob([String.raw`\documentclass{article}
\title{Mengenal Persamaan Kuadrat}
\begin{document}
\maketitle
\section{Tujuan Pembelajaran}
Siswa dapat mengenali bentuk persamaan kuadrat dan menentukan akarnya.
\section{Konsep Utama}
Bentuk umum persamaan kuadrat adalah $ax^2+bx+c=0$, dengan $a\neq 0$.
\subsection{Rumus Kuadrat}
\[
x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}
\]
\section{Langkah Belajar}
\begin{enumerate}
\item Tentukan nilai a, b, dan c.
\item Hitung diskriminan.
\item Gunakan rumus kuadrat.
\end{enumerate}
\section{Refleksi}
Bagaimana hubungan diskriminan dengan banyaknya akar real?
\end{document}
`], { type: 'text/plain' }); name = 'template-bahan-ajar.tex';
    } else {
        blob = new Blob([`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Belajar Pecahan</title><style>body{max-width:760px;margin:auto;font-family:system-ui;padding:24px}section{padding:24px;background:#f0fdfa;border-radius:16px;margin:20px 0}button{padding:12px 20px;border:0;border-radius:8px;background:#0f766e;color:white;cursor:pointer}input{width:100%}#bar{height:36px;background:#0d9488;border-radius:8px}</style></head><body>
<h1>Mengenal Pecahan</h1><p>Geser pengatur di bawah untuk melihat bagian dari satu keseluruhan.</p>
<section><h2>Coba sendiri</h2><label for="fraction">Bagian: <strong id="value">1/2</strong></label><input id="fraction" type="range" min="0" max="4" value="2"><div style="background:#ccfbf1;border-radius:8px"><div id="bar" style="width:50%"></div></div></section>
<section><h2>Cek pemahaman</h2><p>Manakah yang sama dengan 1/2?</p><button onclick="jawab('Tepat! 2/4 = 1/2.')">2/4</button> <button onclick="jawab('Coba lagi. Bandingkan menggunakan pengatur di atas.')">3/4</button><p id="feedback" role="status"></p></section>
<script>function jawab(teks){document.getElementById('feedback').textContent=teks;window.ACCALMS?.setState({feedback:teks});}window.addEventListener('lms:ready',function(event){document.getElementById('feedback').textContent=event.detail.state?.feedback||'';});document.getElementById('fraction').addEventListener('input',function(){document.getElementById('value').textContent=this.value+'/4';document.getElementById('bar').style.width=(this.value*25)+'%';});</script>
</body></html>`], { type: 'text/html' }); name = 'template-bahan-ajar.html';
    }
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
