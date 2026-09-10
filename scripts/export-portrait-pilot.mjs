import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Export obsahuje původní texty; případné chyby modelů záměrně neopravujeme.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, '.pilot', 'portrait-panel-four-cs.json');
const guessing = process.argv.includes('--guessing');
const output = path.join(root, '.pilot', guessing ? 'ceske-portrety-tipovani.md' : 'ceske-portrety-ctyri-modely.md');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
if (guessing) {
  const revised = JSON.parse(fs.readFileSync(path.join(root, '.pilot', 'portrait-panel-four-cs-guessing.json'), 'utf8'));
  Object.assign(data, { results: revised.results, requests: revised.requests, startedAt: revised.startedAt, finishedAt: revised.finishedAt, knownCostUSD: revised.costUSD });
  data.prompts.judgeSystem = revised.requests[0].body.messages[0].content;
}
if (!data.finishedAt) throw new Error('Experiment ještě běží.');
const labels = {
  'anthropic/claude-fable-5.1': 'Claude Fable 5.1',
  'google/gemini-3.8-flash': 'Gemini 3.8 Flash',
  'x-ai/grok-4.6': 'Grok 4.6',
  'qwen/qwen3.8-max-0902': 'Qwen3.8 Max 0902',
};
const states = { match: 'Rozpoznán', judge_unknown: 'Astra neurčila totožnost', author_unknown: 'Autor nevytvořil portrét', mismatch: 'Astra určila jiné jméno', identity_leak: 'Portrét prozradil jméno nebo rok — vyřazeno', technical_error: 'Technická chyba' };
const lines = [
  '# Česká zkouška: čtyři autoři portrétů, Astra jako rozhodčí', '',
  `Zahájeno: ${data.startedAt}. Dokončeno: ${data.finishedAt}.`, '',
  `Útrata podle dostupných údajů API: ${data.knownCostUSD.toFixed(5)} USD. Počet nových API volání: ${data.requests.length}.`, '',
  'Každý autor dostal pouze jméno a rok narození. Astra dostala vždy jen anonymní portrét v nové konverzaci, bez seznamu kandidátů a bez přístupu k internetu. Texty níže jsou původní výstupy modelů; nejsou fakticky opravené. Rozpoznání jména není zárukou pravdivosti všech vět.', '',
  '## Výsledky podle modelu', '',
];
if (guessing) lines.push('Portréty jsou převzaté z předchozího českého experimentu. Uvedená útrata je pouze za nové tipování Astry. Původně 13/20, nyní 16/20 shod jména. Jde o malou vývojovou zkoušku, nikoli nezávislé ověření metodiky.', '');
for (const [id, label] of Object.entries(labels)) {
  const rows = data.results.filter(r => r.author === id);
  lines.push(`- ${label}: ${rows.filter(r => r.status === 'match').length}/${rows.length} rozpoznaných portrétů. ${rows.map(r => `${r.name}: ${states[r.status] || r.status}`).join('; ')}.`);
}
lines.push('', '## Přesný prompt autorů (system)', '', '```text', data.prompts.portraitSystem, '```', '',
  'Uživatelská zpráva měla například podobu `Miloš Čermák, narozen/a 1968`.', '',
  '## Přesný prompt Astry (system)', '', '```text', data.prompts.judgeSystem, '```', '',
  'Uživatelskou zprávou byl pouze celý příslušný portrét.', '');
for (const name of [...new Set(data.results.map(r => r.name))]) {
  const rows = data.results.filter(r => r.name === name);
  lines.push(`## ${name} (${rows[0].year})`, '');
  for (const id of Object.keys(labels)) {
    const row = rows.find(r => r.author === id);
    if (!row) continue;
    lines.push(`### ${labels[id]}`, '', '```text', row.portrait || '(Bez portrétu.)', '```', '',
      `Odpověď Astry: **${row.guess || 'Nebyla volána / bez odpovědi'}**.`, '',
      ...(guessing ? [`Původní odpověď: ${row.previousGuess || 'Nebyla volána'}.`, ''] : []),
      `Výsledek: ${states[row.status] || row.status}.${row.error ? ` ${row.error}` : ''}`, '');
  }
}
lines.push('## Zaznamenané verze modelů', '');
for (const model of data.models) lines.push(`- ${model.id}: ${model.canonical_slug}`);
lines.push('', `Přesné parametry jednotlivých požadavků a API odpovědi jsou v souboru ${guessing ? 'portrait-panel-four-cs-guessing.json' : 'portrait-panel-four-cs.json'}.`, '');
fs.writeFileSync(output, lines.join('\n'));
console.log(output);
