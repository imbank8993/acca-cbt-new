/** Read-only verification against independent SQL. No identities or credentials in output. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require('pg');
require('ts-node').register({ project: path.resolve(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const { DbService } = require('../apps/api/src/prisma/prisma-db-adapter.ts');
const { RelationRegistry } = require('../apps/api/src/prisma/relation-registry.ts');
const { StudentAnalyticsService } = require('../apps/api/src/analytics/student-analytics.service.ts');
const env = {};
for (const file of ['.env', 'apps/api/.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^([A-Z_]+)=(.*)$/);
        if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
}
const round = value => Math.round(value * 100) / 100;
(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL || env.DATABASE_URL, connectionTimeoutMillis: 8000 });
    try {
        await client.connect();
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL statement_timeout = '20s'");
        const shim = { $queryRawUnsafe: async (sql, ...params) => (await client.query(sql, params)).rows };
        const db = new DbService(shim, new RelationRegistry(shim));
        const service = new StudentAnalyticsService(db);
        const reference = (await client.query(`
            WITH latest AS (
                SELECT DISTINCT ON (a.user_id,a.exam_id) a.*,e.organization_id AS school,
                    e.end_time AS exam_end,e.duration_minutes
                FROM cbt_exam_attempts a JOIN cbt_exams e ON e.id=a.exam_id
                JOIN cbt_organization_members m ON m.user_id=a.user_id AND m.organization_id=e.organization_id AND m.is_active
                WHERE a.status IN ('submitted','auto_submitted') AND e.show_results
                ORDER BY a.user_id,a.exam_id,a.finished_at DESC,a.id DESC
            )
            SELECT *,CASE WHEN finished_at>=started_at THEN
                FLOOR(EXTRACT(EPOCH FROM LEAST(finished_at,
                    COALESCE((metadata->>'scoring_finished_at')::timestamptz,finished_at),
                    COALESCE((metadata->>'submit_intent_at')::timestamptz,finished_at),
                    COALESCE(personal_end_time,started_at+COALESCE(duration_minutes,60)*interval '1 minute'),
                    COALESCE((metadata->>'proctor_recovery_until')::timestamptz,exam_end,finished_at)
                )-started_at)) END AS working_seconds
            FROM latest WHERE total_score BETWEEN 0 AND 100 AND needs_manual_grading IS NOT TRUE
                AND metadata->>'relative_scoring_pending' IS DISTINCT FROM 'true'
        `)).rows;
        const byUser = new Map();
        for (const row of reference) {
            const rows = byUser.get(row.user_id) || []; rows.push(row); byUser.set(row.user_id,rows);
        }
        let users = 0, ranks = 0, subjects = 0;
        for (const [userId, own] of byUser) {
            const actual = await service.overview({ id: userId });
            const scores = own.map(row => Number(row.total_score));
            assert.equal(actual.overview.totalExams, own.length);
            assert.equal(actual.overview.averageScore, round(scores.reduce((sum,value)=>sum+value,0)/scores.length));
            assert.equal(actual.overview.highestScore,Math.max(...scores));
            assert.equal(actual.overview.lowestScore,Math.min(...scores));
            assert.equal(actual.overview.totalStudyTime,own.reduce((sum,row)=>sum+Number(row.working_seconds),0));
            const ids = new Set(own.map(row=>row.exam_id));
            const peers = [...byUser.entries()].filter(([id])=>id!==userId).map(([,rows])=>
                rows.filter(row=>row.school===own[0].school && ids.has(row.exam_id)))
                .filter(rows=>rows.length===own.length)
                .map(rows=>rows.reduce((sum,row)=>sum+Number(row.total_score),0)/rows.length);
            const average = scores.reduce((sum,value)=>sum+value,0)/scores.length;
            assert.equal(actual.overview.totalStudents, peers.length+1);
            assert.equal(actual.overview.rank,peers.length?1+peers.filter(value=>value>average+1e-9).length:null);
            assert.equal(actual.overview.percentile,peers.length?Math.round(peers.filter(value=>value<average-1e-9).length/peers.length*100):null);
            if (peers.length) {
                assert.equal(actual.comparison.classAverage,round(peers.reduce((sum,value)=>sum+value,0)/peers.length));
                ranks++;
            } else assert.equal(actual.comparison,null);
            assert.equal(actual.subjectPerformance.reduce((sum,row)=>sum+row.totalExams,0),own.length);
            subjects+=actual.subjectPerformance.length;
            assert.equal(actual.examHistory.length,Math.min(20,own.length));
            assert.ok(!JSON.stringify(actual).includes('submission_payload'));
            users++;
        }
        console.log(JSON.stringify({ verifiedStudents:users, verifiedFinalAttempts:reference.length,
            verifiedComparisons:ranks, subjectGroups:subjects, mismatches:0, mode:'read-only' },null,2));
        await client.query('ROLLBACK');
    } catch (error) {
        // Assertions contain numbers, never student identifiers or connection URLs.
        console.error('Audit failed:', error.code || error.name);
        if (error instanceof assert.AssertionError) console.error('Expected:',error.expected,'Actual:',error.actual);
        process.exitCode=1;
    } finally { await client.end(); }
})();
