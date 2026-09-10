import fs from 'node:fs';
import { JUDGE, VERSION, judgeRequest, sameName, isUnknown } from '../public/protocol.js';

const sourcePath = new URL('../.pilot/portrait-panel-four-cs.json', import.meta.url);
const outputPath = new URL('../.pilot/portrait-panel-four-cs-guessing.json', import.meta.url);
if (fs.existsSync(outputPath)) throw new Error('Tento placený experiment už má uložené výsledky.');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const apiKey = (process.env.OPENROUTER_API_KEY || fs.readFileSync(new URL('../../.openrouter-key', import.meta.url), 'utf8')).trim();
const response = await fetch('https://openrouter.ai/api/v1/models');
if (!response.ok) throw new Error('Katalog modelů není dostupný.');
const judge = (await response.json()).data.find(m => m.id === JUDGE.id);
if (!judge) throw new Error('Astra není dostupná.');
const report = { version: VERSION, startedAt: new Date().toISOString(), source: sourcePath.pathname, judge: { id: judge.id, canonical_slug: judge.canonical_slug }, budgetUSD: 4, reservedUSD: 0, costUSD: 0, requests: [], results: [] };
const save = () => fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
async function evaluate(old) {
  const result = { ...old, previousGuess: old.guess ?? null, previousStatus: old.status };
  report.results.push(result);
  if (!old.portrait || ['author_unknown', 'identity_leak', 'technical_error'].includes(old.status)) { save(); return; }
  delete result.guess;
  result.status = 'pending';
  const body = judgeRequest(old.portrait);
  const reserve = (Buffer.byteLength(JSON.stringify(body.messages)) + 2048) * Number(judge.pricing.prompt) + body.max_tokens * Number(judge.pricing.completion) + Number(judge.pricing.request || 0);
  if (!Number.isFinite(reserve) || reserve < 0 || report.reservedUSD + reserve > report.budgetUSD) throw new Error('Rozpočtový limit.');
  report.reservedUSD += reserve;
  const request = { name: old.name, author: old.author, body, startedAt: new Date().toISOString() };
  report.requests.push(request);
  save();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    request.response = data;
    if (typeof data.usage?.cost === 'number') report.costUSD += data.usage.cost;
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length' || !choice?.message?.content?.trim()) throw new Error('Neúplná odpověď.');
    result.guess = choice.message.content.trim();
    result.status = sameName(old.name, result.guess) ? 'match' : isUnknown(result.guess) ? 'judge_unknown' : 'mismatch';
  } catch (error) { result.status = 'technical_error'; result.error = error.message; }
  finally { save(); console.log(JSON.stringify({ name: result.name, author: result.author, before: result.previousGuess, after: result.guess, status: result.status })); }
}
for (let i = 0; i < source.results.length; i += 3) await Promise.all(source.results.slice(i, i + 3).map(evaluate));
report.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify({ costUSD: report.costUSD, output: outputPath.pathname }));
