import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, normalizePerson } from '../netlify/functions/evaluate.mjs';
import { AUTHORS, JUDGE, VERSION, sameName, leaksIdentity, judgeRequest } from '../public/protocol.js';
import { scoreResults, parsePeople, classifyGuess, retryStage } from '../public/results.js';

const env = { OPENROUTER_API_KEY: 'test-secret', PILOT_ACCESS_CODE: 'test-code' };
const input = { version: VERSION, accessCode: 'test-code', action: 'portrait', model: AUTHORS[0].id, name: 'Miloš Čermák', birthYear: 1968 };
function request(payload = input) { return new Request('https://test/api/evaluate', { method: 'POST', body: JSON.stringify(payload) }); }
function fixture(content = 'X je český novinář.', finish_reason = 'stop') {
  return new Response(JSON.stringify({ id: 'fixture', model: AUTHORS[0].id, usage: { cost: 0.01 }, choices: [{ finish_reason, message: { content } }] }));
}
test('normalizuje osobu a odmítne neplatné vstupy', () => {
  assert.deepEqual(normalizePerson({ name: ' Ewa   Farna ', birthYear: 1993 }).person, { name: 'Ewa Farna', birthYear: 1993 });
  for (const value of [null, {}, { name: {}, birthYear: 1993 }, { name: 'Test', birthYear: 3020 }]) assert.equal(normalizePerson(value).ok, false);
});
test('hromadný vstup odstraní duplicity a hlídá 40 lidí', () => {
  assert.equal(parsePeople('Miloš Čermák; 1968\nMilos Cermak,1968').people.length, 1);
  assert.equal(parsePeople('špatný řádek').errors.length, 1);
  assert.equal(parsePeople(Array.from({ length: 41 }, (_, i) => `Osoba ${i}; 1968`).join('\n')).errors.length, 1);
});
test('shoda netoleruje jiného člověka, toleruje diakritiku a pořadí', () => {
  assert.ok(sameName('Miloš Čermák', 'Milos Cermak'));
  assert.ok(sameName('Miloš Čermák', 'Čermák Miloš'));
  assert.equal(classifyGuess('Miloš Čermák', 'Pavel Šafr'), 'mismatch');
  assert.equal(classifyGuess('Miloš Čermák', 'NEVÍM.'), 'judge_unknown');
});
test('šedá nesnižuje skóre na nulu a červená ano', () => {
  assert.deepEqual(scoreResults(['match', 'mismatch', 'author_unknown', 'technical_error'].map(status => ({ status }))), { matched: 1, completed: 3, total: 4, pending: 1 });
});
test('opakování rozhodčího zachová portrét, únik vyžaduje nový', () => {
  assert.equal(retryStage({ portrait: 'X je autor.', status: 'technical_error' }), 'identify');
  assert.equal(retryStage({ portrait: 'Čermák', status: 'identity_leak' }), 'portrait');
  assert.equal(retryStage({ status: 'technical_error' }), 'portrait');
});
test('kontrola úniku zachytí jméno i rok', () => {
  assert.ok(leaksIdentity('X je Cermak.', 'Miloš Čermák', 1968));
  assert.ok(leaksIdentity('X se narodil 1968.', 'Miloš Čermák', 1968));
  assert.equal(leaksIdentity('X je novinář.', 'Miloš Čermák', 1968), false);
});
test('panel má čtyři autory bez rozhodčího', () => {
  assert.equal(AUTHORS.length, 4);
  assert.ok(AUTHORS.every(model => model.id !== JUDGE.id));
});
test('rozhodčí dostane jen portrét, bez nástrojů a seznamu lidí', async () => {
  let sent;
  const handler = createHandler({ env, fetchImpl: async (_, options) => { sent = JSON.parse(options.body); return fixture('Pavel Nedvěd'); } });
  const response = await handler(request({ ...input, action: 'identify', portrait: 'X získal Zlatý míč.' }));
  assert.equal(response.status, 200);
  assert.deepEqual(sent, judgeRequest('X získal Zlatý míč.'));
  assert.equal(JSON.stringify(sent).includes('Čermák'), false);
  assert.equal(sent.tools, undefined);
  assert.equal(sent.plugins, undefined);
});
for (const [label, change, status] of [
  ['chybný kód', { accessCode: 'wrong' }, 401],
  ['jiná verze', { version: 'old' }, 409],
  ['nepovolený model', { model: JUDGE.id }, 400],
  ['neplatný rok', { birthYear: 1 }, 400],
  ['neplatná akce', { action: 'anything' }, 400],
  ['prázdný portrét', { action: 'identify', portrait: '' }, 400],
]) test(`${label} nevyvolá placený dotaz`, async () => {
  let calls = 0;
  const handler = createHandler({ env, fetchImpl: async () => { calls++; return fixture(); } });
  assert.equal((await handler(request({ ...input, ...change }))).status, status);
  assert.equal(calls, 0);
});
test('null a příliš dlouhý požadavek nezpůsobí pád', async () => {
  const handler = createHandler({ env });
  assert.equal((await handler(request(null))).status, 400);
  assert.equal((await handler(request({ x: 'x'.repeat(15000) }))).status, 413);
});
for (const [content, status] of [['NEVÍM', 'author_unknown'], ['X je Miloš.', 'identity_leak'], ['X je novinář.', 'portrait_ready'], [Array(6).fill('X je autor.').join('\n'), 'invalid_portrait']]) test(`autor: ${status}`, async () => {
  const response = await createHandler({ env, fetchImpl: async () => fixture(content) })(request());
  const data = await response.json();
  assert.equal(data.status, status); assert.equal(data.metadata.usage.cost, 0.01);
  assert.equal(JSON.stringify(data).includes('test-secret'), false);
});
test('useknutá odpověď je technická chyba, nikoli červená', async () => {
  const response = await createHandler({ env, fetchImpl: async () => fixture('Pavel', 'length') })(request());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).metadata.rawContent, 'Pavel');
});
test('nedostatek kreditu zastaví frontu a nepropustí upstream detail', async () => {
  const response = await createHandler({ env, fetchImpl: async () => new Response('private upstream detail', { status: 402 }) })(request());
  const data = await response.json(); assert.equal(data.fatal, true); assert.equal(JSON.stringify(data).includes('private'), false);
});
test('timeout má samostatnou chybu a nevytváří skryté placené opakování', async () => {
  let calls = 0;
  const response = await createHandler({ env, fetchImpl: async () => { calls++; throw new DOMException('timeout', 'TimeoutError'); } })(request());
  assert.equal(response.status, 504); assert.equal(calls, 1);
});
