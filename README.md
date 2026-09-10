# QR Fight — pilot anonymních portrétů

Online: https://qrfight.netlify.app. Samostatný projekt, vanilla HTML/CSS/JS a serverové funkce Netlify. Konferenční pilot přijímá právě jedno jméno a rok narození, oddělené čárkou. Bez QR kódu. Nový vzhled: typografický konferenční průkaz, černá a žlutozelená; mobilní i desktopová verze.

Veřejné plátno: https://qrfight.netlify.app/stage.html — souhrny dnešního dne podle českého času, obnovení po 15 sekundách. Bez veřejných jmen, portrétů nebo volby zveřejnění jména.

## Metoda v2

Čtyři autoři: Claude Fable 5.1, Gemini 3.8 Flash, Grok 4.6, Qwen3.8 Max. Každý dostane jméno a rok, vytvoří nejvýše pět českých řádků bez jména a roku, nebo odpoví NEVÍM. GPT-6 Astra je pouze rozhodčí: v novém dotazu dostane jen portrét a smí jednou tipovat. Žádné vyhledávací nástroje. Přesné prompty a modelové identifikátory sdílí frontend, backend a tipovací experiment v `public/protocol.js`.

- Zelená: tip odpovídá zadanému jménu.
- Červená: jiné jméno nebo NEVÍM autora či rozhodčího.
- Šedá: čekání, technická chyba či vyřazený portrét. Žádná oranžová.

Výsledek je počet rozpoznaných portrétů ze čtyř. S nedokončenými kroky ukazujeme rozsah možného výsledku, například 2–3/4. Nejde o ověření faktů, přímé měření parametrů ani vědecky kalibrovanou známost. Výsledek závisí také na rozhodčím. Portrét může obsahovat halucinace i při správném tipu. Porovnání jmen ignoruje diakritiku, velikost písmen a obrácené pořadí dvou slov, nikoli pseudonymy. Homonyma se stejným jménem nejsou tímto ověřena. Základní kontrola úniku zachytí přesná slova jména a rok, ne všechny skloňované tvary či nepřímé identifikátory.

## Provoz a útrata

Netlify proměnné `OPENROUTER_API_KEY` a `PILOT_ACCESS_CODE` zůstávají na serveru. Klíč není ve veřejném webu ani exportu. `/api/conference` zahájí hru, ověří podepsanou relaci a používá existující vyhodnocení autorů a Astry. Každý AI krok má 52 sekund, klient 70 sekund; nejvýše tři souběžná volání z jedné stránky. Žádné automatické placené opakování. Při selhání Astry opakujeme pouze její krok. Pozastavení nechá doběhnout rozběhnuté volání. Chybný kód či nedostatek kreditu zastaví další práci ve frontě. Původní `/api/evaluate` zůstává kompatibilní s vývojovými nástroji; jeho samostatné dotazy nejsou součástí konferenčních souhrnů.

Texty a útrata zůstávají v paměti stránky. Export JSON zahrnuje aktuální osobu, portréty, tipy, stavy, prompty a metadata jednotlivých pokusů, nikoli relační token. Hotové výsledky stejného jména/roku se během dne obnoví ze serveru bez placení. Po obnovení stránky však nelze obnovit texty, které neukládáme. Nedokončený portrét bez zachovaného textu je potřeba vytvořit znovu. Vykázaná cena může postrádat volání, u kterých se ztratila odpověď.

Rozpočet řídí limit klíče v OpenRouteru podle rozhodnutí zadavatele. Nevytváříme druhý finanční strop. Přístupový kód je ochrana pilotu, ne plnohodnotná ochrana proti zneužití. Konferenční cesta má 75sekundový zámek souběžného volání jednoho modelu a nejvýše 12 kroků na model / vstup / den. Nová jména tím nejsou globálně omezena. Provoz pro 2000 souběžných účastníků není zátěžově ověřený; před ostrou konferencí ověřit limity hostingu a poskytovatele. Nepublikovat soukromé údaje; portréty nejsou fakticky ověřené.

## Souhrnné úložiště

Netlify Blobs `qrfight-conference-v1`, konzistentní čtení a podmíněné zápisy. Žádná další konfigurace účtu: přístup získají nasazené funkce z prostředí Netlify. Každé jméno + rok má denní HMAC vytvořený s tajným serverovým klíčem. Jde o pseudonymní deduplikační identifikátor, ne ověření totožnosti ani tvrzení o právní anonymitě. V úložišti jsou pouze den, verze, stavy jednotlivých modelů, počet pokusů, dočasný zámek a hash dosud nevyhodnoceného portrétu. Žádné jméno, rok, portrét, tip, IP nebo uživatelský token se aplikačním kódem neukládají. Dotazy samozřejmě procházejí poskytovateli AI a hostingem; jejich nakládání s daty tím není ovlivněno.

Shodu vyhodnocuje server. Rozhodčí přijme jen portrét, jehož hash odpovídá předchozí odpovědi autora v dané hře. Klient nemůže poslat vlastní skóre. Čtyři souběžné zápisy chrání ETag; hotový model se znovu neplatí. Změna API klíče zneplatní relace a změní deduplikační identifikátory, proto jej neměnit během akce.

`/api/stats` poskytuje jen dnešní agregace (Europe/Prague): vstupy, alespoň jedna shoda, všechny čtyři shody, dokončené a nedokončené hry, rozdělení 0–4 pouze z dokončených her a výsledky autorů. Část hráčů může zadat jiného člověka; nepíšeme proto „ověřený počet lidí“. Souhrn má 15sekundovou cache. `cleanup` je hodinová plánovaná funkce, která maže oddíly starší než dva předchozí dny (retence přibližně 2–3 dny plus doběh úklidu). Návrat na starý den nedovolí vypršelá relace. Není zde veřejný reset ani veřejný seznam záznamů.

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
