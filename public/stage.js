const $ = (selector) => document.querySelector(selector);
const number = (value) => new Intl.NumberFormat("cs-CZ").format(value);
let paused = false,
  timer,
  loading = false;
function render(data) {
  $("#entries").textContent = number(data.entries);
  $("#recognized").textContent = number(data.recognized);
  $("#all-four").textContent = number(data.allFour);
  $("#completion").textContent =
    `Dokončeno: ${number(data.completed)}. Nedokončeno: ${number(data.unfinished)} (včetně technických chyb). Graf obsahuje jen dokončené hry.`;
  $("#distribution").replaceChildren();
  const max = Math.max(1, ...data.distribution);
  data.distribution.forEach((count, points) => {
    const column = document.createElement("div");
    column.className = "bar-column";
    column.setAttribute(
      "aria-label",
      `${points} ze 4: ${count} dokončených her`,
    );
    const value = document.createElement("b");
    value.textContent = number(count);
    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${(count / max) * 100}%`;
    track.append(bar);
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = `${points}/4`;
    column.append(value, track, label);
    $("#distribution").append(column);
  });
  $("#model-stats").replaceChildren();
  data.models.forEach((model) => {
    const row = document.createElement("div");
    row.className = "stage-model";
    const name = document.createElement("span");
    name.textContent = model.label;
    const count = document.createElement("b");
    count.textContent = `${number(model.matched)} / ${number(model.completed)}`;
    row.append(name, count);
    $("#model-stats").append(row);
  });
  const time = new Date(data.updatedAt).toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Prague",
  });
  $("#live-status").textContent = paused
    ? "Obnovování pozastaveno."
    : `${data.day} / ${time} · obnovujeme po 15 s`;
}
async function refresh() {
  if (paused || loading || document.hidden) return;
  loading = true;
  try {
    const response = await fetch("/api/stats", {
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Souhrn není dostupný.");
    render(data);
    $("#stats-error").hidden = true;
  } catch {
    $("#stats-error").textContent =
      "Spojení se souhrnem vypadlo. Zobrazená čísla se teď neaktualizují; za chvíli to zkusíme znovu.";
    $("#stats-error").hidden = false;
    $("#live-status").textContent =
      "Čekáme na spojení — čísla mohou být starší.";
  } finally {
    loading = false;
  }
}
$("#toggle-refresh").addEventListener("click", () => {
  paused = !paused;
  $("#toggle-refresh").textContent = paused
    ? "Obnovit živý souhrn"
    : "Pozastavit živý souhrn";
  if (paused) $("#live-status").textContent = "Obnovování pozastaveno.";
  else refresh();
});
if (!document.documentElement.requestFullscreen) $("#fullscreen").hidden = true;
$("#fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $("#fullscreen").hidden = true;
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
timer = setInterval(refresh, 15000);
window.addEventListener("pagehide", () => clearInterval(timer));
refresh();
