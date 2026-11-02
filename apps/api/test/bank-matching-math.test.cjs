// Render the actual matching-answer JSX and InlineMath with a small hook host.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const execute = (source, requireModule) => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compile(source))(requireModule, module, module.exports);
    return module.exports;
};
const utils = execute(fs.readFileSync(path.join(root, 'apps/web/app/components/questions/math-utils.ts'), 'utf8'), name => name.endsWith('.css') ? {} : require(name));
const file = path.join(root, 'apps/web/app/components/questions/QuestionBankDetailPage.tsx');
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let answerJsx;
const findAnswer = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'InlineMath' && node.getText(ast).includes('matches.join')) {
        answerJsx = node.parent.getText(ast);
    }
    ts.forEachChild(node, findAnswer);
};
findAnswer(ast);

function renderAnswer(matches) {
    assert.ok(answerJsx, 'The bank matching answer must use the math renderer');
    const state = [], dependencies = [], effects = [];
    let cursor = 0;
    const React = {
        memo: component => component,
        createElement: (type, props, ...children) => typeof type === 'function' ? type(props || {}) : ({ type, props: props || {}, children }),
        useState(initial) {
            const slot = cursor++;
            if (!(slot in state)) state[slot] = initial;
            return [state[slot], value => { state[slot] = value; }];
        },
        useEffect(effect, deps) {
            const slot = cursor++;
            if (!dependencies[slot] || deps.some((value, index) => value !== dependencies[slot][index])) effects.push(effect);
            dependencies[slot] = deps;
        },
    };
    const { InlineMath } = execute(fs.readFileSync(path.join(root, 'apps/web/app/components/questions/InlineMath.tsx'), 'utf8'), name => name === 'react' ? React : utils);
    const render = execute(`const React = require('react'); const { InlineMath } = require('inline'); module.exports = matches => (${answerJsx});`, name => name === 'react' ? React : { InlineMath });
    let tree;
    for (let pass = 0; pass < 3; pass++) {
        cursor = 0;
        tree = render(matches);
        effects.splice(0).forEach(effect => effect());
    }
    return tree.children[0];
}

test('matching answers in the shared bank detail render numeric and fractional LaTeX', () => {
    for (const value of ['$10$', '$24$', '$60$', '$30$', String.raw`$\frac{8!}{2!\cdot6!}$`, String.raw`$\frac{8!}{2!\cdot6!}-8$`]) {
        const html = renderAnswer([value]).props.dangerouslySetInnerHTML.__html;
        assert.match(html, /class="katex"/);
        assert.doesNotMatch(html, /\$|\\frac/);
        if (value.includes('frac')) assert.match(html, /class="mfrac"/);
    }
});

test('matching answers preserve multiple pairs, plain labels and the empty-answer fallback', () => {
    const multiple = renderAnswer([String.raw`$\frac{1}{2}$`, '$x^2$']).props.dangerouslySetInnerHTML.__html;
    assert.equal((multiple.match(/class="katex"/g) || []).length, 2);
    assert.match(multiple, /, /);
    assert.equal(renderAnswer(['Pilihan A']).props.dangerouslySetInnerHTML.__html, 'Pilihan A');
    assert.deepEqual(renderAnswer([]).children, ['-']);
});
