# QR Fight — pilot

Pilotní konferenční aplikace, která porovná rozpoznání člověka pěti jazykovými modely. Testované modely dostanou pouze jméno a rok narození a nesmějí hledat na internetu.

## Výsledek

- zelená = model uvedl profesi a konkrétní identifikační fakt,
- oranžová = rámcové nebo nejisté rozpoznání,
- červená = model osobu nezná,
- šedá = technická chyba, která se do výsledku nepočítá.

Skóre 0–10 je prostý součet pěti výsledků: zelená 2, oranžová 1, červená 0. Automatickou barvu lze v prohlížeči ručně opravit a výsledky exportovat jako JSON.

## Proměnné prostředí na Netlify

- `OPENROUTER_API_KEY` — serverový OpenRouter klíč,
- `PILOT_ACCESS_CODE` — heslo chránící pilot před cizí útratou.

Frontend nikdy nedostane OpenRouter klíč. Funkce přijme vždy jen jednu osobu a volá pět modelů souběžně.

Aktuální panel: GPT-6 Astra, Claude Fable 5.1, Gemini 3.8 Flash, Mistral Small 4 a Gemma 3 12B.

## Lokální kontrola

```bash
npm test
```
