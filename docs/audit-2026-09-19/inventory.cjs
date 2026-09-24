// Read-only source inventory. Run from the repository root.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = process.cwd();
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '.next', '.git', '.venv', '__pycache__', 'dist'].includes(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const paths = ['apps/web/app', 'apps/web/components', 'apps/web/lib', 'apps/api/src', 'apps/scoring/app', 'packages/shared/src'].flatMap(walk)
  .filter(p => /\.(tsx?|py|css)$/.test(p)).sort();
const inventory = paths.map(p => {
  const text = fs.readFileSync(p, 'utf8');
  const name = p.replaceAll('\\', '/');
  const row = { file: name, lines: text.split(/\r?\n/).length, sha256: crypto.createHash('sha256').update(text).digest('hex') };
  if (p.endsWith('.tsx')) {
    const ast = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    row.imports = ast.statements.filter(ts.isImportDeclaration).map(s => s.moduleSpecifier.text);
    row.handlers = [];
    row.accessibilityCandidates = [];
    function visit(n) {
      if (ts.isVariableDeclaration(n) && /^(handle|load|fetch|save|delete|submit|export|format)/.test(n.name.getText(ast))) {
        row.handlers.push({ name: n.name.getText(ast), line: ast.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
      }
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(ast);
        const attrs = n.attributes.properties.filter(ts.isJsxAttribute).map(a => a.name.getText(ast));
        if (['div', 'motion.div', 'span'].includes(tag) && attrs.includes('onClick') && !attrs.includes('onKeyDown') && !attrs.includes('role')) {
          row.accessibilityCandidates.push({ tag, line: ast.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(ast);
  }
  return row;
});
fs.writeFileSync(path.join(__dirname, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
const pages = inventory.filter(r => r.file.endsWith('/page.tsx'));
console.log(JSON.stringify({files: inventory.length, lines: inventory.reduce((n,r)=>n+r.lines,0), pages: pages.length, pageLines: pages.reduce((n,r)=>n+r.lines,0)}, null, 2));
console.log(pages.map(r => `${r.file.replace(root.replaceAll('\\','/')+'/', '')}: ${r.lines} lines; handlers ${r.handlers.map(h=>h.name+':'+h.line).join(', ')}; keyboard candidates ${r.accessibilityCandidates.map(c=>c.line).join(',')}`).join('\n'));
