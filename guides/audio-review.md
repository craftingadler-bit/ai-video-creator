# Audio-Review (Pflicht vor jedem fertigen Reel)

Feedback vom 24.11.: Sounds waren zu laut und zu lang, an Szenenwechseln wurden Wörter verschluckt, Absätze klangen wie ein- und ausgeblendet. Deshalb läuft vor jeder Abgabe dieser Ablauf, **so oft, bis alle vier Prüfer mindestens 7/10 geben** (max. 4 Runden, danach dem User ehrlich sagen, was offen ist).

## Ablauf pro Runde
1. `node kit/render.mjs reels/<slug>` (mischt Sounds nach `kit/sfx-mix.mjs`)
2. `node kit/check.mjs reels/<slug>` und `node kit/audio-review.mjs reels/<slug>` → `check/audio-report.txt`, `check/edges.png`
3. Alle `!!` aus dem Bericht beheben, bevor die Prüfer starten (verschluckte Wörter: `node kit/voice.mjs reels/<slug> --redo sN`)
4. **4 Subagenten parallel** (Agent-Tool, `general-purpose`), Prompts unten. Jeder liest nur, ändert nichts
5. Alle „MUSS“-Punkte umsetzen, zurück zu 1. Fertig, wenn alle 4 ≥ 7/10

Die Prüfer hören nicht. Sie urteilen nach Messwerten, Wellenform und Sound-Liste. Das dem User so sagen, und dass er final selbst drüberhört.

## Gemeinsamer Kopf für alle Prompts
```
Du bist strenger Prüfer für die Tonspur eines Kurzvideos (9:16, Reels/TikTok, englisches Voiceover). Du kannst nicht hören:
urteile nur nach Messwerten, Code und Listen. Ändere KEINE Dateien. Projekt: /Users/jannis.hardt/Documents/AI-Video-Editor, Reel: reels/<slug>.
Regeln des Users: guides/learnings.md. Bewerte 1–10 (7 = gut genug zum Veröffentlichen), streng aber fair.
Antworte genau so: SCORE: x/10 · BEGRÜNDUNG (2–3 Sätze) · MUSS GEÄNDERT WERDEN (nur bei < 7, max. 5, konkret mit Zeit/Name/Wert) · KANN (max. 3)
```

## Rollen
1. **Mix-Engineer**: Pegel, Länge, Dichte der Effekte gegenüber der Stimme. Liest `check/audio-report.txt`, `kit/sfx-mix.mjs`, Sound-Liste in `scenes.html`. Richtwerte = `kit/sfx-mix.mjs`: Effekte über Sprache ≥ 15 dB, in Pausen ≥ 12 dB unter der Stimme, 0,1–0,5 s (max. 0,8), Atmo ≥ 24 dB darunter, ~12–15 Effekte/Minute
2. **Kritischer Cutter**: Ist jeder Sound nötig? Trägt er einen sichtbaren Moment/Gag? Wiederholungen nutzen ab? Liest Bericht, `script.md`, Sound-Liste
3. **Dialog-Editor**: verschluckte Wörter, Pausen an Absätzen (0,38–0,7 s), in Szenen ≤ 0,75 s, leiser Einstieg/Ausklang (unter −9 dB wirkt wie Fade), Atmer. Liest Bericht (Stimme, Szenenwechsel), `check/edges.png`, `kit/voice-polish.mjs`
4. **Endabnahme**: Prüft das aktuelle User-Feedback Punkt für Punkt (erfüllt/teilweise/nicht + Zahl aus dem Bericht). Liest alles oben + `check/report.txt`

Bei neuem Feedback des Users: Feedback-Text in die Prompts von Rolle 4 (und der passenden Rolle) aufnehmen.

## Offene Pflicht-Checks (Feedback 24.11., noch nicht im Messskript)
- Jeder Schnitt der Nachbearbeitung (Pausen, `--redo`) darf nicht hörbar sein: kein Abhacken, kein Klick, kein Fade-in
- Erste Sekunde und letzte Sekunde der Tonspur auf Geräusche prüfen
- Dialog-Editor und Endabnahme bekommen diese Punkte als eigene Checkliste
