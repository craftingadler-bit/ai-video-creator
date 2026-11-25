# Style-Guide

Abgeleitet aus 6 Referenzvideos (Basketball-Analyse, Golfstaaten ×2, Boeing, Papa schläft ein, Claude-Code-Tutorial).

## Formel
- **60–75 s**, 9:16, Voiceover trägt die Story, Bild illustriert jeden Satz
- **Hook in Sekunde 0–2**: großer Titel im Bild + erstes gesprochenes Wort ist schon Thema
- **Alle ~3 s ein neues Bild** (Szenenwechsel, Zoom, neues Element). Bei 70 s ≈ 23 Bildideen
- **Zahlen = eigener Screen**: groß, zentriert, gern Zähler oder Stempel
- **Untertitel Wort für Wort**, 1–3 Wörter, unteres Drittel, gesprochenes Wort gelb, Schlagwort in roter Box
- **Laufender Titel oben** (optional): die "Was wäre wenn"-Frage bleibt das ganze Video stehen
- **Lautheit −14 LUFS**, keine Pausen > 0,7 s
- **Ende**: Pointe + CTA ("Welches Klischee fehlt?", "Schick's an deinen Ausbilder")

## Menschlich statt Infografik (wichtigste Regel)
- **Eine Hauptfigur trägt die Story** (Ich-/Du-Perspektive). Sie hat Gesicht, Augenbrauen, Mund, Hände und reagiert: erschrocken, genervt, zufrieden, müde
- **Jede Szene spielt irgendwo**: Raum mit Fenster und Skyline, Labor, Büro, Straße, Sumpf bei Sonnenuntergang. Hintergrund in 2–3 Ebenen (fern, mittel, nah), weiche Lichtkegel/Glow für Stimmung, Boden mit Schatten unter Figuren
- **Close-up-Reaktionen** (Kopf füllt halben Screen) als Bildwechsel zwischen Erklärszenen
- **Requisiten statt Schilder**: Fernbedienung, Handy, Kaffeebecher, Antrag; Text im Bild nur als Label oder große Zahl
- **Kamera**: `R.scenes` fährt pro Szene leicht, dazu Punch-ins (`R.cam`) auf Pointen und Gesichter. Nie komplett statisch
- **Cartoon-Physik**: Dinge fallen und landen mit Squash (`R.dropIn`), Figuren wackeln vor Schreck (`R.wiggle`), springen vor Freude (Sprung + `R.squash`), Konfetti/Tropfen/Laptops fliegen mit `physics2D`
- **Gags in Bewegung statt in Text**: Bart wächst während der Verspätung, Tempel kippt und richtet sich trotzig auf, Schild dreht sich um, Kühe regnen vom Himmel
- Infografik-Screens (Zahl, Diagramm, Karte) bewusst dazwischen, dann in dunklem „Blueprint"-Look mit feinen Linien

## Karten
- Immer `kit/map.js` (echte Grenzen). Nie Länder als Blobs zeichnen
- Kamera fährt auf das Gebiet, Länder färben sich exakt auf das gesprochene Wort, Routen als Großkreis-Bogen mit Kopf (Figur/Flugzeug)
- Labels als Pins (`m.pin`), Schrift ≥ 34 px. Fakten prüfen: welche Länder gehören wirklich dazu?

## Story-Muster (eins wählen)
1. **Absurde Prämisse, todernst erklärt** (Boeing-Video): Fakten, Infografiken, Warnschilder. Gags stecken in UI (Abflugtafel: "YOUR ASS – CANCELLED")
2. **Zeitsprung** (Papa-Video): Tag 1 → Woche 1 → Monat 1 → Jahr 1, jede Stufe eskaliert
3. **Mythos → Twist** (Golfstaaten): "Die übliche Antwort ist … Stimmt aber nur halb."
4. **Schritte** (Tutorial): "6 Steps", Roadmap am Anfang, Häkchen am Ende

## Look (Standard: "Dämmerung Flat")
- Hintergrund dunkel-lila Verlauf `#1B1530 → #3A2350`, Akzente Orange `#FF7A3D`, Gelb `#FFD23F`, Rot `#FF4D2E`, Hellblau `#7FD3FF`
- Flat-SVG, keine Verläufe auf Figuren, runde Ecken, dicke Konturen nur bei UI-Elementen
- Schrift: Poppins 800/900 für Headlines, Untertitel 66 px
- Alternativ "Papier hell" (Tutorial-Look): Hintergrund `#F2EFE9`, Text `#1D1B2F`, Akzent Rot `#E8402A`, Serif-Kursiv für Schlüsselwörter

## Figuren
- **Der Student** (Hauptfigur): runder Kopf, schwarze Haare, Hoodie Orange `#FF7A3D`, Mund als eigene Ellipse (`R.mouth`). Leicht müde Augen (Augenringe). Darf Kaffee halten
- **Schwarzkopf-Figur** (Boeing-Stil): schwarzer Kreis-Kopf, weiße Augen, Gesicht reagiert groß im Close-up (Schock, Augenrollen)
- Reaktions-Close-ups (Kopf füllt halben Screen) sind gute Bildwechsel zwischen Infografiken

## Bildwechsel-Werkzeugkasten
Slide-Szenenwechsel · Zoom auf Detail · Stempel (VERSCHOBEN, ABGELEHNT) · Zähler · Fortschrittsbalken · Formular/Antrag · Chatfenster · Abflug-/Anzeigetafel · Benachrichtigung · Vorher/Nachher-Split · Karte mit Pfeil · Close-up-Reaktion · Checkliste mit Häkchen
