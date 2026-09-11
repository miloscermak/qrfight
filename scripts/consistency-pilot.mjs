import fs from 'node:fs';
import { createHandler } from '../netlify/functions/evaluate.mjs';
import { AUTHORS, JUDGE, VERSION, PORTRAIT_PROMPT, JUDGE_PROMPT } from '../public/protocol.js';
import { classifyGuess, scoreResults } from '../public/results.js';

// Jedno výslovně schválené opakování. Nemění konferenční databázi ani hotové výsledky.
const output = new URL('../.pilot/milos-consistency-round2.json', import.meta.url);
if (fs.existsSync(output)) throw new Error('Druhé kolo už existuje. Bez dalšího souhlasu ho neopakujeme.');
const key = fs.readFileSync(new URL('../../.openrouter-key', import.meta.url), 'utf8').trim();
const env = { OPENROUTER_API_KEY: key, PILOT_ACCESS_CODE: 'local-consistency-test' };
const handler = createHandler({ env });
const report = {
  version: VERSION, startedAt: new Date().toISOString(), name: 'Miloš Čermák', birthYear: 1968,
  authors: AUTHORS, judge: JUDGE, prompts: { portrait: PORTRAIT_PROMPT, judge: JUDGE_PROMPT },
  note: 'Druhé celé kolo, stejný serverový handler a parametry jako v aplikaci, nový autor i rozhodčí. Bez zápisu do konferenčního souhrnu.',
  results: AUTHORS.map(model => ({ model: model.id, label: model.label, status: 'queued', attempts: [] })),
};
fs.mkdirSync(new URL('../.pilot/', import.meta.url), { recursive: true });
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
save();
async function call(body, result) {
  const attempt = { action: body.action, startedAt: new Date().toISOString() };
  result.attempts.push(attempt); save();
  const response = await handler(new Request('https://internal/evaluate', { method: 'POST', body: JSON.stringify({ ...body, version: VERSION, accessCode: env.PILOT_ACCESS_CODE }) }));
  const data = await response.json();
  attempt.response = data; attempt.finishedAt = new Date().toISOString(); save();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
let cursor = 0;
async function worker() {
  while (cursor < report.results.length) {
    const result = report.results[cursor++];
    try {
      const author = await call({ action: 'portrait', model: result.model, name: report.name, birthYear: report.birthYear }, result);
      result.portrait = author.portrait; result.status = author.status;
      if (author.status === 'portrait_ready') {
        const judge = await call({ action: 'identify', portrait: result.portrait }, result);
        result.guess = judge.guess; result.status = classifyGuess(report.name, judge.guess);
      }
    } catch (error) { result.status = 'technical_error'; result.error = error.message; }
    finally { save(); console.log(JSON.stringify({ model: result.label, status: result.status, portrait: result.portrait, guess: result.guess, error: result.error })); }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
report.finishedAt = new Date().toISOString();
report.score = scoreResults(report.results);
report.costUSD = report.results.flatMap(result => result.attempts).reduce((sum, attempt) => sum + (attempt.response?.metadata?.usage?.cost || 0), 0);
save();
console.log(JSON.stringify({ output: output.pathname, score: report.score, costUSD: report.costUSD }));
