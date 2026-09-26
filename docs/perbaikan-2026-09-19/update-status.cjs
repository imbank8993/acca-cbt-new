const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const findings = JSON.parse(fs.readFileSync(path.join(root, 'docs/audit-2026-09-19/findings.json')));
const stages = {
    1: ['SEC-01','SEC-02','SEC-04','SEC-14','BUG-13','UX-04'],
    2: ['SEC-05','SEC-06','SEC-07','SEC-08','SEC-09','SEC-11','BUG-01','BUG-06','BUG-07'],
    3: ['BUG-15','BUG-16'],
    4: ['SEC-03','SEC-10','BUG-03','BUG-08','BUG-09','BUG-10','UX-01'],
    5: ['SEC-12','SEC-13','BUG-02','BUG-04','BUG-05'],
    6: ['BUG-14','UX-02','UX-03','UX-05','UX-06','UX-07','UX-08','UX-09','UX-10','UX-11','UX-12'],
    7: ['QA-01'],
    9: ['BUG-11'],
    10: ['BUG-12'],
    11: ['QA-02'],
    12: ['QA-03'],
};
const additionalFindings = [{
    id: 'IMP-01', priority: 'P1',
    title: 'Urutan nomor soal dan relasi stimulus berubah saat impor massal',
}];
const rows = [...findings, ...additionalFindings].map(f => {
    const stage = f.id === 'SEC-14'
        ? '1 + 4'
        : f.id === 'IMP-01' ? '8'
        : Object.entries(stages).find(([, ids]) => ids.includes(f.id))?.[0];
    const status = stage ? 'Implementasi dan tes lokal selesai' : 'Belum dikerjakan';
    return { id: f.id, priority: f.priority, title: f.id === 'BUG-15' ? 'Regrade mengabaikan kontribusi nilai esai pada total' : f.title, stage: stage || null, status };
});
fs.writeFileSync(path.join(__dirname, 'status.json'), JSON.stringify(rows, null, 2)+'\n');
fs.writeFileSync(path.join(__dirname, 'STATUS_TEMUAN.md'), `# Status temuan audit\n\nDiperbarui 26 September 2026. [Rincian perubahan dan pengujian](../PERBAIKAN_AUDIT_2026-09-19.md). Tracker memuat 45 temuan audit awal dan temuan tambahan IMP-01. Status selesai adalah implementasi dan tes lokal, belum validasi deployment atau database sekolah.\n\n| ID | Prioritas | Tahap | Status | Temuan |\n|---|---|---|---|---|\n${rows.map(r=>`| ${r.id} | ${r.priority} | ${r.stage || '—'} | ${r.status} | ${r.title} |`).join('\n')}\n`);
