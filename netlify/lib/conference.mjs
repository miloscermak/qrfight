import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { AUTHORS, VERSION, normalizeName } from "../../public/protocol.js";
import { isFinal } from "../../public/results.js";

export const storeName = "qrfight-conference-v1";
export const openStore = () =>
  getStore({ name: storeName, consistency: "strong" });
export const dayKey = (now = Date.now()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
export const hash = (text) => createHash("sha256").update(text).digest("hex");
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
export function safeEqual(a, b) {
  const left = Buffer.from(String(a)),
    right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
const mac = (value, secret) =>
  createHmac("sha256", secret)
    .update(`qrfight-conference-v1:${value}`)
    .digest("base64url");
export function sign(data, secret) {
  const value = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${value}.${mac(value, secret)}`;
}
export function verify(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [value, signature, extra] = token.split(".");
  if (
    !value ||
    !signature ||
    extra ||
    !safeEqual(signature, mac(value, secret))
  )
    return null;
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString());
    return data.version === VERSION &&
      data.expires > now &&
      data.day === dayKey(now)
      ? data
      : null;
  } catch {
    return null;
  }
}
export function newSession(person, secret, now = Date.now()) {
  const day = dayKey(now);
  // Denní HMAC slouží jen k deduplikaci; samotné jméno ani rok v databázi nejsou.
  const id = mac(
    `${day}|${normalizeName(person.name)}|${person.birthYear}`,
    secret,
  );
  return { ...person, id, day, version: VERSION, expires: now + 86400000 };
}
export const recordKey = (session) => `${session.day}/${session.id}`;
export function newRecord(session) {
  return {
    version: VERSION,
    day: session.day,
    slots: Object.fromEntries(
      AUTHORS.map((model) => [model.id, { status: "queued", calls: 0 }]),
    ),
  };
}
export async function updateRecord(store, key, change) {
  // Podmíněný zápis zabrání tomu, aby si souběžné modely přepsaly výsledky.
  for (let retry = 0; retry < 8; retry++) {
    const current = await store.getWithMetadata(key, { type: "json" });
    if (!current) throw new Error("missing_record");
    const next = change(structuredClone(current.data));
    const result = await store.setJSON(key, next, {
      onlyIfMatch: current.etag,
    });
    if (result.modified) return next;
  }
  throw new Error("write_conflict");
}
export function aggregate(records, day = dayKey()) {
  const result = {
    day,
    updatedAt: new Date().toISOString(),
    entries: 0,
    recognized: 0,
    allFour: 0,
    completed: 0,
    unfinished: 0,
    distribution: [0, 0, 0, 0, 0],
    models: AUTHORS.map((model) => ({
      id: model.id,
      label: model.label,
      matched: 0,
      completed: 0,
    })),
  };
  for (const row of records) {
    if (row.version !== VERSION || row.day !== day) continue;
    const slots = AUTHORS.map(
      (model) => row.slots[model.id] || { status: "queued" },
    );
    const matches = slots.filter((slot) => slot.status === "match").length;
    const complete = slots.every(isFinal);
    result.entries++;
    if (matches > 0) result.recognized++;
    if (matches === AUTHORS.length) result.allFour++;
    if (complete) {
      result.completed++;
      result.distribution[matches]++;
    } else result.unfinished++;
    slots.forEach((slot, i) => {
      if (isFinal(slot)) result.models[i].completed++;
      if (slot.status === "match") result.models[i].matched++;
    });
  }
  return result;
}
