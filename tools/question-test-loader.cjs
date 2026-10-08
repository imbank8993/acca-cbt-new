const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createRequire } = require('node:module');
const modules = new Map();
const rootDir = path.resolve(__dirname, '..');
function load(filename) {
    const file = path.isAbsolute(filename) ? filename : path.resolve(rootDir, filename);
    if (modules.has(file)) return modules.get(file).exports;
    let source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('doc-parser.ts')) source += '\nexport { parseQuestionTable, parseAllTables };';
    const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,experimentalDecorators:true}}).outputText;
    const module = {exports:{}}; modules.set(file,module);
    const nodeRequire = createRequire(file);
    const req = name => {
        let resolved = name.startsWith('.') ? path.resolve(path.dirname(file),name) : name.startsWith('@/') ? path.resolve(rootDir, 'apps/web',name.slice(2)) : null;
        if (resolved && fs.existsSync(resolved+'.ts')) return load(resolved+'.ts');
        return nodeRequire(name);
    };
    new Function('require','module','exports',code)(req,module,module.exports);
    return module.exports;
}

module.exports = { load };
