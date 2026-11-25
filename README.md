# AI Video Editor

Ein Satz rein, fertiges Reel raus. Lokal mit Claude Code + VoiceStudio.

## Einrichten (einmalig)
1. Ordner irgendwohin legen, z. B. auf den Desktop
2. Installieren: **Node.js 20+** (nodejs.org) und **ffmpeg**
   - Mac: `brew install ffmpeg`
   - Windows: `winget install --id Gyan.FFmpeg`
3. **VoiceStudio** starten (die lokale API läuft auf `http://localhost:3900`)
4. Claude-Code-Desktop-App → neue Session → **Local** → diesen Ordner wählen
5. Eintippen: **check my setup**
   Claude installiert Playwright und Chromium, prüft alles und zeigt deine Stimmen. Die gewünschte `voice_id` kommt in `config.json`.

## Benutzen
Eintippen: **Mach ein Reel: Was wäre, wenn die Bahn pünktlich wäre?**
Claude schreibt das Script, lässt VoiceStudio sprechen, animiert, prüft und rendert.
Ergebnis: `reels/<name>/<name>.mp4`

Selbst starten geht auch, ein Befehl für alles (spricht/rendert nur, was sich geändert hat):
`node kit/run.mjs reels/<name>` (Entwurf) bzw. `node kit/run.mjs reels/<name> --final`

Danach Feedback wie an einen Editor: „Hook knackiger“, „Gag bei 0:20 zündet nicht“, „langsamer sprechen“.

## Ordner
- `SKILL.md` – die Pipeline (liest Claude)
- `guides/` – Style, Hooks, Humor, Learnings (wächst mit deinem Feedback)
- `kit/` – Skripte: run (alles am Stück), voice, render, check, runtime
- `reels/beispiel-mars/` – Beispiel zum Abschauen (Ton ist noch ein stummer Platzhalter)

Vorschau eines Reels: `reels/<name>/scenes.html` im Browser öffnen.
