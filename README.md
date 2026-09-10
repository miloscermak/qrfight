# QR Fight — pilot anonymních portrétů

Online: https://qrfight.netlify.app. Samostatný projekt, vanilla HTML/CSS/JS a serverová funkce Netlify. Bez QR kódu, nejvýše 40 jmen s roky narození na dávku.

## Metoda v2

Čtyři autoři: Claude Fable 5.1, Gemini 3.8 Flash, Grok 4.6, Qwen3.8 Max. Každý dostane jméno a rok, vytvoří nejvýše pět českých řádků bez jména a roku, nebo odpoví NEVÍM. GPT-6 Astra je pouze rozhodčí: v novém dotazu dostane jen portrét a smí jednou tipovat. Žádné vyhledávací nástroje. Přesné prompty a modelové identifikátory sdílí frontend, backend a tipovací experiment v `public/protocol.js`.

- Zelená: tip odpovídá zadanému jménu.
- Červená: jiné jméno nebo NEVÍM autora či rozhodčího.
- Šedá: čekání, technická chyba či vyřazený portrét. Žádná oranžová.

Výsledek je počet rozpoznaných portrétů ze čtyř. S nedokončenými kroky ukazujeme rozsah možného výsledku, například 2–3/4. Nejde o ověření faktů, přímé měření parametrů ani vědecky kalibrovanou známost. Výsledek závisí také na rozhodčím. Portrét může obsahovat halucinace i při správném tipu. Porovnání jmen ignoruje diakritiku, velikost písmen a obrácené pořadí dvou slov, nikoli pseudonymy. Homonyma se stejným jménem nejsou tímto ověřena. Základní kontrola úniku zachytí přesná slova jména a rok, ne všechny skloňované tvary či nepřímé identifikátory.

## Provoz a útrata

Netlify proměnné `OPENROUTER_API_KEY` a `PILOT_ACCESS_CODE` zůstávají na serveru. Klíč není ve veřejném webu ani exportu. `/api/evaluate` povoluje pouze kroky `portrait` (jeden z pevného panelu) a `identify` (pevně Astra). Každý má 52 sekund, klient 65 sekund; nejvýše tři souběžná volání z jedné stránky. Žádné automatické placené opakování. Při selhání Astry opakujeme pouze její krok. Pozastavení nechá doběhnout rozběhnuté volání. Chybný kód či nedostatek kreditu zastaví další práci ve frontě.

Výsledky a útrata zůstávají v paměti stránky. Export JSON zahrnuje všechny dosavadní osoby této stránky, portréty, tipy, stavy, prompty a metadata jednotlivých pokusů. Hotové výsledky stejného jména/roku se při novém spuštění znovu neplatí. Obnovení stránky paměť vymaže. Vykázaná cena může postrádat volání, u kterých se ztratila odpověď.

Přístupový kód je pouze ochrana malého pilotu, ne veřejný konferenční provoz. Aplikace nemá globální rozpočtový strop ani ochranu proti souběžnému používání více stránek. Před veřejným sdílením je nutný serverový limit a omezení rozpočtu klíče v OpenRouteru. Nepublikovat soukromé údaje; portréty nejsou fakticky ověřené.

## Kontrola a nasazení

`npm test` spouští neplacené testy s náhradními odpověďmi. `npx netlify-cli deploy --prod --no-build` nasazuje web a funkci do již propojeného projektu. GitHub push sám v tomto pilotu deployment nespouští.

Vývojové placené zkoušky jsou v `scripts/`; surové výsledky v ignorované `.pilot/`. `guessing-pilot.mjs` používá uložené české portréty a brání opakovanému spuštění, pokud výsledek již existuje. `export-portrait-pilot.mjs --guessing` vytvoří čitelný přehled. Na pěti známých osobnostech se shoda po povolení tipů zvýšila z 13/20 na 16/20, opakování rozhodčího stálo $0.19865. Jde o vývojový vzorek, nikoli nezávislou validaci nebo predikci pro konferenční publikum.

### Zkouška Sonnetu 5 bez přemýšlení (10. září 2026)

`scripts/sonnet-pilot.mjs` porovnal pět nových portrétů Sonnetu s uloženými portréty Fable. Stejné české prompty, stejný rozhodčí s povoleným tipováním; ostatní autoři se znovu nevolali. Sonnet používá `reasoning: { enabled: false }`, nikoli pouhé skrytí přemýšlení. API vykázalo nula reasoning tokenů ve všech pěti odpovědích. Surové požadavky a odpovědi: `.pilot/sonnet-five.json` (nepublikováno v repozitáři).

- Sonnet: 3/5 rozpoznaných portrétů; Fable: 5/5.
- Sonnet uspěl u Pavla Nedvěda, Ewy Farne a Tomáše Halíka. U Miloše Čermáka Astra tipla Daniela Dočekala; u Michala Šandy Sonnet odpověděl NEVÍM.
- Pět portrétů Sonnetu stálo $0.01105 oproti původním $0.10915 za Fable. Celá nová zkouška včetně čtyř dotazů Astry stála $0.03019 (devět API volání).
- Medián času tvorby portrétu byl 4.706 s u Sonnetu oproti uloženým 2.471 s u Fable. Nejde o souběžný rychlostní benchmark: Sonnet obsloužil Claude Platform on AWS, původní Fable Anthropic a odlišné bylo také souběžné zatížení.

Nasazený panel zůstává s Fable. Zkouška prokázala úsporu, ale ne zrychlení ani zachování rozpoznatelnosti na tomto malém vzorku. Výsledek není důkaz, že Sonnet dané lidi vůbec nezná.
