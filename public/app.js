import { AUTHORS, JUDGE, VERSION, PORTRAIT_PROMPT, JUDGE_PROMPT } from './protocol.js';
import { parsePerson, isFinal, retryStage, scoreResults } from './results.js';

const $ = selector => document.querySelector(selector);
const peopleInput = $('#people'), accessInput = $('#access-code'), startButton = $('#start');
const exportButton = $('#export'), pauseButton = $('#pause'), retryButton = $('#retry');
const errorBox = $('#form-error'), cards = $('#cards'), cache = new Map();
let runs = [], busy = false, stop = false, exportUrl;
$('#author-prompt').textContent = PORTRAIT_PROMPT;
$('#judge-prompt').textContent = JUDGE_PROMPT;
$('#panel-models').textContent = AUTHORS.map(model => model.label).join(' · ');
peopleInput.addEventListener('paste', event => {
  if (/[\r\n]/.test(event.clipboardData.getData('text').trim())) {
    event.preventDefault(); showError('Teď hraje jeden člověk. Vložte jen jedno jméno a rok.');
  }
});
$('#entry-form').addEventListener('submit', event => { event.preventDefault(); startEvaluation(); });
exportButton.addEventListener('click', exportResults);
pauseButton.addEventListener('click', () => { stop = true; pauseButton.disabled = true; pauseButton.textContent = 'Dokončuji rozběhnuté kroky…'; });
retryButton.addEventListener('click', () => execute(runs.flatMap(run => run.results.filter(result => !isFinal(result)).map(result => ({ run, result })))));
function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
async function startEvaluation() {
  if (busy) return;
  const { people, errors } = parsePerson(peopleInput.value);
  if (errors.length) return showError(errors[0]);
  if (!accessInput.value.trim()) return showError('Zadejte přístupový kód k pilotu.');
  busy = true; startButton.disabled = peopleInput.disabled = accessInput.disabled = true; errorBox.hidden = true;
  try {
    const person = people[0];
    const response = await fetch('/api/conference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'begin', version: VERSION, accessCode: accessInput.value.trim(), name: person.name, birthYear: person.birthYear }), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Hru se nepodařilo zahájit.');
    let run = cache.get(person.key);
    if (!run || run.day !== data.day) { run = { ...person, day: data.day, results: AUTHORS.map(model => ({ model: model.id, label: model.label, status: 'queued', attempts: [] })) }; cache.set(person.key, run); }
    run.session = data.session;
    run.results.forEach(result => {
      const stored = data.results.find(item => item.model === result.model);
      if (isFinal(stored)) { result.status = stored.status; result.stored = !result.portrait; }
      else if (isFinal(result)) { result.status = 'queued'; delete result.portrait; delete result.guess; }
    });
    runs = [Object.assign(run, { index: 0 })];
  } catch (error) { showError(error.message || 'Spojení se nezdařilo. Zkuste to znovu.'); return; }
  finally { busy = false; startButton.disabled = peopleInput.disabled = accessInput.disabled = false; }
  $('#export-preview').hidden = true;
  renderCards(); $('#results-section').hidden = false;
  $('#results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await execute(runs.flatMap(run => run.results.filter(result => !isFinal(result)).map(result => ({ run, result }))));
}
async function execute(jobs) {
  if (busy || !jobs.length) return;
  const accessCode = accessInput.value.trim();
  if (!accessCode) return showError('Zadejte přístupový kód k pilotu.');
  busy = true; stop = false; errorBox.hidden = true;
  startButton.disabled = peopleInput.disabled = accessInput.disabled = true;
  pauseButton.hidden = false; pauseButton.disabled = false; pauseButton.textContent = 'Pozastavit';
  let cursor = 0;
  async function worker() {
    while (!stop && cursor < jobs.length) {
      const { run, result } = jobs[cursor++];
      await evaluate(run, result, accessCode);
    }
  }
  runs.forEach(renderCard); updateProgress();
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  busy = false; startButton.disabled = peopleInput.disabled = accessInput.disabled = false;
  pauseButton.hidden = true; runs.forEach(renderCard); updateProgress();
}
async function requestStep(body, result, accessCode) {
  const attempt = { action: body.action, startedAt: new Date().toISOString() };
  result.attempts.push(attempt);
  try {
    const response = await fetch('/api/conference', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, version: VERSION, accessCode }), signal: AbortSignal.timeout(70000),
    });
    const payload = await response.json().catch(() => ({})); attempt.response = payload;
    if (!response.ok) {
      if (payload.fatal || [401, 409].includes(response.status)) { stop = true; showError(payload.error || 'Test byl zastaven.'); }
      throw new Error(payload.error || `Server odpověděl ${response.status}. Zkuste krok zopakovat.`);
    }
    if (payload.version !== VERSION) throw new Error('Server vrátil jinou verzi testu. Obnovte stránku po exportu výsledků.');
    return payload;
  } catch (error) {
    attempt.error = /timeout|abort/i.test(`${error.name} ${error.message}`) ? 'Vypršel čas spojení. Zkuste krok zopakovat.' : error.message;
    throw new Error(attempt.error);
  } finally { attempt.finishedAt = new Date().toISOString(); }
}
async function evaluate(run, result, accessCode) {
  const stage = retryStage(result); delete result.error;
  try {
    if (stage === 'portrait') {
      delete result.portrait; delete result.guess;
      result.status = 'writing'; renderCard(run);
      const data = await requestStep({ action: 'portrait', model: result.model, session: run.session }, result, accessCode);
      if (data.stored) { result.status = data.status; result.stored = true; return; }
      result.portrait = data.portrait; result.status = data.status;
      if (data.status !== 'portrait_ready') return;
    }
    // Pozastavení zachová portrét; pokračování zaplatí jen chybějícího rozhodčího.
    if (stop) { result.status = 'portrait_ready'; return; }
    result.status = 'judging'; renderCard(run);
    const data = await requestStep({ action: 'identify', model: result.model, portrait: result.portrait, session: run.session }, result, accessCode);
    result.guess = data.guess; result.status = data.status; result.stored = Boolean(data.stored);
  } catch (error) { result.status = 'technical_error'; result.error = error.message; }
  finally { renderCard(run); updateProgress(); }
}
function renderCards() {
  cards.replaceChildren();
  runs.forEach(run => {
    const fragment = $('#card-template').content.cloneNode(true);
    fragment.querySelector('.person-card').dataset.index = run.index;
    cards.append(fragment); renderCard(run);
  }); updateProgress();
}
function renderCard(run) {
  const card = cards.querySelector(`[data-index="${run.index}"]`);
  if (!card) return;
  const opened = [...card.querySelectorAll('details[open]')].map(item => item.dataset.model);
  card.querySelector('.person-position').textContent = 'OSOBNÍ VÝSLEDEK';
  card.querySelector('.person-name').textContent = run.name;
  card.querySelector('.person-year').textContent = `ROČNÍK ${run.birthYear}`;
  const { matched, pending, total } = scoreResults(run.results);
  card.querySelector('.score').textContent = matched;
  card.querySelector('.result-title').textContent = pending ? 'Příběh ještě není dopsaný.' : ['Dobře střežené tajemství.', 'První stopa nalezena.', 'Stopa ve dvou modelech.', 'Téměř nezaměnitelný otisk.', 'AI celebrita. Aspoň dnes.'][matched];
  card.querySelector('.card-status').textContent = pending ? `ZATÍM poznáno ${matched} ze ${total}. Ještě nehodnoceno: ${pending}. Konečný výsledek může být ${matched} až ${matched + pending} ze ${total}.` : `HOTOVO / Astra vás poznala podle ${matched} ze ${total} portrétů.`;
  card.classList.toggle('running', run.results.some(result => ['writing', 'judging'].includes(result.status)));
  const rows = card.querySelector('.model-results'); rows.replaceChildren();
  run.results.forEach(result => {
    const detail = document.createElement('details'); detail.className = 'model-result'; detail.dataset.model = result.model; detail.open = opened.includes(result.model);
    const summary = document.createElement('summary');
    const light = document.createElement('i'); light.className = `light ${result.status === 'match' ? 'green' : isFinal(result) ? 'red' : 'gray'}`;
    const title = document.createElement('b'); title.textContent = result.label;
    const state = document.createElement('span'); state.className = 'result-state'; state.textContent = statusText(result);
    summary.append(light, title, state);
    const portrait = document.createElement('p'); portrait.className = 'portrait'; portrait.textContent = result.portrait || (result.stored ? 'Dnešní výsledek už máme. Text portrétu byl jen v původní stránce — do databáze ho neukládáme.' : 'Portrét zatím není k dispozici.');
    const guess = document.createElement('p'); guess.className = 'guess'; guess.textContent = result.guess ? `Tip Astry: ${result.guess}` : result.stored ? 'Obnovený výsledek bez uloženého textu.' : 'Astra zatím netipovala.';
    detail.append(summary, portrait, guess);
    if (result.error) { const error = document.createElement('p'); error.className = 'hint'; error.textContent = result.error; detail.append(error); }
    if (!isFinal(result)) {
      const retry = document.createElement('button'); retry.className = 'secondary'; retry.type = 'button'; retry.disabled = busy;
      retry.textContent = retryStage(result) === 'identify' ? 'Zkusit jen Astru znovu' : 'Zkusit portrét znovu';
      retry.addEventListener('click', () => execute([{ run, result }])); detail.append(retry);
    } rows.append(detail);
  });
}
function statusText(result) {
  if (result.stored) return result.status === 'match' ? 'Poznáno · dnešní výsledek' : 'Nepoznáno · dnešní výsledek';
  return ({ queued: 'Čeká ve frontě', writing: 'Píše portrét…', portrait_ready: 'Portrét čeká na Astru', judging: 'Astra tipuje…', match: `Poznáno: ${result.guess}`, mismatch: `Jiný tip: ${result.guess}`, judge_unknown: 'Astra: NEVÍM', author_unknown: 'Autor: NEVÍM', identity_leak: 'Prozrazené jméno / rok — nehodnoceno', invalid_portrait: 'Nedodržený formát — nehodnoceno', technical_error: 'Technická chyba — lze zopakovat' })[result.status] || result.status;
}
function updateProgress() {
  const results = runs.flatMap(run => run.results);
  $('#progress').textContent = `${results.filter(isFinal).length} / ${results.length} portrétů`;
  retryButton.hidden = !results.some(result => !isFinal(result)); retryButton.disabled = busy; exportButton.disabled = !runs.length;
  const attempts = [...cache.values()].flatMap(run => run.results.flatMap(result => result.attempts));
  const costs = attempts.map(attempt => attempt.response?.metadata?.usage?.cost).filter(cost => typeof cost === 'number');
  $('#cost').textContent = costs.length ? `Dosud vykázaná cena v této stránce: $${costs.reduce((a, b) => a + b, 0).toFixed(3)}. Nezahrnuje případná volání bez údaje o ceně.` : 'Cena se zobrazí podle údajů poskytovatele. Opakování je další placené volání.';
}
function exportResults() {
  const output = { version: VERSION, generatedAt: new Date().toISOString(), authors: AUTHORS, judge: JUDGE, prompts: { portrait: PORTRAIT_PROMPT, judge: JUDGE_PROMPT }, note: 'Rozpoznatelnost anonymního portrétu, nikoli ověření pravdivosti. Shoda jména ignoruje diakritiku, velikost písmen a pořadí dvou slov. Přezdívky a jiné varianty se mohou vyhodnotit jako jiný tip.', people: runs.map(({ index, session, ...run }) => ({ ...run, score: scoreResults(run.results) })) };
  const text = JSON.stringify(output, null, 2);
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = $('#download-export'); link.href = exportUrl; link.download = `qrfight-pilot-${new Date().toISOString().slice(0, 10)}.json`;
  $('#export-data').value = text;
  $('#export-preview').hidden = false;
  $('#export-preview').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
