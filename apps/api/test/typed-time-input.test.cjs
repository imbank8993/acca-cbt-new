const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../../web/tsconfig.json'), transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const { parseTypedTime } = require('../../web/lib/time-input.ts');
test('typed time accepts compact and separated keyboard input', () => {
    for (const [input, expected] of [['0830','08:30'],['830','08:30'],['8:30','08:30'],['08.30','08:30'],['9:5','09:05'],[' 23:59 ','23:59'],['0000','00:00']])
        assert.equal(parseTypedTime(input),expected);
});
test('typed time rejects unfinished input, malformed text and out-of-range times', () => {
    for (const input of ['', '08:', '08', '24:00', '2360', '8:99', '08000', '8am', '12::30', '-1:00', '08/30'])
        assert.equal(parseTypedTime(input),null);
});
