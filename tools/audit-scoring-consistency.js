/** Read-only comparison of stored attempt totals against the current scoring engine. */
const fs = require('fs');
const { Client } = require('pg');

function readEnv(file) {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).trim().replace(/^(["'])|(["'])$/g, '')];
      }),
  );
}

const env = { ...readEnv('apps/scoring/.env'), ...readEnv('apps/api/.env') };
const scoringUrl = (env.SCORING_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const essays = new Set(['essay', 'esay', 'uraian']);

async function main() {
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    const attempts = (await db.query(`
      SELECT a.id, a.exam_id, a.total_score, a.needs_manual_grading,
             e.title, e.exam_type, e.question_bank_id
      FROM cbt_exam_attempts a
      JOIN cbt_exams e ON e.id = a.exam_id
      WHERE a.status IN ('submitted', 'auto_submitted')
      ORDER BY a.exam_id, a.id
    `)).rows;

    const summaries = [];
    for (const examId of [...new Set(attempts.map(row => row.exam_id))]) {
      const examAttempts = attempts.filter(row => row.exam_id === examId);
      const sourceRows = (await db.query(
        'SELECT bank_id FROM cbt_exam_question_sources WHERE exam_id = $1 ORDER BY bank_id',
        [examId],
      )).rows;
      const bankIds = [...new Set([
        examAttempts[0].question_bank_id,
        ...sourceRows.map(row => row.bank_id),
      ].filter(Boolean))];
      if (!bankIds.length) continue;

      const questions = (await db.query(`
        SELECT id, type, score_default, metadata, dimension_id
        FROM cbt_bank_questions WHERE bank_id = ANY($1::uuid[])
        ORDER BY created_at, id
      `, [bankIds])).rows;
      const options = (await db.query(`
        SELECT id, question_id, option_text, is_correct, weight, "order", metadata
        FROM cbt_bank_question_options WHERE question_id = ANY($1::uuid[])
        ORDER BY "order", id
      `, [questions.map(question => question.id)])).rows;
      const optionsByQuestion = Map.groupBy(options, option => option.question_id);
      const questionPayloads = questions.map(question => ({
        ...question,
        bank_question_options: optionsByQuestion.get(question.id) || [],
      }));

      const answerRows = (await db.query(`
        SELECT id, attempt_id, question_id, selected_option_id, essay_answer, score, is_correct
        FROM cbt_answers WHERE attempt_id = ANY($1::uuid[])
      `, [examAttempts.map(attempt => attempt.id)])).rows;
      const answersByAttempt = Map.groupBy(answerRows, answer => answer.attempt_id);
      let compared = 0;
      let changed = 0;
      let largestDifference = 0;

      for (const attempt of examAttempts) {
        const answerMap = new Map((answersByAttempt.get(attempt.id) || []).map(answer => [answer.question_id, answer]));
        const response = await fetch(`${scoringUrl}/grading/attempt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.SCORING_API_KEY },
          body: JSON.stringify({
            items: questionPayloads.map(question => {
              const answer = answerMap.get(question.id);
              return {
                question,
                answer_id: answer?.id || null,
                raw_answer: answer?.essay_answer ?? answer?.selected_option_id ?? null,
              };
            }),
          }),
        });
        if (!response.ok) throw new Error(`Scoring HTTP ${response.status} for exam ${examId}`);
        const result = await response.json();
        const manualScore = questionPayloads.reduce((sum, question) => {
          if (!essays.has(String(question.type).toLowerCase())) return sum;
          const answer = answerMap.get(question.id);
          return typeof answer?.score === 'number' && typeof answer?.is_correct === 'boolean'
            ? sum + answer.score : sum;
        }, 0);
        const expected = result.max_possible_score > 0
          ? ((result.total_score + manualScore) / result.max_possible_score) * 100 : 0;

        // Nilai kuis dapat berbeda maksimal beberapa perseratus karena penalti
        // peringkat waktu. Audit mesin dasar tetap dicatat, tetapi tidak ditandai
        // sebagai perubahan data otomatis.
        const difference = Math.abs(Number(attempt.total_score || 0) - expected);
        compared += 1;
        largestDifference = Math.max(largestDifference, difference);
        if (attempt.exam_type !== 'quiz' && difference > 0.000001) changed += 1;
      }

      summaries.push({
        examId,
        title: examAttempts[0].title,
        attempts: compared,
        mismatchedNonQuiz: changed,
        largestDifference: Number(largestDifference.toFixed(6)),
      });
    }

    console.log(JSON.stringify({
      attempts: attempts.length,
      exams: summaries.length,
      mismatchedNonQuiz: summaries.reduce((sum, row) => sum + row.mismatchedNonQuiz, 0),
      summaries: summaries.filter(row => row.mismatchedNonQuiz > 0),
    }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
