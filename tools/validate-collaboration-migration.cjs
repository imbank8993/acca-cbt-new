const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const assert = require('node:assert/strict');
(async () => {
 const env = fs.readFileSync(path.join(__dirname, '../apps/api/.env'), 'utf8');
 const url = process.env.DATABASE_URL || env.match(/DATABASE_URL="?([^"\r\n]+)"?/)[1];
 const db = new Client({connectionString:url,connectionTimeoutMillis:15000});
 await db.connect();
 try {
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='5s'");
  const source=fs.readFileSync(path.join(__dirname,'../database/migrations/20261023_02_resource_collaborators.sql'),'utf8').replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'');
  await db.query(source);
  const columns = await db.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('cbt_exams','cbt_question_banks') AND column_name='updated_at'");
  assert.equal(columns.rows.length,2);
  console.log('Kolom versi bank soal dan ujian: OK');
  const tables=await db.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('cbt_bank_collaborators','cbt_exam_collaborators','cbt_collaboration_events')");
  assert.equal(tables.rows.length,3);
  assert.ok(tables.rows.every(row=>row.relrowsecurity));
  console.log('Tiga tabel kolaborasi dan RLS: OK');
  console.log('Migrasi kolaborator valid; ROLLBACK.');
 } finally {await db.query('ROLLBACK');await db.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
