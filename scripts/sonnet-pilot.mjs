import fs from 'node:fs';
import { SONNET, JUDGE, portraitRequest, judgeRequest, sameName, isUnknown, leaksIdentity } from '../public/protocol.js';

const output = new URL('../.pilot/sonnet-five.json', import.meta.url);
if (fs.existsSync(output)) throw new Error('Výsledek už existuje. Placenou zkoušku automaticky neopakujeme.');
const source = JSON.parse(fs.readFileSync(new URL('../.pilot/portrait-panel-four-cs-guessing.json', import.meta.url), 'utf8'));
const previous = JSON.parse(fs.readFileSync(new URL('../.pilot/portrait-panel-four-cs.json', import.meta.url), 'utf8'));
const people = source.results.filter(row => row.author === 'anthropic/claude-fable-5.1');
if (people.length !== 5) throw new Error('Chybí pět původních výsledků Fable.');
const catalogResponse = await fetch('https://openrouter.ai/api/v1/models');
if (!catalogResponse.ok) throw new Error('Katalog není dostupný.');
const catalog = (await catalogResponse.json()).data;
const models = [SONNET, JUDGE].map(model => catalog.find(item => item.id === model.id));
if (models.some(model => !model) || models[0].reasoning?.mandatory !== false) throw new Error('Sonnet nepodporuje požadované vypnutí nebo model není dostupný.');
const apiKey = (process.env.OPENROUTER_API_KEY || fs.readFileSync(new URL('../../.openrouter-key', import.meta.url), 'utf8')).trim();
const report = { startedAt: new Date().toISOString(), budgetUSD: 2, reservedUSD: 0, costUSD: 0, models: models.map(({ id, canonical_slug, reasoning, pricing }) => ({ id, canonical_slug, reasoning, pricing })), requests: [], results: [] };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
async function call(body, name, stage) {
  const model = models.find(item => item.id === body.model);
  const reserve = (Buffer.byteLength(JSON.stringify(body.messages)) + 2048) * Number(model.pricing.prompt) + body.max_tokens * Number(model.pricing.completion) + Number(model.pricing.request || 0);
  if (!Number.isFinite(reserve) || reserve < 0 || report.reservedUSD + reserve > report.budgetUSD) throw new Error('Rozpočtový limit.');
  report.reservedUSD += reserve;
  const record = { name, stage, body, startedAt: new Date().toISOString() };
  report.requests.push(record); save();
  const started = Date.now();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(52000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(); record.response = data;
    if (typeof data.usage?.cost === 'number') report.costUSD += data.usage.cost;
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'stop' || !choice.message?.content?.trim()) throw new Error('Neúplná odpověď.');
    return { text: choice.message.content.trim(), usage: data.usage, durationMs: Date.now() - started };
  } catch (error) { record.error = error.message; throw error; }
  finally { record.durationMs = Date.now() - started; save(); }
}
// Jeden průchod, žádné vybírání nejlepšího z opakovaných pokusů.
for (const old of people) {
  const oldCall = previous.requests.find(record => record.model === old.author && record.request?.messages[1]?.content === `${old.name}, narozen/a ${old.year}`);
  const oldJudge = source.requests.find(record => record.name === old.name && record.author === old.author);
  const row = { name: old.name, year: old.year, baseline: { portrait: old.portrait, guess: old.guess, status: old.status, durationMs: oldCall?.durationMs, authorCost: oldCall?.response?.usage?.cost, judgeCost: oldJudge?.response?.usage?.cost }, status: 'pending' };
  report.results.push(row);
  try {
    const portrait = await call(portraitRequest(SONNET, row.name, row.year), row.name, 'portrait');
    Object.assign(row, { portrait: portrait.text, authorDurationMs: portrait.durationMs, authorCost: portrait.usage?.cost, reasoningTokens: portrait.usage?.completion_tokens_details?.reasoning_tokens ?? null });
    if (row.reasoningTokens !== 0) throw new Error('Nelze potvrdit nulové přemýšlení z vykázaných tokenů.');
    if (isUnknown(row.portrait)) row.status = 'author_unknown';
    else if (leaksIdentity(row.portrait, row.name, row.year)) row.status = 'identity_leak';
    else if (row.portrait.length > 6000 || row.portrait.split('\n').filter(line => line.trim()).length > 5) row.status = 'invalid_portrait';
    else {
      const guess = await call(judgeRequest(row.portrait), row.name, 'identify');
      Object.assign(row, { guess: guess.text, judgeDurationMs: guess.durationMs, judgeCost: guess.usage?.cost });
      row.status = sameName(row.name, row.guess) ? 'match' : isUnknown(row.guess) ? 'judge_unknown' : 'mismatch';
    }
  } catch (error) { row.status = 'technical_error'; row.error = error.message; }
  finally { save(); console.log(JSON.stringify(row)); }
}
report.finishedAt = new Date().toISOString(); save();
console.log(JSON.stringify({ costUSD: report.costUSD, matches: report.results.filter(row => row.status === 'match').length, output: output.pathname }));
