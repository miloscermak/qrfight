import { randomUUID } from "node:crypto";
import { createHandler, normalizePerson } from "./evaluate.mjs";
import { AUTHORS, VERSION } from "../../public/protocol.js";
import { classifyGuess, isFinal } from "../../public/results.js";
import {
  openStore,
  json,
  safeEqual,
  sign,
  verify,
  newSession,
  newRecord,
  recordKey,
  updateRecord,
  hash,
} from "../lib/conference.mjs";

export function createConferenceHandler({
  env = process.env,
  storeFactory = openStore,
  evaluate = createHandler({ env }),
  now = () => Date.now(),
} = {}) {
  return async (request) => {
    if (request.method !== "POST")
      return json({ error: "Použijte POST." }, 405);
    if (!env.OPENROUTER_API_KEY || !env.PILOT_ACCESS_CODE)
      return json({ error: "Pilot není nakonfigurovaný.", fatal: true }, 503);
    let payload;
    try {
      const raw = await request.text();
      if (raw.length > 14000)
        return json({ error: "Příliš dlouhý vstup." }, 413);
      payload = JSON.parse(raw);
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error();
    } catch {
      return json({ error: "Neplatný vstup." }, 400);
    }
    if (!safeEqual(payload.accessCode || "", env.PILOT_ACCESS_CODE))
      return json({ error: "Přístupový kód nesedí.", fatal: true }, 401);
    if (payload.version !== VERSION)
      return json(
        { error: "Obnovte stránku, pilot má novou verzi.", fatal: true },
        409,
      );
    try {
      const store = storeFactory();
      if (payload.action === "begin") {
        const validation = normalizePerson(payload);
        if (!validation.ok || /[\n\r;,\t]/.test(payload.name))
          return json(
            { error: "Zadejte právě jedno jméno a rok narození." },
            400,
          );
        const session = newSession(
          validation.person,
          env.OPENROUTER_API_KEY,
          now(),
        );
        const key = recordKey(session);
        await store.setJSON(key, newRecord(session), { onlyIfNew: true });
        const row = await store.get(key, { type: "json" });
        return json({
          version: VERSION,
          day: session.day,
          session: sign(session, env.OPENROUTER_API_KEY),
          results: AUTHORS.map((model) => ({
            model: model.id,
            status: row.slots[model.id]?.status || "queued",
          })),
        });
      }
      const session = verify(payload.session, env.OPENROUTER_API_KEY, now());
      if (!session)
        return json(
          { error: "Platnost hry vypršela. Spusťte ji znovu.", fatal: true },
          401,
        );
      if (
        !AUTHORS.some((model) => model.id === payload.model) ||
        !["portrait", "identify"].includes(payload.action)
      )
        return json({ error: "Neplatný model nebo krok." }, 400);
      const key = recordKey(session),
        model = payload.model,
        attempt = randomUUID();
      let alreadyFinal;
      await updateRecord(store, key, (row) => {
        const slot = row.slots[model];
        alreadyFinal = isFinal(slot);
        if (alreadyFinal) return row;
        if (slot.leaseUntil > now()) throw new Error("busy");
        if (slot.calls >= 12) throw new Error("attempt_limit");
        if (
          payload.action === "identify" &&
          (typeof payload.portrait !== "string" ||
            payload.portrait.length > 6000 ||
            !slot.portraitHash ||
            slot.portraitHash !== hash(payload.portrait))
        )
          throw new Error("portrait_mismatch");
        Object.assign(slot, {
          attempt,
          leaseUntil: now() + 75000,
          calls: slot.calls + 1,
        });
        return row;
      });
      if (alreadyFinal) {
        const row = await store.get(key, { type: "json" });
        return json({
          version: VERSION,
          status: row.slots[model].status,
          stored: true,
        });
      }
      // Jméno z podepsané relace použije jen autor a vyhodnocení shody, nikdy rozhodčí.
      const body =
        payload.action === "portrait"
          ? {
              action: "portrait",
              model,
              name: session.name,
              birthYear: session.birthYear,
            }
          : { action: "identify", portrait: payload.portrait };
      const response = await evaluate(
        new Request("https://internal/evaluate", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            accessCode: env.PILOT_ACCESS_CODE,
            version: VERSION,
          }),
        }),
      );
      const data = await response.json();
      const status = !response.ok
        ? "technical_error"
        : payload.action === "identify"
          ? classifyGuess(session.name, data.guess)
          : data.status;
      await updateRecord(store, key, (row) => {
        const slot = row.slots[model];
        if (slot.attempt !== attempt) return row;
        slot.status = status;
        if (status === "portrait_ready")
          slot.portraitHash = hash(data.portrait);
        if (payload.action === "portrait" && status !== "portrait_ready")
          delete slot.portraitHash;
        if (isFinal(slot)) delete slot.portraitHash;
        delete slot.attempt;
        delete slot.leaseUntil;
        return row;
      });
      return json({ ...data, status }, response.status);
    } catch (error) {
      const messages = {
        busy: "Tento model už pracuje. Počkejte chvíli a zkuste znovu.",
        attempt_limit: "Pro tento model je dnešní počet pokusů vyčerpaný.",
        portrait_mismatch: "Portrét neodpovídá této hře. Spusťte nový portrét.",
        missing_record: "Záznam hry už není dostupný. Spusťte ji znovu.",
      };
      return json(
        {
          error:
            messages[error.message] ||
            "Souhrnné úložiště je dočasně nedostupné. Zkuste krok zopakovat.",
        },
        error.message === "portrait_mismatch" ? 400 : 503,
      );
    }
  };
}
export default createConferenceHandler();
