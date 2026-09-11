import { timingSafeEqual } from "node:crypto";

export function accessError(code, env, now = Date.now()) {
  const received = Buffer.from(String(code || ""));
  const expected = Buffer.from(String(env.PILOT_ACCESS_CODE || ""));
  if (
    !expected.length ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return { status: 401, error: "Přístupový kód nesedí.", fatal: true };
  }
  // Kontrola patří před každý placený krok, ne jen před zahájení hry.
  if (env.PILOT_ACCESS_EXPIRES_AT) {
    const expires = Date.parse(env.PILOT_ACCESS_EXPIRES_AT);
    if (!Number.isFinite(expires))
      return {
        status: 503,
        error: "Platnost kódu není správně nastavená. Pilot je pozastavený.",
        fatal: true,
      };
    if (now >= expires)
      return {
        status: 403,
        error:
          "Platnost tohoto kódu skončila. Pro další hru potřebujete nový kód.",
        fatal: true,
      };
  }
  return null;
}
