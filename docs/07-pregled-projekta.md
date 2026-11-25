# 7. Pregled projekta in preverjanje uporabniških zgodb

Pregled igre **[REDACTED]**, opravljen 25. 11. 2026, na veji `main`, commit `ba83159`. Podlaga so README, `REDACTED.md`, dokumenti 01–06 in ADR, frontend v `src/`, backend v `backend/src/`, shema in začetni podatki v `prisma/`, javne uganke, konfiguracija ter obstoječe testne skripte. Arhiva ZIP vsebujeta starejšo projektno dokumentacijo; za ocene veljajo zgodbe iz [05-uporabniske-zgodbe.md](05-uporabniske-zgodbe.md).

**Sklep:** igralno jedro je implementirano in lokalni avtomatski preizkusi uspejo. Trditev README, da je projekt v celoti skladen s specifikacijami, je preširoka: trajno nadaljevanje sej, dnevna menjava uganke in zaščita rešitev imajo konkretne vrzeli.

Nenavadnih navodil, namenjenih AI, v pregledanem projektnem gradivu nisem našel. Aplikacijska koda ni bila spremenjena.

## 1. Dejansko implementirane funkcionalnosti MVP

Šest funkcionalnosti MVP iz [02-funkcionalnosti-in-obseg.md](02-funkcionalnosti-in-obseg.md) ima naslednjo podporo v kodi:

| Funkcionalnost | Implementacija in dejanski obseg |
| --- | --- |
| Ugibanje in razkrivanje sorodnih besed | `backend/src/utils/game-engine.ts`: `evaluateServerGuess`, `processSessionGuess`; `backend/src/utils/stemmer.ts`: `cleanGuess`, `stemWord`. Primerjava besede in korena, razkritje vseh zadetkov, zgodovina tudi neuspešnih poskusov in preprečevanje dvojnikov. Podprt je poenostavljen angleški stemmer. |
| Dve vrsti namigov | `POST /api/game/hint` v `backend/src/routes/game.routes.ts`, izbira v `game-engine.ts`, potrjevanje v `src/components/modals/HintModal.tsx`. Strežniška pot dovoljuje tri osnovne namige in en glavni namig pri vsaj dveh ciljnih besedah naslova. |
| Interaktivni cenzurirani dokument | `src/components/document/DocumentViewer.tsx`, `DocumentToken.tsx`, `src/index.css` in `src/hooks/useOccurrenceNavigation.ts`. Bloki dolžine besed, animacija razkritja, pomik in premikanje med zadetki. `maskPuzzleForClient` v `backend/src/utils/masking.ts` maskira odgovore API. Javne datoteke JSON to zaščito obidejo. |
| Zmaga in povzetek za deljenje | `checkServerWinCondition` v `masking.ts`, `triggerVictory` v `src/hooks/useGame.ts` in `src/components/modals/WinModal.tsx`. Razkritje članka, statistika in povzetek brez naslova so implementirani; potrditev kopiranja ni zanesljiva. |
| Registracija, prijava in vloge | `backend/src/routes/auth.routes.ts`, `backend/src/middleware/auth.ts`, `src/context/AuthContext.tsx`, `src/components/modals/AuthModal.tsx`. Lokalni računi, validacija, JWT ter omejitev uredniških in administratorskih poti so prisotni. Celotna zahtevana pot Supabase Auth ni potrjena. |
| Shranjevanje in nadaljevanje | `getOrCreateSession` v `game.routes.ts`, `loadPuzzle` v `useGame.ts` ter `src/utils/storage.ts`. Strežniške seje se nadaljujejo iz pomnilnika med delovanjem istega procesa; rezervni statični način uporablja `localStorage`. Trajna obnova iz baze ni implementirana. |

Prve štiri postavke tvorijo igralno jedro, zadnji dve pa imata pomembne omejitve sistemskega dela MVP. Prisotnost funkcije v kodi sama po sebi ne potrjuje vseh njenih pogojev sprejemljivosti.

## 2. Preverjanje petih obstoječih uporabniških zgodb

Ocene veljajo glede na zapisane pogoje sprejemljivosti: **izpolnjena** pomeni podporo v kodi za pregledani potek; **delno izpolnjena** pomeni prisotno izvedbo z vsaj eno konkretno vrzeljo; **ni izpolnjena** bi pomenilo odsotnost zahtevane izvedbe. Nepreverjeno izvajanje je navedeno posebej in ni samodejno označeno kot manjkajoča implementacija.

| Zgodba iz dokumenta 05 | Ocena |
| --- | --- |
| US-01: Pametno ugibanje in razkrivanje besed | Delno izpolnjena |
| US-04: Uporaba glavnega namiga (beseda v naslovu) | Izpolnjena za obstoječe uganke in strežniški potek |
| US-05: Zmaga in deljenje rezultata brez razkritja gesla | Delno izpolnjena |
| US-07: Samodejno shranjevanje in nadaljevanje igre | Delno izpolnjena |
| US-11: Nastavitev težavnosti in razporeditev objave | Delno izpolnjena |

### US-01 — Delno izpolnjena

**Želja igralca:** z vnosom besed postopoma razkriti vsebino in temo članka.

- **Pogoji 1, 3–5:** `InputBar.tsx` podpira Enter in gumb »Ugibaj«; `useGame.handleGuess` kliče `/api/game/guess`. `evaluateServerGuess` pregleda naslov, naslove razdelkov in odstavke. `processSessionGuess` beleži tudi nič zadetkov in vrne `alreadyGuessed` brez novega poskusa pri dvojniku. `GuessLogRow.tsx` izpiše število zadetkov; `DocumentToken.tsx` in `.token-just-revealed` v `src/index.css` podpirata obarvano animacijo.
- **Pogoj 2 je omejen:** `stemWord` združuje izbrane angleške oblike, npr. `acts`, `acting`, `acted`. Slovenski primer »odkriti« → »odkril«, »odkritje«, »odkrijejo« ni podprt; `cleanGuess` sprejme le `a–z`. Dokument 02 slovenski lematizator sicer uvršča med kasnejše nadgradnje, `REDACTED.md` pa opisuje angleške članke. To pojasni obseg, ne izpolni pa dobesedno zapisanega pogoja zgodbe.

Testi potrjujejo ugibanje `physics`, zavrnitev neveljavnega vnosa, prepoznavo dvojnika in izbrane angleške korene. Animacija v brskalniku ni bila preizkušena.

### US-04 — Izpolnjena za obstoječe uganke in strežniški potek

**Želja igralca:** z glavnim namigom razkriti eno besedo naslova.

`selectTitleHintWord` v `backend/src/utils/game-engine.ts` zahteva vsaj dve ciljni besedi naslova in izbere eno naključno še skrito besedo. `HintModal.tsx` preveri razpoložljivost in s stanjem `confirmingTitleHint` zahteva potrditev. `/api/game/hint` preveri `session.titleHintUsed` ter zavrne ponovno uporabo. S tem so v kodi pokriti vsi štirje pogoji.

»Beseda naslova« se v izvedbi nanaša na besedo, ki ni vnaprej vidna vezna beseda (`!isStopWord`). Izbrana beseda se obdela prek `processSessionGuess`, zato se razkrijejo tudi njene druge pojavitve in ujemajoči koreni. Za poljubne prihodnje naslove s ponovljenimi koreni zato ni zagotovljeno razkritje natanko enega naslovnega bloka.

Obstoječi API-test preveri zavrnitev namiga pri enobesednem naslovu in uspešno prvo uporabo pri »Albert Einstein«. Ponovne uporabe glavnega namiga in potrditvenega okna ne preizkusi; njuna podpora je preverjena z branjem kode.

### US-05 — Delno izpolnjena

**Želja igralca:** ob zmagi pregledati statistiko in deliti rezultat brez rešitve.

**Pogoji 1–3 imajo implementacijo:** `checkServerWinCondition` zahteva razkritje vseh ciljnih besed naslova. Backend nato vrne `fullPuzzle`; `useGame.triggerVictory` sproži konfete in odpre okno. `WinModal.tsx` prejme številko uganke in prikaže poskuse, natančnost, čas ter namige. `generateShareText` sestavi povzetek z emoji brez naslova članka, `handleCopyShare` pa uporablja `navigator.clipboard.writeText`.

**Vrzel pri pogojih 3–4:** `handleCopyShare` nastavi `copied = true` tudi ob manjkajočem `navigator.clipboard` in v veji `catch`. Uporabnik zato prejme »REZULTAT SKOPIRAN!«, čeprav kopiranje ni uspelo. Zmaga je preverjena z API-testom; dejansko kopiranje in vizualno vedenje nista bila preizkušena v brskalniku.

### US-07 — Delno izpolnjena

**Želja registriranega igralca:** sproti shraniti napredek in nadaljevati na drugi napravi.

`processSessionGuess` hrani ugibanja v `store.sessions`; ob nastavljeni bazi poskusi še `prisma.gameSession.upsert` in `prisma.guessLog.create`. Napake zapisovanja le zabeleži v konzolo. To je delna podpora prvemu pogoju, brez potrditve uspešnega trajnega zapisa.

**Ključna vrzel pogojev 2–3:** `getOrCreateSession` bere samo `store.sessions`, po identifikatorju seje ali po uporabniku in uganki. Obnova sej oziroma ugibanj z branjem iz PostgreSQL manjka. Osvežitev ali druga naprava lahko nadaljuje sejo med delovanjem istega procesa, po ponovnem zagonu strežnika pa shranjeni podatki iz baze ne obnovijo napredka.

**Pogoj 4 ima podporo v pomnilniškem načinu:** `loadPuzzle` obnovi ugibanja, razkrite žetone, števce in stanje `isWon`, ob že rešeni igri pa odpre rezultat. Čas se strežniku pošilja ob ugibanju oziroma namigu, ne sproti med čakanjem. Obstoječi testi ne preverjajo ponovnega zagona ali nadaljevanja na drugi napravi.

### US-11 — Delno izpolnjena

**Želja urednika:** določiti težavnost in datum samodejne aktivacije uganke.

`EditorAdminModal.tsx` vsebuje izbiro težavnosti in datuma ter funkcijo `handleSaveScheduledPuzzle`. `POST /api/admin/puzzles` v `admin.routes.ts` preveri `VALID_DIFFICULTIES`, zavrne datum, zaseden v pomnilniški shrambi, z odgovorom `409` in ustvari uganko `SCHEDULED`. Ob nastavljeni bazi poskusi še `prisma.puzzle.create`; napako lahko le zabeleži in vseeno vrne `201`. Prva dva pogoja sta podprta lokalno, tretji pa ni zagotovljen kot zapis v bazo.

**Četrti pogoj ni v celoti izpolnjen:** `backend/src/index.ts` vsakih 60 sekund kliče `runScheduledPuzzlesPublisher`. Ta na podlagi datuma UTC spreminja statuse samo v pomnilniku, brez zapisa v bazo. `/api/game/today` izbere prvo uganko `PUBLISHED`, ne uganke za današnji datum. Ker `seedMemoryStore` v `backend/src/lib/store.ts` že objavi uganko #2, nova objava ne zagotovi menjave dnevnega izziva. Stare objavljene uganke se samodejno ne arhivirajo.

Test preveri ustvaritev `SCHEDULED` in konflikt datuma. Razporejevalnik je pri `NODE_ENV=test` izključen, zato uspeh testa ne potrdi objave ob polnoči.

## 3. Ločitev delujočega, nedokončanega in nepreverjenega

### Delovanje, potrjeno z obstoječimi lokalnimi testi

- API vrne maskirano uganko; ugibanje razkrije zadetke in prepozna dvojnike.
- Strežniška omejitev treh osnovnih namigov, zavrnitev glavnega pri enobesednem naslovu ter prva uporaba pri večbesednem naslovu.
- Zmaga razkrije naslov in povezavo; osebna statistika ter seznam dosežkov sta dosegljiva v pomnilniškem načinu.
- Prijava demo igralca, prepoved uredniške poti navadnemu igralcu in prepoved odvzema lastne vloge `ADMIN`.
- Arhiv označi rešeno uganko, dnevna lestvica pa razvrsti rezultate po poskusih in času (`backend/src/routes/leaderboard.routes.ts`).
- Uredniška pot zavrne neustrezen URL, vrne predogled, ustvari načrtovano uganko in zavrne podvojen datum.

Dodatno so v kodi povezani arhiv, lestvica, statistika, značke, uredniški obrazec in upravljanje vlog (`src/components/modals/`), tri teme in zvok (`useTheme.ts`, `useSound.ts`, `audio.ts`). Njihove celotne uporabniške poti niso potrjene z brskalniškim preizkusom. Začetni rezultati lestvice in statistike vključujejo demonstracijske podatke iz `seedMemoryStore`.

### Nedokončano, delno ali manjkajoče

- **Trajnost podatkov:** seje, uganke, statistika, dosežki in lestvica se berejo iz pomnilnika. Zapisovanje dela podatkov prek Prisma ne zagotavlja njihove obnove. `finalizeSessionVictory` dosežke dodeli samo v `store.userAchievements`; zapis v tabelo `user_achievements` manjka.
- **Dnevna menjava in kopiranje:** konkretne vrzeli opisujeta US-11 in US-05.
- **Zaščita rešitev:** `public/puzzles/today.json` in `puzzle-*.json` vsebujejo nemaskirane naslove in besedila. Vite jih kopira v javni del gradnje; `useGame.loadPuzzle` jih uporablja kot rezervni vir. Maskiranje API zato ne zagotovi obljube README in ADR 0003, da rešitev do zmage ostane samo na strežniku.
- **Prijava:** backend vrača `signLocalJwt`, frontend pa ta žeton uporablja za API; dodatni klic Supabase pri prijavi ne zagotavlja zahtevane Supabase seje. Če je nastavljen samo PostgreSQL in uporabnik iz baze nima `passwordHash`, ga veja v `auth.routes.ts` lahko prijavi brez preverjanja gesla. To je ugotovitev iz kode, brez preizkusa s pravo bazo.
- **Dostop do sej in arhiva:** `getOrCreateSession` pri prejetem `sessionId` ne preveri lastništva že pripisane seje. Pot `/api/game/puzzle/:number` uporablja le `authenticateOptional`, brez obvezne prijave ali preverjanja statusa objave. Omejitev arhiva v uporabniškem vmesniku zato ni enakovredna strežniški omejitvi.
- **Nizi zmag:** `finalizeSessionVictory` poveča niz ob vsakem drugačnem datumu uganke, ne preveri zaporednosti dni. Reševanje arhiva ali preskok dneva zato lahko napačno povečuje niz in pripadajoče dosežke.
- **Pristnost uvoza:** ob neuspelem prenosu `admin.routes.ts` vstavi generično nadomestno besedilo. Uspešen odgovor in predogled zato še ne dokazujeta dejanskega uvoza Wikipedijinega članka.
- **Statični način:** `useGame.ts` pri shranjevanju osnovnih namigov ohrani le `freeHintUsed`, pri obnovi pa iz njega nastavi števec 0 ali 1. Poraba do treh namigov se po osvežitvi ne obnovi pravilno.
- **Ni implementirano:** predlogi tem in glasovanje (funkcionalnost 11 iz dokumenta 02). Slovensko lematiziranje ter druge tam navedene kasnejše nadgradnje niso del delujočega MVP.

### Nepreverjeno

- Dejanska povezava s Supabase Auth in PostgreSQL, uveljavitev sheme, začetno polnjenje ter obstojnost zapisov v zunanji bazi. Zunanja baza ni bila spreminjana.
- Dejanski prenos članka iz Wikipedije: test ne razlikuje izvirnega od nadomestnega besedila.
- Vizualni prikaz, odzivnost, animacije, pomik, teme, zvok in odložišče v brskalniku.
- Izvajanje ob dejanskem prehodu čez 00:00 UTC in nadaljevanje med dvema napravama.

## 4. Izvedena preverjanja in njihove meje

| Ukaz | Rezultat pregleda |
| --- | --- |
| `npm test` | Uspešno po odobrenem zagonu zunaj peskovnika; prvi poskus je ustavil `EPERM` pri komunikacijskem kanalu `tsx`. Izvedena sta obstoječa skripta `test-acceptance-criteria.ts` in `test-game-logic.mjs`. |
| `npm run lint` | Uspešno. |
| `npm run build` | Uspešno: TypeScript in produkcijska gradnja Vite. |

API-preizkusi so potekali v lokalnem načinu brez konfigurirane zunanje baze. Kljub končnemu izpisu skripte o vseh zgodbah US-01–US-15 testi ne preverjajo vseh njihovih pogojev: med drugim ne izvajajo brskalnika, ne preverjajo trajne obnove sej in ne zaženejo razporejevalnika. Tudi test izračuna časa do polnoči ne potrjuje dejanske menjave uganke.

Med petimi izbranimi zgodbami je ena izpolnjena v navedenem obsegu, štiri pa so delno izpolnjene. Projekt omogoča lokalno demonstracijo igralnega jedra, popolne skladnosti z dokumentiranim MVP pa trenutna implementacija ne dosega.
