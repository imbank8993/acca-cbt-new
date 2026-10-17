const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { examClientContext } = require('../src/common/exam-client-context.ts');
const { examClientHeaders } = require('../../web/lib/exam-client-headers.ts');
const { activeMonitoringRows, activeMonitoringFacts } = require('../../web/lib/active-monitoring.ts');
const { fixtureDb } = require('./fixture-db.cjs');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { attemptHealth } = require('../src/common/attempt-health.ts');
const now = '2026-10-14T06:00:00Z';
const row = patch => ({ id: 'normal', status: 'in_progress', started_at: '2026-10-14T05:30:00Z',
    server_now: now, deadline_at: '2026-10-14T07:00:00Z', last_seen_at: now,
    saved_answer_count: 24, total_questions: 40, profiles: { full_name: 'Siswa A' }, ...patch });

test('trusted proxy context parses browser variants and validates IPv4/IPv6', () => {
    const get = (ua, ip) => examClientContext({ headers: { 'x-internal-key': 'secret',
        'x-cbt-client-ua': ua, 'x-cbt-client-ip': ip }, socket: { remoteAddress: '127.0.0.1' } }, 'secret');
    assert.deepEqual(get('Mozilla Windows Chrome/131.0 Safari/537.36 Edg/131.0', '::ffff:192.0.2.8'),
        { browser: 'Edge 131', os: 'Windows', ip_address: '192.0.2.8' });
    assert.equal(get('Android Chrome/131.0 SamsungBrowser/27.0', '2001:db8::1').browser, 'Samsung Internet 27');
    assert.equal(get('iPhone Version/18.1 Mobile Safari/605.1', '2001:db8::1').os, 'iOS');
    assert.equal(get('Firefox/132.0', 'not-an-ip').ip_address, null);
    assert.equal(get('', '').browser, null);
});
test('untrusted client headers cannot override server-observed context', () => {
    const request = { headers: { 'x-internal-key': 'wrong', 'x-cbt-client-ip': '192.0.2.8',
        'x-cbt-client-ua': 'Chrome/131.0', 'user-agent': 'Firefox/132.0' }, socket: { remoteAddress: '198.51.100.9' } };
    assert.deepEqual(examClientContext(request, 'secret'), { browser: 'Firefox 132', os: null, ip_address: '198.51.100.9' });
    request.headers['x-internal-key'] = '';
    assert.equal(examClientContext(request, '').browser, 'Firefox 132');
});

test('proxy ignores caller-supplied first address and context headers; missing peer stays unknown', () => {
    const headers = new Headers({ 'x-forwarded-for':'192.0.2.123, 198.51.100.9',
        'user-agent':'Firefox/132.0', 'x-cbt-client-ip':'203.0.113.7', 'x-internal-key':'fake' });
    const forwarded = examClientHeaders(headers,'secret');
    assert.equal(forwarded['x-cbt-client-ip'],'198.51.100.9');
    assert.equal(forwarded['x-internal-key'],'secret');
    assert.equal(examClientHeaders(new Headers(),'secret')['x-cbt-client-ip'],'');
    assert.equal(examClientContext({headers:{},socket:{remoteAddress:'127.0.0.1'}},'secret').ip_address,null);
});
test('heartbeat binds browser and network data to the owned attempt and exposes it to monitoring', async () => {
    const db = fixtureDb({ cbt_exam_attempts: [{ id:'a', user_id:'s', status:'in_progress', device_fingerprint:'device-id', metadata:{} }] }, [], { now });
    const service = new ProctoringService(db, {}, {});
    const context = { browser:'Chrome 131', os:'Windows', ip_address:'192.0.2.8' };
    await assert.rejects(service.heartbeat({ id:'other' }, 'a', 'device-id', undefined, context));
    await assert.rejects(service.heartbeat({ id:'s' }, 'a', 'other-device', undefined, context));
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.client_context, undefined);
    await service.heartbeat({ id:'s' }, 'a', 'device-id', undefined, context);
    const health = attemptHealth(db.tables.cbt_exam_attempts[0], {}, [], new Date(now), 40);
    assert.deepEqual(health.client_context, { ...context, observed_at:new Date(now).toISOString() });
    assert.equal(db.tables.cbt_exam_attempts[0].warning_count, undefined);
});
test('priority favors offline unsent answers, then ending sessions, and preserves input order', () => {
    const normal = row({});
    const ending = row({ id:'ending', deadline_at:'2026-10-14T06:03:00Z' });
    const offline = row({ id:'offline', last_seen_at:'2026-10-14T05:58:00Z',
        sync_health:{ receivedAt:now, pendingAnswerCount:3, localAnswerCount:24, storageState:'healthy' } });
    const input = [normal, ending, offline, row({ id:'done', status:'submitted' })];
    assert.deepEqual(activeMonitoringRows(input, 'all').map(item=>item.attempt.id), ['offline','ending','normal']);
    assert.deepEqual(input.map(item=>item.id), ['normal','ending','offline','done']);
    assert.deepEqual(activeMonitoringRows(input, 'offline').map(item=>item.attempt.id), ['offline']);
    assert.deepEqual(activeMonitoringRows(input, 'ending').map(item=>item.attempt.id), ['ending']);
    assert.equal(activeMonitoringRows(input, 'attention').length, 2);
});
test('stale reports are explicitly historical and contact expires after 45 seconds', () => {
    const attempt = row({ sync_health:{ receivedAt:now, pendingAnswerCount:2, localAnswerCount:24, storageState:'healthy' } });
    const old = activeMonitoringFacts(attempt, 46);
    assert.equal(old.connection, 'offline');
    assert.equal(old.fresh, false);
    assert.ok(old.reasons.includes('Terakhir: 2 jawaban menunggu sinkronisasi'));
    assert.equal(activeMonitoringFacts(row({ last_seen_at:null })).connection, 'unknown');
});
test('active table starts without a duplicate header and detail panel uses the latest roster data', () => {
    const state=[]; let cursor=0;
    const React = {
        createElement(type,props,...children) { return typeof type==='function' ? type(props) : {type,props:props||{},children}; },
        useState(initial) { const i=cursor++; if(!(i in state))state[i]=initial; return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value}]; },
        useRef(initial) { const i=cursor++; if(!(i in state))state[i]={current:initial};return state[i]; }, useEffect() {},
    };
    const source=fs.readFileSync(path.resolve(__dirname,'../../web/app/components/ActiveParticipantsPanel.tsx'),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const mod={exports:{}};
    const roomSource=fs.readFileSync(path.resolve(__dirname,'../../web/app/components/monitoring/ParticipantRoomInfo.tsx'),'utf8');
    const roomCode=ts.transpileModule(roomSource,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const roomMod={exports:{}};
    new Function('module','exports','React',roomCode)(roomMod,roomMod.exports,React);
    const modules={ react:React, '@/lib/active-monitoring':{activeMonitoringRows,activeMonitoringFacts},
        './monitoring/ParticipantRoomInfo':roomMod.exports,
        '@/lib/monitoring-time':require('../../web/lib/monitoring-time.ts'),
        '@/lib/monitoring-health':require('../../web/lib/monitoring-health.ts'),
        '@/lib/school-time':{formatSchoolDateTime:value=>value,getSchoolTimeZone:async()=>'Asia/Makassar'},
        '@/lib/security-violations':{securityViolationLabel:value=>value}, 'lucide-react':{X:'icon',ChevronLeft:'icon',ChevronRight:'icon'} };
    new Function('require','module','exports','React',code)(name=>{assert.ok(modules[name],name);return modules[name]},mod,mod.exports,React);
    const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.children)];
    const text=root=>root==null||typeof root==='boolean'?'':typeof root!=='object'?String(root):Array.isArray(root)?root.map(text).join(''):text(root.children);
    let attempts=[row({client_context:{browser:'Chrome 131',os:'Windows',ip_address:'192.0.2.8',observed_at:now}}),row({id:'ending',deadline_at:'2026-10-14T06:03:00Z'})];
    attempts[1].pas_location={status:'assigned',room_name:'Laboratorium IPA',session_name:'Sesi Pagi',invigilators:[{id:'guard',full_name:'Bu Sari'}]};
    const render=()=>{cursor=0;return mod.exports.ActiveParticipantsPanel({attempts})};
    let tree=render();
    assert.match(text(tree),/Chrome 131/);assert.match(text(tree),/IP: 192\.0\.2\.8/);
    assert.match(text(tree),/Ruang: Laboratorium IPA · Sesi Pagi/);
    assert.match(text(tree),/Pengawas: Bu Sari/);
    assert.equal(text(roomMod.exports.ParticipantRoomInfo({attempt:{}})), '');
    assert.match(text(roomMod.exports.ParticipantRoomInfo({attempt:{pas_location:{status:'unavailable'}}})),/belum tersedia/);
    assert.match(text(roomMod.exports.ParticipantRoomInfo({attempt:{pas_location:{status:'unassigned',invigilators:[]}}})),/Belum ditempatkan/);
    assert.match(text(roomMod.exports.ParticipantRoomInfo({attempt:{pas_location:{status:'assigned',room_name:'Lab',invigilators:[]}}})),/Belum ditugaskan/);
    assert.equal(nodes(tree).some(node=>node.props['aria-label']==='Filter peserta aktif'),false);
    assert.doesNotMatch(text(tree),/prioritas bantuan ditampilkan dahulu/);
    assert.equal(nodes(tree).filter(node=>node.type==='tbody')[0].children[0].length,2);
    const endingRow=nodes(tree).find(node=>node.type==='tr'&&node.props.key==='ending');
    nodes(endingRow).find(node=>node.type==='button'&&text(node)==='Detail').props.onClick();
    attempts=attempts.map(a=>a.id==='ending'?{...a,saved_answer_count:30,pas_location:{...a.pas_location,invigilators:[{id:'replacement',full_name:'Pak Budi'}]}}:a);
    tree=render();const dialog=nodes(tree).find(node=>node.type==='dialog');
    assert.match(text(dialog),/30 \/ 40/);
    assert.match(text(dialog),/Pengawas: Pak Budi/);
    assert.doesNotMatch(text(dialog),/Bu Sari/);
    assert.equal(dialog.props['aria-labelledby'],'active-participant-title');
    nodes(dialog).find(node=>node.type==='button'&&node.props['aria-label']==='Tutup detail peserta').props.onClick();
    tree=render();assert.doesNotMatch(text(nodes(tree).find(node=>node.type==='dialog')), /30 \/ 40/);
});
