import test from "node:test";
import assert from "node:assert/strict";
import { accessError } from "../netlify/lib/access.mjs";
import { createHandler } from "../netlify/functions/evaluate.mjs";
import { createConferenceHandler } from "../netlify/functions/conference.mjs";
import { AUTHORS, VERSION } from "../public/protocol.js";

const expiresAt = "2026-09-15T00:00:00+02:00";
const expiry = Date.parse(expiresAt);
const env = {
  OPENROUTER_API_KEY: "test-key",
  PILOT_ACCESS_CODE: "test-code",
  PILOT_ACCESS_EXPIRES_AT: expiresAt,
};
const request = (action) =>
  new Request("https://test/api/conference", {
    method: "POST",
    body: JSON.stringify({
      accessCode: "test-code",
      version: VERSION,
      action,
      model: AUTHORS[0].id,
      name: "Testovací osoba",
      birthYear: 1980,
      portrait: "X je autor.",
    }),
  });

test("pilot končí o půlnoci mezi pondělím a úterým českého času", () => {
  assert.equal(new Date(expiry).toISOString(), "2026-09-14T22:00:00.000Z");
  assert.equal(accessError("test-code", env, expiry - 1), null);
  assert.equal(accessError("test-code", env, expiry).status, 403);
  assert.equal(accessError("test-code", env, expiry + 86400000).status, 403);
});
test("chybná expirace přístup uzavře a výměna kódu odmítne starý", () => {
  assert.equal(
    accessError(
      "test-code",
      { ...env, PILOT_ACCESS_EXPIRES_AT: "chyba" },
      expiry - 1,
    ).status,
    503,
  );
  assert.equal(
    accessError(
      "test-code",
      { ...env, PILOT_ACCESS_CODE: "new-code" },
      expiry - 1,
    ).status,
    401,
  );
  assert.equal(accessError("wrong-code", env, expiry - 1).status, 401);
});
for (const action of ["portrait", "identify"])
  test(`po expiraci nepustí původní API placený krok ${action}`, async () => {
    let calls = 0;
    const handler = createHandler({
      env,
      now: () => expiry,
      fetchImpl: async () => {
        calls++;
        throw new Error("Nemělo se volat");
      },
    });
    const response = await handler(request(action));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).fatal, true);
    assert.equal(calls, 0);
  });
for (const action of ["begin", "portrait", "identify"])
  test(`po expiraci nepustí konferenční API krok ${action} ani úložiště`, async () => {
    let calls = 0;
    const handler = createConferenceHandler({
      env,
      now: () => expiry,
      storeFactory: () => {
        calls++;
        throw new Error("Nemělo se číst");
      },
      evaluate: async () => {
        calls++;
        throw new Error("Nemělo se volat");
      },
    });
    const response = await handler(request(action));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).fatal, true);
    assert.equal(calls, 0);
  });
