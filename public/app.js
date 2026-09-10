const peopleInput = document.querySelector("#people");
const accessInput = document.querySelector("#access-code");
const startButton = document.querySelector("#start");
const exportButton = document.querySelector("#export");
const errorBox = document.querySelector("#form-error");
const lineCount = document.querySelector("#line-count");
const resultsSection = document.querySelector("#results-section");
const progress = document.querySelector("#progress");
const cards = document.querySelector("#cards");
const template = document.querySelector("#card-template");

let runs = [];

peopleInput.addEventListener("input", () => {
  lineCount.textContent = peopleInput.value.split(/\r?\n/).filter(line => line.trim()).length;
});

startButton.addEventListener("click", startEvaluation);
exportButton.addEventListener("click", exportResults);

function parsePeople(value) {
  const parsed = [];
  const errors = [];
  const seen = new Set();

  value.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const match = line.match(/^(.+?)[;,\t]\s*(\d{4})\s*$/);
    if (!match) {
      errors.push(`Řádek ${index + 1}: použijte zápis „Jméno; 1972“.`);
      return;
    }
    const name = match[1].trim().replace(/\s+/g, " ");
    const birthYear = Number(match[2]);
    if (name.length < 2 || name.length > 100 || birthYear < 1850 || birthYear > new Date().getFullYear()) {
      errors.push(`Řádek ${index + 1}: jméno nebo rok nevypadá platně.`);
      return;
    }
    const key = `${name.toLocaleLowerCase("cs-CZ")}|${birthYear}`;
    if (!seen.has(key)) {
      seen.add(key);
      parsed.push({ name, birthYear });
    }
  });

  if (parsed.length > 40) errors.push("Pilot přijme nejvýše 40 jmen najednou.");
  return { people: parsed.slice(0, 40), errors };
}

async function startEvaluation() {
  const { people, errors } = parsePeople(peopleInput.value);
  const accessCode = accessInput.value.trim();
  errorBox.hidden = true;

  if (!people.length) errors.unshift("Zadejte alespoň jedno jméno a rok narození.");
  if (!accessCode) errors.unshift("Zadejte přístupový kód k pilotu.");
  if (errors.length) {
    errorBox.textContent = errors[0];
    errorBox.hidden = false;
    return;
  }

  runs = people.map((person, index) => ({ ...person, index, state: "queued", results: [] }));
  renderCards();
  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  startButton.disabled = true;
  exportButton.disabled = true;

  await runPool(runs, 2, run => evaluatePerson(run, accessCode));

  startButton.disabled = false;
  exportButton.disabled = !runs.some(run => run.state === "done");
  updateProgress();
}

async function runPool(items, concurrency, task) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function evaluatePerson(run, accessCode) {
  run.state = "running";
  renderCard(run);
  updateProgress();

  try {
    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: run.name, birthYear: run.birthYear, accessCode })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Server odpověděl ${response.status}.`);
    run.results = payload.results.map(result => ({ ...result, originalLevel: result.level, manual: false }));
    run.state = "done";
  } catch (error) {
    run.state = "error";
    run.error = error.message || "Test se nepodařilo dokončit.";
  }

  renderCard(run);
  updateProgress();
}

function renderCards() {
  cards.replaceChildren();
  runs.forEach(run => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".person-card");
    card.dataset.index = run.index;
    cards.append(fragment);
    renderCard(run);
  });
  updateProgress();
}

function renderCard(run) {
  const card = cards.querySelector(`[data-index="${run.index}"]`);
  if (!card) return;
  card.classList.toggle("running", run.state === "running");
  card.querySelector(".person-position").textContent = `TEST ${String(run.index + 1).padStart(2, "0")}`;
  card.querySelector(".person-name").textContent = run.name;
  card.querySelector(".person-year").textContent = `(${run.birthYear})`;
  const status = card.querySelector(".card-status");
  const modelResults = card.querySelector(".model-results");

  if (run.state === "queued") status.textContent = "Čeká ve frontě…";
  if (run.state === "running") status.textContent = "Modely pátrají v paměti…";
  if (run.state === "error") status.textContent = run.error;
  if (run.state === "done") status.textContent = "Kliknutím na semafor můžete automatický odhad opravit.";

  modelResults.replaceChildren();
  if (run.state === "done") {
    run.results.forEach((result, resultIndex) => modelResults.append(createModelRow(run, result, resultIndex)));
  }
  updateScore(card, run);
}

function createModelRow(run, result, resultIndex) {
  const row = document.createElement("div");
  row.className = "model-row";

  const signal = document.createElement("button");
  signal.type = "button";
  signal.className = `signal ${levelClass(result)}`;
  signal.title = result.available ? "Kliknutím změnit hodnocení" : "Model neodpověděl";
  signal.setAttribute("aria-label", result.available ? "Změnit hodnocení modelu" : "Model neodpověděl");
  signal.disabled = !result.available;
  signal.addEventListener("click", () => {
    result.level = result.level === 2 ? 1 : result.level === 1 ? 0 : 2;
    result.manual = result.level !== result.originalLevel;
    renderCard(run);
  });

  const name = document.createElement("div");
  name.className = "model-name";
  name.textContent = result.label;

  const answer = document.createElement("div");
  answer.className = "model-answer";
  if (!result.available) {
    answer.textContent = result.error || "Technická chyba — nezapočítává se.";
  } else if (result.level === 0 && !result.profession && !result.knownFor) {
    answer.textContent = "UNKNOWN";
  } else {
    const profession = document.createElement("b");
    profession.textContent = result.profession || "Neurčený obor";
    answer.append(profession);
    if (result.knownFor) answer.append(document.createTextNode(` — ${result.knownFor}`));
  }
  if (result.manual) {
    const note = document.createElement("span");
    note.className = "manual-note";
    note.textContent = "upraveno ručně";
    answer.append(note);
  }

  row.append(signal, name, answer);
  return row;
}

function levelClass(result) {
  if (!result.available) return "gray";
  return result.level === 2 ? "green" : result.level === 1 ? "orange" : "red";
}

function updateScore(card, run) {
  const score = card.querySelector(".score");
  if (run.state !== "done") {
    score.textContent = "—";
    return;
  }
  const available = run.results.filter(result => result.available);
  if (available.length !== 5) {
    score.textContent = "?";
    score.title = `Odpovědělo jen ${available.length} z 5 modelů.`;
    return;
  }
  score.textContent = available.reduce((sum, result) => sum + result.level, 0);
}

function updateProgress() {
  const finished = runs.filter(run => run.state === "done" || run.state === "error").length;
  progress.textContent = `${finished} / ${runs.length}`;
}

function exportResults() {
  const output = {
    generatedAt: new Date().toISOString(),
    note: "Barvy mohou obsahovat ruční opravy autora pilotu.",
    people: runs.map(({ index, state, error, ...run }) => run)
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `qrfight-pilot-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export { parsePeople };

