---
name: reel-studio
description: Baut aus einem Satz ein fertiges 9:16-Reel (Script, VoiceStudio-Voiceover, animierte Szenen, Wort-Untertitel, Motion-Check, MP4). Nutzen, wenn der User ein Reel, TikTok oder "Was wäre wenn"-Video will oder Feedback zu einem Reel gibt.
---

# Reel Studio

Ein Satz rein, fertiges Reel raus. Alles läuft lokal: VoiceStudio spricht, Chromium zeichnet, ffmpeg rendert.

Vor dem ersten Reel einer Session lesen: `guides/style.md`, `guides/hooks.md`, `guides/humor.md`, `guides/learnings.md`. **learnings.md hat Vorrang**, dort steht das Feedback des Users.
Vorlage zum Abschauen: `reels/rom-ueberlebt-en/` (neuer, dynamischer Stil).

## Setup ("check my setup")

```
npm run setup          # einmalig: Playwright + Chromium, danach Check
node kit/setup-check.mjs
```
Fehlt etwas, zeigt der Check den Befehl. VoiceStudio-App muss laufen (API auf `http://localhost:3900`).
Die Stimme (`voice_id`) aus der Liste in `config.json` → `voicestudio.voice` eintragen. Nie eine ID erfinden.

## Pipeline

Für jedes Reel einen Ordner `reels/<slug>/` anlegen (slug: kurz, klein, mit Bindestrichen).

### Ein Befehl: `kit/run.mjs` (Standard)
Nach dem Script (Schritt 1) und nach jeder Änderung immer **einen** Befehl statt der Einzelskripte:
```
node kit/run.mjs reels/<slug>            # Entwurf: Stimme → Polish → Audio-Review → Render --draft → Motion-Check
node kit/run.mjs reels/<slug> --final    # finales Render (stoppt vorher, wenn das Audio-Review !! hat)
node kit/run.mjs reels/<slug> --dry      # nur zeigen, was laufen würde und warum
```
- **Caching**: jeder Schritt merkt sich per Hash seine Eingaben (`reels/<slug>/.cache/state.json`) und läuft nur, wenn sich davon was geändert hat. Nur `scenes.html` geändert → Stimme und Audio-Review bleiben, nur Render + Check laufen
- **Stimme pro Absatz**: ändert sich der VO-Text von 1–2 Szenen, spricht `run.mjs` nur die neu (`voice.mjs --redo sN`), sonst das ganze Script am Stück. `--full-voice` erzwingt den ganzen Take. Ändert sich `voice-polish.mjs` oder `config.polish`, läuft nur der Polish neu
- **Frame-Cache beim Render**: Frames, deren sichtbares Bild gleich bleibt, kommen aus `.cache/frames/` statt per Screenshot. Nur Szene 5 umgebaut → nur deren Frames werden neu gezeichnet. Abschalten: `--no-frame-cache`
- Fehlt `scenes.html`, hört `run.mjs` nach der Stimme auf → Szenen bauen (Schritt 3), dann nochmal starten
- Stoppt beim ersten Fehler. Am Ende eine Zusammenfassung (`·` = aus dem Cache, `✔` = gelaufen, `!`/`✘` = anschauen) mit allen `!!` aus dem Motion-Check
- Weitere Schalter: `--only render` / `--from audio` (einzelne Schritte), `--force` bzw. `--force voice,render` (Cache ignorieren), `--fake`, `--takes N`, `--no-asr`, `--keep-going`, `--clean` (Cache des Reels löschen)
- Manuelle Eingriffe (`voice.mjs --redo s7` wegen verschluckter Wörter) bleiben erhalten: `run.mjs` spricht nur neu, wenn sich der Script-Text ändert

Die Abschnitte unten beschreiben, was die einzelnen Schritte machen. Direkt aufrufen nur zum Debuggen.

### 1. Script schreiben → `script.md`
Format (genau so, das Voice-Skript liest es aus):
```
# Titel
hook: <Hook-Formel aus guides/hooks.md>

## s1 Hook
VO: Was wäre, wenn *Deutschland* als Erstes auf dem Mars landet?
BILD: Mars groß, Titel knallt rein

## s2 Der Plan
VO: Start geplant: 2031. Dann 2034. Dann 2038.
BILD: Jahreszahl tickt, VERSCHOBEN-Stempel
```
Regeln:
- 8–14 Szenen, 45–75 s gesamt (~2,7 Wörter pro Sekunde → 130–190 Wörter)
- **s1 ist der Hook, max. 12 Wörter**, Thema ab dem ersten Wort, kein "Hey", kein Intro
- Pro Szene 1–3 kurze Sätze. Eine Szene = ein Bildgedanke. Lange Szenen (>6 s) brauchen 2–3 Bildwechsel
- `*Wort*` markiert Schlagwörter: die bekommen im Untertitel eine farbige Box. Max. 1 pro Satz
- **Pausen setzen**: ` / ` = kurze Pause, ` // ` = lange Pause, `//` am Zeilenanfang = Pause vor der Szene. Regeln dafür in `guides/learnings.md` (Kapitelsprünge, nach der Hook-Frage, vor Pointen, vor dem CTA)
- Zahlen ausschreiben, wie sie gesprochen werden sollen ("zweitausendeinunddreißig" nur wenn die Stimme Zahlen falsch liest, sonst Ziffern)
- Letzte Szene: Pointe + CTA (Frage an die Comments oder "Schick's an …")
- Ton aus `guides/humor.md` (kurz, sarkastisch, Selbstironie, keine Chatbot-Wörter)

**Vor der Aufnahme immer linten** (kostet nichts, keine KI):
```
node kit/lint-script.mjs reels/<slug>      # alle: npm run lint
```
Prüft Format, Wortzahl, geschätzte Länge (±4 s), Hook ≤ 12 Wörter, Satzlänge, Schlagwörter, Pausen mitten im Satz, CTA, verbotene Wörter (`guides/humor.md`), Aussprache-Liste (`guides/pronunciation.md`). Alle `!!` fixen, bevor `voice.mjs` läuft. Das spart Aufnahmen.

Script dem User kurz zeigen (nur die VO-Zeilen) und direkt weitermachen, außer er will vorher drüberschauen.

### 2. Voiceover → `vo.wav`, `timeline.json`, `timeline.js`
```
node kit/voice.mjs reels/<slug>            # mit VoiceStudio
node kit/voice.mjs reels/<slug> --takes 5  # mehr Takes, wenn Wörter verschluckt werden
node kit/voice.mjs reels/<slug> --fake     # ohne Stimme: stumm, Zeiten geschätzt (Layout-Test)
```
Spricht das ganze Script **am Stück** mit Stimme „Jannis 1“ bei **Tempo 1.1, Steps 24** (radikal locker, Standard seit 25.11.). Script im Gesprächston schreiben (siehe `guides/learnings.md`). Pausen-Marken werden zu Gedankenstrichen („Europe. — They…“), Szenenwechsel zu Absätzen, die Pausen macht die Stimme selbst mit natürlicher Satzmelodie. Mitten in Sätzen wird nichts geschnitten (klang abgebrochen). **Danach glättet `kit/voice-polish.mjs`**: leise Wörter anheben, an Szenenwechseln (Satzende, Stimme ist schon unten) die Pause auf ~0,45 s bringen, Pausen in Szenen über 0,75 s auf 0,55 s kürzen, Atem vor Absätzen absenken. Danach Wortzeiten per Transkription und Alignment auf die Script-Wörter. Es werden bis zu `voicestudio.takes` (3) ganze Takes gesprochen, der verständlichste gewinnt (`--takes N`). Bei „Wörter nicht erkannt“ lieber neu sprechen oder umformulieren. `--groups` = Sinngruppen einzeln sprechen und zusammensetzen (nur als Notlösung). `--per-scene` = alter Modus (einzeln, abgehackter).
Die Szenenzeiten in `timeline.json` kommen aus dem Ton. **Animationen immer relativ dazu planen**, nie feste Sekunden.

### 3. Szenen bauen → `scenes.html`
**Vorlage: `reels/rom-ueberlebt-en/scenes.html`** (GSAP, Lottie, Übergänge, Kamera, Figuren mit Mimik). `beispiel-mars` ist der alte, statische Stil – nicht mehr als Vorbild nehmen. Grundgerüst:
```html
<div id="stage"><div class="kick">…</div><div id="world">
  <div class="sc" id="g1"><div class="bg" style="background:…"></div> … </div>   <!-- eine Gruppe pro Szene, mit eigenem Hintergrund -->
</div></div>
<script src="timeline.js"></script>
<script src="../../kit/vendor/gsap-all.js"></script>      <!-- GSAP + alle Plugins -->
<script src="../../kit/vendor/lottie.js"></script>         <!-- nur wenn Lottie genutzt wird -->
<script src="../../kit/lottie/mascot-walk.js"></script>    <!-- je Lottie-Datei -->
<script src="../../kit/runtime.js"></script>
<script src="../../kit/figures.js"></script><script src="../../kit/props.js"></script>
<script> R.scenes([['s1','g1'], ['s2','g2','zoom'], …]); /* Animationen */ R.start(); </script>
```
Fehlt `kit/vendor/`: `node kit/build-vendor.mjs`.
Bühne: 1080×1920 px, absolute Pixel. Safe Zone: x 60–960, y 180–1600. Untertitel macht die Runtime automatisch bei y≈1390 → dort keine wichtigen Inhalte. Visuals in y 250–1250.

Runtime-API (`R`):
| Funktion | Zweck |
|---|---|
| `R.at('s3', 0.4)` / `R.end('s3', -0.3)` | Zeit relativ zu Szenenstart/-ende |
| `R.word('s3', 'Fax')` | Zeitpunkt, an dem das Wort gesprochen wird (für Pointen genau auf das Wort) |
| `R.sceneGroup('g3', 's3')` | Gruppe slidet zum Szenenstart rein, zum Ende raus (`'fade'` als 3. Parameter für Überblendung) |
| `R.pop / R.slam / R.up / R.fadeIn (id, t)` | Einblenden. `slam` = Stempel-Effekt mit Wackler + Sound |
| `R.fadeOut(id, t)`, `R.show(id, t0, t1)` | Ausblenden / ein- und aus |
| `R.move(id, t, d, {x,y,s,r,o})` | Bewegung (Pixel, Grad, Skalierung, Deckkraft) |
| `R.tw(id, t, d, from, to, ease)` | freier Tween, ease: out, in, inout, back, grav, lin |
| `R.type(id, t, d, text)` | Schreibmaschine |
| `R.count(id, t, d, from, to, fmt)` | Zahl zählt hoch |
| `R.draw(id, t, d)` | SVG-Pfad zeichnet sich selbst |
| `R.mouth('mund', ['s2','s5'])` | Mund bewegt sich synchron zur Stimme (optional nur in bestimmten Szenen) |
| `R.during(t, d, (p, now) => …)` | eigene Animation pro Frame (p = 0..1). Wird auch **vor** t aufgerufen (p = 0) → Code muss damit klarkommen |
| `R.shake(t)` | Kamerawackler |
| `R.sfx(t, 'name', vol)` | Sound: zuerst `reels/<slug>/sfx/<name>.wav`, sonst `kit/sfx/` (pop, tick, whoosh, slam, ding, drop, type, fail). pop/slam/Übergänge setzen Sounds automatisch |
| `R.captions({y, size, maxWords, active, box, on})` | Untertitel anpassen |

**Bewegung mit Charakter (GSAP, kit/vendor/gsap-all.js).** Eine pausierte Master-Timeline `R.tl`, Zeit = Videosekunden, wird pro Frame exakt gesucht. Nie `gsap.to()` direkt (läuft in Echtzeit), immer über `R.*`:
| Funktion | Zweck |
|---|---|
| `R.scenes([['s1','g1'], ['s2','g2','zoom'], …], {drift})` | Szenengruppen mit Übergängen + leichte Kamerafahrt pro Szene. Übergänge: `whip zoom push drop spin iris flash cut` – abwechseln! |
| `R.trans(type, 'gA', 'gB', t)` | Übergang innerhalb einer Szene (Unterbilder: Büro → Karte → Kalender) |
| `R.cam(t, d, {x, y, s})` | Kamera: Punkt (x,y) zur Bildmitte, Zoom s (Punch-in auf Pointen, Ranfahren an Gesichter). Bleibt im Bild |
| `R.g / R.gfrom / R.gfromTo / R.gset (id, vars, t)` | freie GSAP-Tweens (alle Eases: `back.out(2)`, `elastic.out(1,.3)`, `bounce.out`, `power3.in` …) |
| `R.hide(id)` | ab Start unsichtbar (für GSAP-Elemente, die später reinkommen) |
| `R.popIn(id, t, {r})` | Reinploppen mit Überschwinger + Drehung |
| `R.dropIn(id, t)` | fällt von oben, landet mit Squash & Stretch |
| `R.squash(id, t)` / `R.wiggle(id, t, {a, n, prop})` / `R.bob(id, t0, t1)` | Stauchen (Landen, Lachen) / Wackeln (Schock) / Wippen, Atmen |
| `R.chars(id, t)` | Text Buchstabe für Buchstabe (SplitText) |
| `R.morph(id, t, d, shape)` / `R.path(id, t, d, pathId)` | Form verwandeln (MorphSVG) / Objekt fliegt auf Pfad (MotionPath) |
| physics2D: `R.g(id, {physics2D:{velocity, angle, gravity}, rotation}, t)` | Konfetti, wegfliegende Laptops, Schweißtropfen |

**Lottie** (fertige Vektor-Animationen, z. B. Figuren, die laufen und zeigen): JSON nach `kit/lottie/<name>.json`, `node kit/build-vendor.mjs`, dann `const a = R.lottie('containerId', '<name>', {})` und `a.play(t, vonFrame, bisFrame, {speed, loop})`. Marker der Datei stehen in `a.markers`. Container ist ein `<div>` in Komposition-Größe. Quellen + Lizenzen in `kit/lottie/QUELLEN.md` eintragen (LottieFiles: Lizenz pro Datei prüfen).

**Requisiten** (`kit/props.js`): Kuh, Säule, Tempel, Lorbeer, Bäume, Wolken, Römerhelm, Bart, Laptop, Uhr, Daumen, Pferd/Streitwagen, Schweiß, Herz. Neue gut gezeichnete Requisiten dort ergänzen statt im Reel.

**GSAP-Wissen:** Skills `gsap-core`, `gsap-timeline`, `gsap-plugins`, `gsap-utils`, `gsap-performance` in `.claude/skills/` (offiziell von GreenSock).

Regeln für Szenen:
- **Ein Element entweder per `R.tw/R.pop/R.slam` ODER per GSAP bewegen**, nie beides (sonst Warnung). Notfalls in zwei verschachtelte `<g>` packen
- **Jede Szene hat eine eigene Umgebung** (Hintergrund in 2–3 Ebenen) und mindestens eine Figur oder ein Objekt, das reagiert (Mimik per `FIG.mood`, Squash, Wackeln)
- **Szenenwechsel nie als reines Slide**: `R.scenes` mit wechselnden Übergängen, dazu 1–2 Kamera-Punch-ins pro Reel auf die besten Pointen
- **Lange Szenen (>5 s) in 2–3 Unterbilder teilen** (eigene `.sc`-Gruppen + `R.trans`)
- **Alle 2–4 s ändert sich sichtbar etwas** (neues Element, Bewegung, Zoom, Szenenwechsel)
- Zahlen bekommen ein eigenes großes Element (Zähler, Scoreboard, Stempel)
- Pointen landen per `R.word(...)` exakt auf dem gesprochenen Wort, gern mit `slam`
- Dauerbewegung (Blinzeln, Wippen, Lüfter) per CSS-Animation, Choreografie per `R`
- Elemente, die per `R` bewegt werden, dürfen kein eigenes `transform`-Attribut haben → in eine `<g id>` ohne transform packen
- Figuren: einfache Flat-SVG (Kopf, Körper, Mund als eigenes Element mit id für `R.mouth`). Wiederkehrende Figuren in `guides/style.md` → "Figuren"
- Emojis gehen als Text, wirken aber billig. Lieber eigene SVG-Formen

Karten: **immer** `kit/map.js` mit echten Ländergrenzen (siehe Kopfkommentar dort). Einbinden nach runtime.js: `geo-lib.js`, `geo-data-50m.js` (10m für starke Zooms), `map.js`. API: `MAP.create(svgId, {box, projection, view})`, `m.view(t, d, {center, zoom})`, `m.fill(länder, t, farbe, d, stagger)`, `m.route(id, [[lon,lat], …], t, d, {head})`, `m.pin(id, [lon,lat])`, `m.circle(...)`.

Einzelbilder ohne Rendern (schnell zum Prüfen): `node kit/shot.mjs reels/<slug> 3.2 8 15` → `check/shots.png`.

Vorschau im Browser: `reels/<slug>/scenes.html` öffnen (mit Ton, Klick = Play, Balken = Spulen, `?t=12` springt zu Sekunde 12).

### 3b. Sounddesign mit earshot → `reels/<slug>/sfx/`
Jedes Reel bekommt eigene, passende Geräusche statt der 8 Standard-Sounds. earshot rechnet sie lokal (kein Modell, kein Key), Skill: `.claude/skills/earshot`.
```
EARSHOT_OFFLINE=1 .venv-earshot/bin/earshot make --spec reels/<slug>/sfx/spec.json -o reels/<slug>/sfx
EARSHOT_OFFLINE=1 .venv-earshot/bin/earshot make "a cow mooing" -o reels/<slug>/sfx/moo.wav    # einzeln
EARSHOT_OFFLINE=1 .venv-earshot/bin/earshot sounds --search "WORTE"                             # Katalog durchsuchen
```
- `spec.json`: `{"sounds": [{"name": "moo", "want": "a cow mooing"}, …]}`. Englisch, das Ding zuerst benennen („a rubber stamp slammed on paper“)
- Ein Sound mit Standard-Namen (`whoosh`, `pop`, `slam`, `drop`, `type`, `fail`) ersetzt im Reel automatisch den Kit-Sound → Übergänge und Stempel klingen sofort besser
- **Antwort lesen**: `earshot makes no X` oder `the pick is a guess` = Platzhalter → mit `--sound ID` was Passendes nehmen oder weglassen. Nie einen Platzhalter als das Ding verkaufen
- Pro Szene: 1 Hintergrund-Atmo (Vögel, Café, Menge, vol 2–2,5) + die Geräusche der Dinge, die man sieht (Kuh muht, Hufe, Buhrufe, Uhr tickt), Lautstärke über `vol` (1–2)
- Ich kann nicht hören: Pegel nur messen (Mix vs. Stimme pro Abschnitt), der User hört final drüber
- Einrichten (einmalig, ~280 MB): `uv venv --python 3.12 .venv-earshot && VIRTUAL_ENV=.venv-earshot uv pip install "earshot @ git+https://github.com/Leonxlnx/earshot@7a7f7c5c70d4a763a1eca4b3666af7c77e313f97"`. Die Hör-Modelle (1,1 GB) bleiben aus, deshalb `EARSHOT_OFFLINE=1`

### 4. Entwurf + Motion-Check
```
node kit/run.mjs reels/<slug>                # macht Render --draft + Check (und Stimme/Audio-Review, falls nötig)
# einzeln: node kit/render.mjs reels/<slug> --draft  ·  node kit/check.mjs reels/<slug>
```
Dann **die Bilder wirklich anschauen** (`check/hook.png`, `check/sheet_*.png`) und prüfen:
- Hook: steht in den ersten 1,5 s eine klare, große Aussage im Bild?
- Überlappt etwas die Untertitel oder ragt aus der Safe Zone?
- Gibt es Strecken ohne Bewegung (gleiche Bilder in 3+ Kacheln hintereinander)?
- Sind Gags/Schilder lesbar (Schrift ≥ 34 px)?
- Passt das Bild zum gesprochenen Satz?
Alles mit `!!` in `check/report.txt` beheben. Fixen, neu rendern, nochmal checken. Max. 3 Runden, dann dem User zeigen.

### 4b. Audio-Review (Pflicht, siehe `guides/audio-review.md`)
```
node kit/audio-review.mjs reels/<slug>          # Stimme + Sounds messen → check/audio-report.txt, check/edges.png
node kit/audio-qa.mjs reels/<slug>              # nur Schnitte/Störgeräusche + Video-QA (läuft im Audio-Review mit)
node kit/voice.mjs reels/<slug> --redo s7       # einen Absatz neu sprechen (verschluckte/verlesene Wörter)
node kit/voice-polish.mjs reels/<slug>          # Pegel + Pausen neu (läuft nach voice.mjs automatisch)
```
- `voice.mjs` bearbeitet die Stimme automatisch nach (`kit/voice-polish.mjs`): Absatz-Einsätze aus dem Pegel lesen (Whisper ist dort oft zu spät), digitale Stille durch Raumton ersetzen, leise Wörter anheben (kein Ein-/Ausblend-Effekt), Atem/Geräusche vor Absätzen und am Anfang auf Raumton absenken (nur durch echte Stille getrennte Blöcke, Wortanfang wird nie angefasst), Pausen an Szenenwechseln auf ~0,45 s (0,38–0,62), Pausen in Szenen über 0,75 s auf 0,55 s kürzen. Geschnitten wird nur in Stille mit ≥ 40 ms Abstand zur Sprache, eingesetzt wird Raumton, jeder Schnitt hat 20 ms Crossfade (`polish.xfade` in config.json, 15–40 ms). Rohfassung bleibt in `audio/vo_raw.wav`
- Genauere Wortzeiten (optional): `pip install stable-ts` (oder `whisperx`), dann nutzt voice-polish automatisch Forced Alignment (`kit/align.py`, Ergebnis gecacht in `audio/timeline_aligned.json`). Ohne Paket bleibt alles wie gehabt. Abschalten: `"polish": { "align": "off" }`
- Sounds mischt `render.mjs` nach festen Regeln (`kit/sfx-mix.mjs`): Effekte 0,5 s (mit `len` höchstens 0,8 s), über Sprache mind. 15 dB unter der Stimme, in Sprechpausen mind. 12 dB, Atmo −24 dB, nie zwei Sounds in 0,3 s. Sounds NACH der Pointe setzen (`WE(szene, wort)` = Wortende)
- **Alle Sounds stehen in einer Liste** (`const SND = [...]` am Ende von `scenes.html`) mit Begründung pro Sound, `R.autoSfx(false)` schaltet die Helfer-Sounds ab. Ziel ~12–15 Effekte pro Minute, derselbe Sound höchstens 2–3×
- Dann **4 Prüfer-Subagenten** (Mix, Cutter, Dialog, Endabnahme) laufen lassen, bis alle ≥ 7/10. Prompts in `guides/audio-review.md`

### 5. Finale
```
node kit/run.mjs reels/<slug> --final
node kit/report.mjs reels/<slug>            # liest check + audio-review aus run.mjs ein, dazu Script-Lint → Ampel
```
`check/report.html` = eine Seite mit Ampel (Länge, Bildwechsel-Takt, Lautheit, Motion-Check, Audio-Review, Script-Lint), Zeitleiste und allen Befunden mit Zeitstempel. Klick springt im Video hin. Für mich: **`check/quality.json` lesen statt alle Einzelreports**, dann nur die Kontaktbögen zu den gemeldeten Zeitstempeln anschauen. Schlägt der Report neue Einträge für `guides/pronunciation.md` vor, eintragen. Ohne `--run` liest der Report nur ein, was schon da ist (z. B. nach `--draft`).
Dem User melden: Pfad zur MP4, Länge, was der Check sagt, was du nicht prüfen konntest (z. B. wie die Stimme klingt). Ehrlich bleiben, nichts als geprüft verkaufen, was nicht geprüft wurde.

### 6. Feedback ("mach den Hook knackiger")
Feedback wie ein Editor umsetzen: nur das Genannte ändern (script.md und/oder scenes.html), dann `node kit/run.mjs reels/<slug>`. Der Cache sorgt dafür, dass nur die geänderten Absätze neu gesprochen und nur die geänderten Frames neu gerendert werden. Wenn das Feedback eine allgemeine Regel ist ("immer kürzere Sätze"), in `guides/learnings.md` eintragen. Davon lebt das System.

## VoiceStudio direkt (MCP)
`.mcp.json` verbindet den VoiceStudio-MCP-Server (`http://localhost:3900/mcp`): Tools `list_voices`, `generate_speech`, `clone_voice`, `design_voice`, `transcribe`. Für die Pipeline das Skript nutzen; MCP für Einzelsachen (Stimme designen, testen). Nur Stimmen klonen, die der User nutzen darf.

## Fehler
- VoiceStudio nicht erreichbar → App starten, `node kit/setup-check.mjs`
- 401/403 → `apiKey` in config.json, nie Auth abschalten
- Modell fehlt → User fragen, bevor etwas heruntergeladen wird
- `scenes.html` Fehler → render.mjs zeigt "Fehler in scenes.html"; im Browser die Konsole prüfen
