# AI Video Editor

Dieser Ordner ist ein Reel-Studio. Bei jedem Wunsch nach einem Reel/Video/TikTok: zuerst `SKILL.md` lesen und der Pipeline folgen.

- "check my setup" → `node kit/setup-check.mjs` (bei fehlenden Paketen vorher `npm run setup`)
- Fertige Reels liegen in `reels/<slug>/<slug>.mp4`
- Neue Szenen mit den Bausteinen aus `kit/blocks.js` bauen (Vorlage `reels/_vorlage/`)
- Feedback zum Video: `node kit/review.mjs reels/<slug>`, Ergebnis liegt in `reels/<slug>/review.md`
- Allgemeines Feedback des Users als Regel in `guides/learnings.md` festhalten

Ton im Chat: kurz, locker, wie ein Student. Kein Chatbot-Sprech.
