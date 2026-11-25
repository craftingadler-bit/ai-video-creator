# Aussprache-Liste

Wörter, die die Stimme (OmniVoice, „Jannis englisch“) falsch liest. `kit/lint-script.mjs` warnt vor jeder Aufnahme, wenn eins davon im Script steht.
Neue Einträge kommen aus `check/audio-report.txt` („klingt wie …“), `kit/report.mjs` schlägt sie vor.

Format pro Zeile: `- Wort → was die Stimme draus macht | Tipp`

- Germania → klingt wie "Germany" | nach der Aufnahme im audio-report prüfen, sonst `--redo sN` oder Lautschrift testen (z. B. „Ger-mah-nia“, noch nicht ausprobiert)
