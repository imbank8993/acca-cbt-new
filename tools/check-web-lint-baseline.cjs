const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'apps', 'web');
const baselinePath = path.join(root, 'docs', 'perbaikan-2026-09-19', 'eslint-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const eslintPackage = require.resolve('eslint/package.json', { paths: [webRoot] });
const eslintBin = path.join(path.dirname(eslintPackage), 'bin', 'eslint.js');

const run = spawnSync(process.execPath, [eslintBin, '.', '--format', 'json'], {
    cwd: webRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
});

if (run.error) throw run.error;
if (!run.stdout.trim()) {
    process.stderr.write(run.stderr || 'ESLint tidak menghasilkan laporan.\n');
    process.exit(2);
}

let report;
try {
    report = JSON.parse(run.stdout);
} catch (error) {
    process.stderr.write(`Laporan ESLint tidak valid: ${error.message}\n${run.stderr}`);
    process.exit(2);
}

const counts = {};
let errors = 0;
let warnings = 0;
for (const file of report) {
    errors += file.errorCount || 0;
    warnings += file.warningCount || 0;
    for (const message of file.messages || []) {
        const rule = message.ruleId || '(configuration/parser)';
        counts[rule] = (counts[rule] || 0) + 1;
    }
}

if (process.argv.includes('--update')) {
    const orderedRules = Object.fromEntries(
        Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
    );
    fs.writeFileSync(baselinePath, `${JSON.stringify({
        capturedAt: new Date().toISOString().slice(0, 10),
        errors,
        warnings,
        rules: orderedRules,
    }, null, 2)}\n`);
    process.stdout.write(`Baseline diperbarui: ${errors} error, ${warnings} warning.\n`);
    process.exit(0);
}

const regressions = [];
for (const [rule, count] of Object.entries(counts)) {
    const allowed = baseline.rules[rule] || 0;
    if (count > allowed) regressions.push(`${rule}: ${count} (baseline ${allowed})`);
}
if (errors > baseline.errors) regressions.push(`total error: ${errors} (baseline ${baseline.errors})`);
if (warnings > baseline.warnings) regressions.push(`total warning: ${warnings} (baseline ${baseline.warnings})`);

process.stdout.write(`ESLint web: ${errors} error, ${warnings} warning.\n`);
if (regressions.length > 0) {
    process.stderr.write(`Regresi terhadap baseline:\n- ${regressions.join('\n- ')}\n`);
    process.exit(1);
}
process.stdout.write('Tidak ada pelanggaran baru terhadap baseline.\n');
