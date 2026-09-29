/** Read-only inventory of completed short-answer scores. */
const fs = require('fs');
const { Client } = require('pg');

function readEnv(file) {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index),
          line.slice(index + 1).trim().replace(/^(["'])|(["'])$/g, ''),
        ];
      }),
  );
}

async function main() {
  const env = readEnv('apps/api/.env');
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    const { rows: [summary] } = await db.query(`
      SELECT
        count(*)::int AS saved_answers,
        count(DISTINCT answer.attempt_id)::int AS attempts,
        count(*) FILTER (
          WHERE answer.score > 0
            AND answer.score < GREATEST(COALESCE(question.score_default, 1), 0)
        )::int AS partial_scores
      FROM cbt_answers answer
      JOIN cbt_bank_questions question ON question.id = answer.question_id
      JOIN cbt_exam_attempts attempt ON attempt.id = answer.attempt_id
      WHERE lower(question.type) = 'short_answer'
        AND attempt.status IN ('submitted', 'auto_submitted')
    `);
    console.log(JSON.stringify(summary));
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
