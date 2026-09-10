import test from "node:test";
import assert from "node:assert/strict";
import { classifyOutput, normalizePerson, parseModelContent } from "../netlify/functions/evaluate.mjs";

test("normalizuje platnou osobu", () => {
  assert.deepEqual(normalizePerson({ name: "  Ewa   Farna ", birthYear: 1993 }), {
    ok: true,
    person: { name: "Ewa Farna", birthYear: 1993 }
  });
});

test("odmítne neplatný rok", () => {
  assert.equal(normalizePerson({ name: "Testovací Osoba", birthYear: 3020 }).ok, false);
});

test("odstraní markdownový obal JSON", () => {
  const parsed = parseModelContent('```json\n{"recognition":"partial","profession":"writer","known_for":""}\n```');
  assert.equal(parsed.recognition, "partial");
});

test("zelenou přidělí jen konkrétní odpovědi", () => {
  assert.equal(classifyOutput({ recognition: "clear", profession: "writer", known_for: "Author of a distinctive novel" }), 2);
  assert.equal(classifyOutput({ recognition: "clear", profession: "writer", known_for: "" }), 1);
  assert.equal(classifyOutput({ recognition: "unknown", profession: "", known_for: "" }), 0);
});

