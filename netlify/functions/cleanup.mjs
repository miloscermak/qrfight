import { openStore, dayKey } from "../lib/conference.mjs";

export const config = { schedule: "0 * * * *" };
export default async () => {
  const store = openStore();
  const cutoff = dayKey(Date.now() - 2 * 86400000);
  // Staré denní oddíly už nepřijímají zápisy; mazání tedy nesmaže nově rozehranou hru.
  let deleted = 0;
  const started = Date.now();
  for await (const page of store.list({ paginate: true })) {
    const expired = page.blobs.filter((blob) => blob.key.slice(0, 10) < cutoff);
    for (let offset = 0; offset < expired.length; offset += 20) {
      await Promise.all(
        expired
          .slice(offset, offset + 20)
          .map((blob) => store.delete(blob.key)),
      );
      deleted += Math.min(20, expired.length - offset);
      if (Date.now() - started > 20000)
        return new Response(JSON.stringify({ deleted, continuation: true }));
    }
  }
  return new Response(JSON.stringify({ deleted }));
};
