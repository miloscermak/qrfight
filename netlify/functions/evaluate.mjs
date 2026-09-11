import { accessError } from '../lib/access.mjs';
import { AUTHORS, VERSION, portraitRequest, judgeRequest, isUnknown, leaksIdentity } from '../../public/protocol.js';

// Každý krok dostává vlastní limit, kratší než limit synchronní funkce hostingu.
export function createHandler({ fetchImpl = fetch, env = process.env, timeoutMs = 52000, now = () => Date.now() } = {}) {
  return async request => {
    if (request.method !== 'POST') return json({ error: 'Použijte POST požadavek.' }, 405);
    if (!env.OPENROUTER_API_KEY || !env.PILOT_ACCESS_CODE) return json({ error: 'Pilot nemá nastavené přístupové údaje.', fatal: true }, 503);
    let payload;
    try {
      const raw = await request.text();
      if (raw.length > 14000) return json({ error: 'Požadavek je příliš dlouhý.' }, 413);
      payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    } catch { return json({ error: 'Neplatná data požadavku.' }, 400); }
    const denied = accessError(payload.accessCode, env, now());
    if (denied) return json({ error: denied.error, fatal: true }, denied.status);
    if (payload.version !== VERSION) return json({ error: 'Obnovte stránku, pilot má novou verzi.', fatal: true }, 409);
    let body, person;
    if (payload.action === 'portrait') {
      const validation = normalizePerson(payload);
      if (!validation.ok) return json({ error: validation.error }, 400);
      person = validation.person;
      const model = AUTHORS.find(item => item.id === payload.model);
      if (!model) return json({ error: 'Tento model není v pilotním panelu.' }, 400);
      body = portraitRequest(model, person.name, person.birthYear);
    } else if (payload.action === 'identify') {
      if (typeof payload.portrait !== 'string' || !payload.portrait.trim() || payload.portrait.length > 6000 || isUnknown(payload.portrait)) return json({ error: 'Chybí platný portrét.' }, 400);
      // Rozhodčí nedostane původní jméno ani další pole požadavku.
      body = judgeRequest(payload.portrait);
    } else return json({ error: 'Neplatný krok testu.' }, 400);
    let metadata;
    const started = Date.now();
    try {
      const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const fatal = [401, 402, 403].includes(response.status);
        const error = response.status === 402
          ? 'Došly peníze na další generování: kredit nebo limit pilotu už nestačí. Ukázku výsledku si můžete dál prohlédnout zdarma.'
          : fatal ? 'Poskytovatel odmítl přístup k modelům. Správce musí zkontrolovat nastavení pilotu.'
          : `Poskytovatel je nedostupný (HTTP ${response.status}). Zkuste zopakovat tento krok.`;
        return json({ error, fatal }, 502);
      }
      const data = await response.json(), choice = data.choices?.[0];
      metadata = { id: data.id, model: data.model, provider: data.provider, usage: data.usage, durationMs: Date.now() - started, finishReason: choice?.finish_reason, rawContent: choice?.message?.content, at: new Date().toISOString() };
      const content = choice?.message?.content;
      if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || !content.trim()) return json({ error: 'Model vrátil neúplnou odpověď. Zkuste zopakovat tento krok.', metadata }, 502);
      const text = content.trim();
      if (payload.action === 'identify') {
        if (text.length > 150 || text.includes('\n')) return json({ error: 'Astra nevrátila jediné jméno. Zkuste zopakovat tip.', metadata }, 502);
        return json({ version: VERSION, guess: text, metadata });
      }
      const status = isUnknown(text) ? 'author_unknown' : leaksIdentity(text, person.name, person.birthYear) ? 'identity_leak' : text.length > 6000 || text.split('\n').filter(line => line.trim()).length > 5 ? 'invalid_portrait' : 'portrait_ready';
      return json({ version: VERSION, portrait: text, status, metadata });
    } catch (error) {
      const timedOut = /timeout|abort/i.test(`${error.name} ${error.message}`);
      return json({ error: timedOut ? 'Model nestihl odpovědět do 52 sekund. Zkuste zopakovat tento krok.' : 'Spojení s modelem se nepodařilo. Zkuste zopakovat tento krok.', metadata }, timedOut ? 504 : 502);
    }
  };
}
export function normalizePerson(payload) {
  const name = typeof payload?.name === 'string' ? payload.name.trim().replace(/\s+/g, ' ') : '';
  const birthYear = Number(payload?.birthYear);
  if (name.length < 2 || name.length > 100) return { ok: false, error: 'Jméno musí mít 2 až 100 znaků.' };
  if (!Number.isInteger(birthYear) || birthYear < 1850 || birthYear > new Date().getFullYear()) return { ok: false, error: 'Rok narození není platný.' };
  return { ok: true, person: { name, birthYear } };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export default createHandler();
