const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const findings = JSON.parse(fs.readFileSync(path.join(root, 'docs/audit-2026-09-19/findings.json')));
const stages = {
    1: ['SEC-01','SEC-02','SEC-04','SEC-14','BUG-13','UX-04'],
    2: ['SEC-05','SEC-06','SEC-07','SEC-08','SEC-09','SEC-11','BUG-01','BUG-06','BUG-07'],
    3: ['BUG-15','BUG-16'],
};
const rows = findings.map(f => {
    const stage = Object.entries(stages).find(([, ids]) => ids.includes(f.id))?.[0];
    const status = f.id === 'SEC-14' ? 'Parsial — menunggu penutupan SEC-10' : stage ? 'Implementasi dan tes lokal selesai' : 'Belum dikerjakan';
    return { id: f.id, priority: f.priority, title: f.id === 'BUG-15' ? 'Regrade mengabaikan kontribusi nilai esai pada total' : f.title, stage: stage || null, status };
});
fs.writeFileSync(path.join(__dirname, 'status.json'), JSON.stringify(rows, null, 2)+'\n');
fs.writeFileSync(path.join(__dirname, 'STATUS_TEMUAN.md'), `# Status temuan audit\n\nDiperbarui 20 September 2026. [Rincian perubahan dan pengujian](../PERBAIKAN_AUDIT_2026-09-19.md). Status selesai adalah implementasi lokal, belum validasi deployment. Tahap 4 masih berlangsung dan belum ditandai selesai.\n\n| ID | Prioritas | Tahap | Status | Temuan |\n|---|---|---|---|---|\n${rows.map(r=>`| ${r.id} | ${r.priority} | ${r.stage || '—'} | ${r.status} | ${r.title} |`).join('\n')}\n`);
