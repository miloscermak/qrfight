import { openStore, dayKey, aggregate, json } from "../lib/conference.mjs";

export function createStatsHandler({
  storeFactory = openStore,
  now = () => Date.now(),
} = {}) {
  let cached,
    cachedUntil = 0,
    pending;
  return async (request) => {
    if (request.method !== "GET") return json({ error: "Použijte GET." }, 405);
    const day = dayKey(now());
    try {
      if (!cached || cached.day !== day || now() >= cachedUntil) {
        // Sdílený rozběhnutý výpočet omezuje souběžné čtení stejného souhrnu.
        pending ||= (async () => {
          const store = storeFactory();
          const { blobs } = await store.list({ prefix: `${day}/` });
          const rows = [];
          let cursor = 0;
          await Promise.all(
            Array.from({ length: Math.min(12, blobs.length) }, async () => {
              while (cursor < blobs.length) {
                const row = await store.get(blobs[cursor++].key, {
                  type: "json",
                });
                if (row) rows.push(row);
              }
            }),
          );
          cached = aggregate(rows, day);
          cachedUntil = now() + 15000;
        })().finally(() => {
          pending = null;
        });
        await pending;
      }
      const response = json(cached);
      response.headers.set(
        "Netlify-CDN-Cache-Control",
        "public, durable, s-maxage=15",
      );
      return response;
    } catch {
      return json(
        { error: "Souhrn se nepodařilo načíst. Za chvíli to zkusíme znovu." },
        503,
      );
    }
  };
}
export default createStatsHandler();
