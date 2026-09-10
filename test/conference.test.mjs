import test from "node:test";
import assert from "node:assert/strict";
import { createConferenceHandler } from "../netlify/functions/conference.mjs";
import { createStatsHandler } from "../netlify/functions/stats.mjs";
import {
  aggregate,
  dayKey,
  newSession,
  newRecord,
  sign,
  verify,
  updateRecord,
} from "../netlify/lib/conference.mjs";
import { AUTHORS, VERSION } from "../public/protocol.js";
import { parsePerson } from "../public/results.js";

const env = {
  OPENROUTER_API_KEY: "fake-secret",
  PILOT_ACCESS_CODE: "fake-code",
};
const instant = Date.parse("2026-09-10T12:00:00Z");
const input = { name: "Miloš Čermák", birthYear: 1968 };
const request = (payload) =>
  new Request("https://test/api/conference", {
    method: "POST",
    body: JSON.stringify({
      version: VERSION,
      accessCode: env.PILOT_ACCESS_CODE,
      ...payload,
    }),
  });
function memoryStore() {
  const rows = new Map();
  let serial = 0;
  return {
    rows,
    async setJSON(key, data, options = {}) {
      const old = rows.get(key);
      if (
        (options.onlyIfNew && old) ||
        (options.onlyIfMatch && old?.etag !== options.onlyIfMatch)
      )
        return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++serial) });
      return { modified: true };
    },
    async getWithMetadata(key) {
      return structuredClone(rows.get(key) || null);
    },
    async get(key) {
      return structuredClone(rows.get(key)?.data || null);
    },
    async list({ prefix }) {
      return {
        blobs: [...rows.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key })),
      };
    },
  };
}
function setup(evaluate) {
  const store = memoryStore();
  let calls = 0;
  const handler = createConferenceHandler({
    env,
    now: () => instant,
    storeFactory: () => store,
    evaluate: async (request) => {
      calls++;
      const payload = await request.json();
      if (evaluate) return evaluate(payload);
      return new Response(
        JSON.stringify(
          payload.action === "portrait"
            ? {
                version: VERSION,
                portrait: "X je český novinář a autor.",
                status: "portrait_ready",
              }
            : { version: VERSION, guess: "Milos Cermak" },
        ),
      );
    },
  });
  const call = async (payload) => {
    const response = await handler(request(payload));
    return { status: response.status, ...(await response.json()) };
  };
  return { store, handler, call, calls: () => calls };
}
test("konferenční vstup přijme jedno jméno a odmítne dávku i opakovaný stejný řádek", () => {
  assert.equal(parsePerson("Ewa Farna, 1993").people.length, 1);
  for (const value of [
    "Ewa Farna, 1993\nEwa Farna, 1993",
    "Ewa Farna, 1993; Pavel Nedvěd, 1972",
    "",
    "Ewa Farna, xyz",
  ])
    assert.ok(parsePerson(value).errors.length);
});
test("denní identifikátor je stabilní, neobsahuje jméno a zítra se změní", () => {
  const a = newSession(input, "secret", instant);
  const b = newSession(
    { name: "Milos Cermak", birthYear: 1968 },
    "secret",
    instant,
  );
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, newSession(input, "secret", instant + 86400000).id);
  assert.equal(dayKey(Date.parse("2026-09-10T23:00:00Z")), "2026-09-11");
  const token = sign(a, "secret");
  assert.deepEqual(verify(token, "secret", instant), a);
  assert.equal(verify(token + "x", "secret", instant), null);
  assert.equal(verify(token, "secret", instant + 86400000), null);
});
test("zahájení je idempotentní a úložiště neobsahuje osobní vstup", async () => {
  const s = setup();
  const a = await s.call({ action: "begin", ...input });
  const b = await s.call({ action: "begin", ...input });
  assert.equal(a.session, b.session);
  assert.equal(s.store.rows.size, 1);
  assert.equal(s.calls(), 0);
  const serialized = JSON.stringify([...s.store.rows]);
  for (const text of [
    "Miloš",
    "Čermák",
    "1968",
    "name",
    "birthYear",
    "session",
  ])
    assert.equal(serialized.includes(text), false);
});
test("souběžné čtyři modely neztratí zápis; rozhodčí vidí jen portrét a skóre vzniká na serveru", async () => {
  const sent = [];
  const s = setup((payload) => {
    sent.push(payload);
    return new Response(
      JSON.stringify(
        payload.action === "portrait"
          ? {
              version: VERSION,
              portrait: "X je český novinář a autor.",
              status: "portrait_ready",
            }
          : { version: VERSION, guess: "Milos Cermak" },
      ),
    );
  });
  const { session } = await s.call({ action: "begin", ...input });
  await Promise.all(
    AUTHORS.map(async (model) => {
      const portrait = await s.call({
        action: "portrait",
        model: model.id,
        session,
      });
      assert.equal(portrait.status, "portrait_ready");
      const result = await s.call({
        action: "identify",
        model: model.id,
        session,
        portrait: portrait.portrait,
        name: "Podvržené jméno",
        status: "mismatch",
      });
      assert.equal(result.status, "match");
    }),
  );
  assert.equal(s.calls(), 8);
  for (const payload of sent.filter(
    (payload) => payload.action === "identify",
  )) {
    assert.deepEqual(Object.keys(payload).sort(), [
      "accessCode",
      "action",
      "portrait",
      "version",
    ]);
    assert.equal(JSON.stringify(payload).includes("Čermák"), false);
  }
  const rows = [...s.store.rows.values()].map((value) => value.data);
  assert.equal(aggregate(rows, dayKey(instant)).allFour, 1);
  for (const text of [
    "Čermák",
    "Cermak",
    "1968",
    "novinář",
    "portraitHash",
    '"guess":',
  ])
    assert.equal(JSON.stringify(rows).includes(text), false, text);
  const repeat = await s.call({
    action: "portrait",
    model: AUTHORS[0].id,
    session,
  });
  assert.equal(repeat.stored, true);
  assert.equal(s.calls(), 8);
});
test("podvržený portrét, relace a dávka nevyvolají placený dotaz", async () => {
  const s = setup();
  const { session } = await s.call({ action: "begin", ...input });
  assert.equal(
    (
      await s.call({
        action: "identify",
        model: AUTHORS[0].id,
        session,
        portrait: "Vymyšlený portrét",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await s.call({
        action: "portrait",
        model: AUTHORS[0].id,
        session: session + "x",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await s.call({
        action: "begin",
        name: "Ewa Farna, 1993; Pavel Nedvěd",
        birthYear: 1972,
      })
    ).status,
    400,
  );
  assert.equal(
    (await s.call({ action: "begin", ...input, accessCode: "wrong" })).status,
    401,
  );
  assert.equal(s.calls(), 0);
});
test("souběžný duplicitní požadavek zaplatí jen jeden portrét", async () => {
  let finish;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  const s = setup(async () => {
    await waiting;
    return new Response(
      JSON.stringify({
        version: VERSION,
        status: "author_unknown",
        portrait: "NEVÍM",
      }),
    );
  });
  const { session } = await s.call({ action: "begin", ...input });
  const payload = { action: "portrait", model: AUTHORS[0].id, session };
  const first = s.call(payload);
  while (!s.calls()) await new Promise((resolve) => setImmediate(resolve));
  const second = await s.call(payload);
  assert.equal(second.status, 503);
  assert.equal(s.calls(), 1);
  finish();
  await first;
});
test("technická chyba zůstává nedokončená a opakování Astry nepotřebuje nový portrét", async () => {
  let judges = 0;
  const s = setup((payload) => {
    if (payload.action === "portrait")
      return new Response(
        JSON.stringify({ status: "portrait_ready", portrait: "X je autor." }),
      );
    if (++judges === 1)
      return new Response(JSON.stringify({ error: "Timeout" }), {
        status: 504,
      });
    return new Response(JSON.stringify({ guess: "NEVÍM" }));
  });
  const { session } = await s.call({ action: "begin", ...input });
  await s.call({ action: "portrait", model: AUTHORS[0].id, session });
  const payload = {
    action: "identify",
    model: AUTHORS[0].id,
    session,
    portrait: "X je autor.",
  };
  assert.equal((await s.call(payload)).status, "technical_error");
  const summary = aggregate(
    [...s.store.rows.values()].map((value) => value.data),
    dayKey(instant),
  );
  assert.equal(summary.unfinished, 1);
  assert.equal(summary.distribution[0], 0);
  assert.equal((await s.call(payload)).status, "judge_unknown");
  assert.equal(s.calls(), 3);
});
test("souhrn rozlišuje úplnou nulu od chyby a nesděluje identifikátory", async () => {
  const store = memoryStore();
  const session = newSession(input, "secret", instant);
  const rows = [newRecord(session), newRecord(session), newRecord(session)];
  AUTHORS.forEach((model) => {
    rows[0].slots[model.id].status = "match";
    rows[1].slots[model.id].status = "mismatch";
  });
  rows[2].slots[AUTHORS[0].id].status = "match";
  await Promise.all(
    rows.map((row, i) => store.setJSON(`${session.day}/private-id-${i}`, row)),
  );
  await store.setJSON(
    "2020-01-01/old",
    newRecord({ ...session, day: "2020-01-01" }),
  );
  const handler = createStatsHandler({
    storeFactory: () => store,
    now: () => instant,
  });
  const response = await handler(new Request("https://test/api/stats"));
  const summary = await response.json();
  assert.equal(summary.entries, 3);
  assert.equal(summary.recognized, 2);
  assert.equal(summary.allFour, 1);
  assert.deepEqual(summary.distribution, [1, 0, 0, 0, 1]);
  assert.equal(summary.completed, 2);
  assert.equal(summary.unfinished, 1);
  assert.equal(JSON.stringify(summary).includes("private-id"), false);
});
test("opakovaný podmíněný zápis zachová cizí změnu", async () => {
  const store = memoryStore();
  await store.setJSON("key", { first: 0, second: 0 });
  await Promise.all([
    updateRecord(store, "key", (row) => ({ ...row, first: 1 })),
    updateRecord(store, "key", (row) => ({ ...row, second: 1 })),
  ]);
  assert.deepEqual(await store.get("key"), { first: 1, second: 1 });
});
