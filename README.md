# X-Ray Body Mirror

Een live röntgenspiegel voor je hele lichaam. De webcam volgt 33 punten op je lichaam en legt er een anatomisch model over: skelet, spieren, organen, hersenen en zenuwen, bloedvaten en de lichaamscontour. Alles draait in je browser; er gaat geen video naar een server.

Geïnspireerd door [MasterOfVFX2070/xray-mirror](https://github.com/MasterOfVFX2070/xray-mirror) (alleen het hoofd). Er is geen code van die repo overgenomen.

## Starten

**Online:** open **https://nvcampen.github.io/xray-body-mirror/** in Chrome of Edge, klik op **Start camera** en geef toegang.

**Offline, als één bestand:** download [X-Ray Body Mirror.html](https://nvcampen.github.io/xray-body-mirror/dist/X-Ray%20Body%20Mirror.html) en dubbelklik erop. Je hebt nog steeds internet nodig, want three.js en het trackingmodel komen van een CDN.

**Zonder camera:** klik op **Demo zonder camera**. Het model doorloopt dan zelf een paar houdingen (armen spreiden, zwaaien, squat).

**Tips voor een goed resultaat**
- Ga op 2 à 3 meter van de camera staan, zodat je van hoofd tot voeten in beeld bent.
- Zorg voor licht van voren en een rustige achtergrond.
- Zet **Trackingpunten** aan om te zien wat de tracker ziet.

## Hoe het werkt

1. **Tracking** (`src/tracker.js`): MediaPipe Pose geeft per videobeeld 33 punten op het beeld, dezelfde punten in meters (voor diepte) en een masker van je silhouet. Een One Euro-filter haalt het trillen eruit.
2. **Rig** (`src/rig.js`): het lichaam is opgedeeld in 15 segmenten (bekken, borstkas, hoofd, en per kant opperarm, onderarm, hand, dij, scheen, voet). Voor elk segment wordt een assenstelsel gebouwd op het model en op jou. Het verschil is de transformatie die het model op jouw lichaam legt.
3. **Anatomie** (`src/body.js`): elk punt van het model hangt aan één of twee segmenten. De vertex shader mengt die twee, zodat huid, spieren en bloedvaten mooi meebuigen in de gewrichten. Botten hangen star aan één segment.
4. **Weergave** (`src/main.js`): röntgen- of solide stijl, lagen, labels en een donkere sluier over je echte lichaam (uit het silhouetmasker).

## Mappen

| Pad | Inhoud |
|---|---|
| `index.html`, `src/` | De app (ES-modules, three.js via een import map) |
| `assets/` | Het verpakte anatomiemodel (650.000 driehoeken, 4,2 MB), gebouwd door `npm run anatomy` |
| `dist/` | De versie in één bestand, gebouwd door `npm run build` |
| `tools/build.mjs` | Maakt `dist/` opnieuw na een wijziging in `src/` |
| `tools/anatomy/` | De pijplijn die het model uit BodyParts3D maakt |
| `.github/workflows/pages.yml` | Bouwt en publiceert de online versie |

## Verder ontwikkelen

Bij elke push naar `main` bouwt GitHub Actions het anatomiemodel en de app, en zet het resultaat op de branch `gh-pages`. Die branch is de online versie. `assets/` en `dist/` staan daarom niet in `main`.

Lokaal werken kan met [Node.js](https://nodejs.org), Python 3 (met `numpy` en `scipy`), git en bash (op Windows: Git Bash of WSL):

```
npm install
npm run anatomy    # maakt assets/ uit BodyParts3D (eenmalig, ongeveer 10 seconden)
npm run build      # maakt dist/X-Ray Body Mirror.html
npm start          # lokale server op http://localhost:5173
```

De losse versie (`index.html` + `src/`) werkt niet via dubbelklikken, omdat browsers geen modules van schijf laden. Gebruik `npm start` of de online versie.

### Het anatomiemodel

`tools/anatomy/build.sh` haalt de verwerkte BodyParts3D 4.0-data op uit [ashemag/human-atlas](https://github.com/ashemag/human-atlas) (vastgezet op één commit) en draait drie stappen:

- `classify.py` verdeelt 2.234 onderdelen over zes lagen.
- `simplify.mjs` vereenvoudigt ze; de verhoudingen per laag staan bovenaan het bestand.
- `rig.py` zoekt de gewrichten in het model, koppelt elk punt aan zijn segmenten en verpakt alles in `assets/`.

## Ideeën voor de volgende stap

- Gezichtstracking erbij voor het hoofd (kaak die meebeweegt, preciezere draaiing), zoals de originele repo.
- Handtracking voor losse vingers.
- Spieren laten oplichten bij een beweging (bv. biceps bij een curl).
- Een staande opstelling: tv in portretstand met de camera erboven.

## Bronnen en licenties

- **Anatomie:** BodyParts3D, © The Database Center for Life Science, CC BY 4.0. Vereenvoudigd en gerigd voor deze app. Zie `ATTRIBUTION.md`.
- **Tracking:** MediaPipe Pose (Google, Apache 2.0).
- **Rendering:** three.js (MIT).

Dit is een visualisatie op basis van één standaard referentielichaam (volwassen man), geen medische scan.

De code heeft nog geen licentie: anderen mogen ze bekijken, maar niet hergebruiken. Voeg een `LICENSE`-bestand toe (bv. MIT) als je dat wel wilt toestaan.
