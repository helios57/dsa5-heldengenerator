# DSA5 Heldengenerator

Ein Heldengenerator für **Das Schwarze Auge 5** — reines Frontend, kein Backend,
keine Laufzeitabhängigkeiten. Führt Schritt für Schritt durch die offizielle
Heldenerschaffung, rechnet alles mit und erklärt dabei die Regeln.

## Warum

Das offizielle *Heldendokument V2.13* ist ein PDF-Formular mit 5.970 Feldern. Es
rechnet zwar selbst, sagt aber nie, **warum** ein Wert nicht weiter steigt oder
welche Grenze gerade greift. Genau das macht dieses Werkzeug sichtbar.

## Funktionsumfang

- **Assistent** in zwölf Schritten, in der Reihenfolge des Regelwerks
- **Vollständiger Datenbestand**: 46 Spezies, 56 Kulturen, 951 Professionen,
  61 Talente, 856 Zauber, 349 Liturgien, 2.323 Sonderfertigkeiten, 3.308 Gegenstände
- **Regeln im Klartext** an jeder Wahl, samt Voraussetzungen und Kostenvorschau
- **Grenzen mit Begründung** — „begrenzt durch KL 13 +2" statt nur einer Zahl
- **Import und Export**: eigenes JSON-Format und das offizielle Heldendokument-PDF
- **Druck**: gefülltes Originalblatt oder kompakte Spieltischansicht

## Datenherkunft

Der gesamte Regeldatenbestand wird maschinell aus dem offiziellen PDF gewonnen:
797 eingebettete Acrobat-JavaScript-Funktionen werden extrahiert, ausgeführt und
als JSON abgelegt. Die Regelgrenzen sind zusätzlich gegen das
[Ulisses Regel-Wiki](https://dsa.ulisses-regelwiki.de/) belegt — siehe die
Quellentabelle in der [Spezifikation](docs/superpowers/specs/2026-08-19-dsa5-heldengenerator-design.md).

*Das Schwarze Auge* ist eine Marke der Ulisses Spiele GmbH. Dieses Projekt ist
ein inoffizielles Hilfsmittel ohne Verbindung zum Verlag.

## Entwicklung

```bash
npm install
npm run build:data   # einmalig: Datensätze aus dem PDF erzeugen
npm run dev          # übersetzen und unter http://localhost:8173 ausliefern
npm test             # Playwright: Einheiten- und Browsertests
npm run typecheck    # tsc --noEmit
```

Ausgeliefert wird ausschließlich `app/` — statische Dateien, sonst nichts.
