// Render the real student exam viewer without API calls or a browser profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const files = {
    '@/lib/safe-url': 'apps/web/lib/safe-url.ts',
    ExamViewer: 'apps/web/app/components/questions/ExamViewer.tsx',
};
const loaded = new Map();
function load(name) {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'framer-motion') return {
        AnimatePresence: React.Fragment,
        motion: new Proxy({}, { get: (_, tag) => String(tag) }),
    };
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === '@/lib/monitoring-health') return { formatStudentName: value => value };
    if (name === '@/lib/security-violations') return { securityViolationLabel: value => value };
    if (name === './AssignmentUploader' || name === './ExamQuestionCard' || name === './ExamStatusNotice') {
        return new Proxy({}, { get: () => () => null });
    }
    if (loaded.has(name)) return loaded.get(name);
    if (!files[name]) throw new Error('Unexpected ExamViewer dependency: ' + name);
    const file = path.resolve(__dirname, '..', files[name]);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    loaded.set(name, module.exports);
    new Function('module', 'exports', 'require', code)(module, module.exports, load);
    loaded.set(name, module.exports);
    return module.exports;
}

const { ExamViewer } = load('ExamViewer');
function render(assignmentData, withQuestion) {
    return renderToStaticMarkup(React.createElement(ExamViewer, {
        mode: 'exam', isAssignment: true, examId: 'exam', userId: 'student', examTitle: 'Tugas',
        questions: withQuestion ? [{ id: 'q', type: 'essay', question_text: 'Soal', bank_question_options: [] }] : [],
        answers: {}, doubtfulAnswers: new Set(), onAnswerChange: () => {}, onToggleDoubtful: () => {},
        assignmentData,
    }));
}

for (const withQuestion of [false, true]) {
    const malicious = render({ documentUrl: 'javascript:alert(1)', videoUrl: 'data:text/html,<script>alert(1)</script>' }, withQuestion);
    assert.doesNotMatch(malicious, /Materi Referensi|<iframe|javascript:|data:text\/html/,
        'unsafe assignment links must be absent from both student layouts');
    if (!withQuestion) {
        assert.match(malicious, /Tugas tanpa soal/);
        assert.match(malicious, />Selesai</, 'a task without bank questions must still offer submission');
        assert.doesNotMatch(malicious, /1\/0/);
    }

    const trusted = render({ documentUrl: 'https://drive.google.com/file/d/example/view',
        videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk' }, withQuestion);
    assert.match(trusted, /href="https:\/\/drive\.google\.com\/file\/d\/example\/view"/);
    assert.match(trusted, /src="https:\/\/www\.youtube\.com\/embed\/abcdefghijk"/);

    const otherVideo = render({ videoUrl: 'https://cdn.example.test/lesson.mp4' }, withQuestion);
    assert.match(otherVideo, /href="https:\/\/cdn\.example\.test\/lesson\.mp4"/);
    assert.doesNotMatch(otherVideo, /<iframe/,
        'other safe video links stay accessible without embedding an arbitrary origin');
}
console.log('PASS: assignment reference links and embeds are safe in both student exam layouts');
