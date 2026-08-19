# DSA5 Heldengenerator — Design

**Datum:** 2026-08-19
**Status:** Entwurf zur Freigabe

## 1. Ziel

Eine reine Frontend-Website, die einen DSA5-Helden per Assistent (Wizard) erzeugt.
Sie ersetzt das offizielle *Heldendokument V2.13* als Eingabeoberfläche, bleibt aber
vollständig kompatibel: Import und Export des offiziellen PDFs, dazu ein eigenes
JSON-Format. Kein Backend, keine Laufzeit-Abhängigkeiten, kein Build-Schritt.

### Nicht-Ziele

- Kein Kampf-, Abenteuer- oder Gruppenmanagement. Nur Heldenerschaffung und -pflege.
- Keine Steigerung im Spiel jenseits der Abbildung vorhandener AP.
- Keine Übersetzung der Regeldaten. Alle Inhalte bleiben deutsch.
- Kein Nachbau der Tier-/Vertrautenseiten in der ersten Fassung.

## 2. Quelle der Regeldaten

Das mitgelieferte PDF (`423187-Charakterbogen_V2_13_…korr_V2.pdf`, 10,8 MB) ist ein
AcroForm mit 5.970 Feldern und rund 18 MB eingebettetem Acrobat-JavaScript
(797 Funktionen). Dieses JavaScript enthält den vollständigen DSA5-Datenbestand.
Verifiziert durch Ausführung der Funktionen in Node:

| Datensatz | Anzahl | Datensatz | Anzahl |
|---|---:|---|---:|
| Spezies | 46 | Zauber | 856 |
| Kulturen | 56 | Liturgien | 349 |
| Professionen | 951 | Segnungen | 11 |
| Talente | 61 | Zaubertricks | 118 |
| Kampftechniken | 22 | Sonderfertigkeiten (allg.) | 611 |
| Vorteile | 234 | Sonderfertigkeiten (Kampf) | 356 |
| Nachteile | 161 | Sonderfertigkeiten (magisch) | 880 |
| Sprachen | 101 | Sonderfertigkeiten (karmal) | 476 |
| Traditionen | 61 | Ausrüstung | 3.308 |
| Rüstungen | 162 | Waffen (nah / fern) | 761 / 146 |

Die Daten liegen als `*GetInfo(id, feld)`-Funktionen vor — reine Nachschlagefunktionen
über `switch`-Blöcke. Sie sind maschinell auslesbar.

**Die Regeltexte liegen mit.** Jeder Eintrag führt ein Feld `Regel` mit dem
ausformulierten Regeltext samt Voraussetzungen, etwa bei *Adel I*:

> „Regel: Der Held ist angesehen, genießt die Privilegien des Adels und kann von der
> Meisterin Erleichterungen zugesprochen bekommen … Voraussetzung: Kultur muss über
> einen passenden Adel verfügen."

Damit sind die Regelkarten aus Abschnitt 6 kein Schreibprojekt, sondern eine
Datenabfrage. Das ist der entscheidende Hebel für die Aufgabe „alle interessanten
Regeln und Informationen anzeigen".

**Kodierung:** Die JS-Streams sind gemischt kodiert (383 UTF-8, 373 CP1252, 41 Rest).
Die Extraktion muss pro Stream erkennen, sonst zerfallen Umlaute.

## 3. Getroffene Entscheidungen

| Frage | Entscheidung | Begründung |
|---|---|---|
| Regelumfang | Vollständig, alle Werke | Extraktion ist automatisiert, der Aufwand liegt in der UI |
| Sprache/Technik | TypeScript, streng typisiert, kein Framework, kein Bundler | Typen erzwingen die Regeln an der Schnittstelle |
| Abhängigkeiten | Null zur Laufzeit; TypeScript und Playwright nur zur Entwicklung | Ausgeliefert werden statische Dateien, kein Backend |
| Sprache | Deutsch | Datenbestand ist deutsch, Namen bleiben kanonisch |
| PDF-Kompatibilität | Offizielles Formular füllen | Höchste Treue, bleibt in Acrobat selbstrechnend |
| Druck | Offizielles Blatt **plus** kompakte Druckansicht | Offiziell fürs Archiv, kompakt für den Spieltisch |
| Regelstrenge | Harte Sperre mit Schalter „Regeln lockern“ | Ehrliche Voreinstellung, Hausregeln bleiben möglich |
| Vorlage-PDF | Im Projekt mitgeliefert | Offline-Export ohne Zusatzschritt; Dateiauswahl als Rückfall |
| Einstieg | Archetyp-Vorauswahl plus Suche | 951 Professionen sind ohne Vorfilter unbenutzbar |

## 4. Architektur

Zwei Hälften. Nur die zweite wird ausgeliefert.

### 4.1 Erzeugungszeit (nur Entwicklung, Node)

```
tools/
  pdf-js-extract.ts  PDF -> build/js/*.js   (797 Funktionen, Kodierung pro Stream)
  acrobat-shim.ts    Acrobat-Ersatzumgebung zum Ausführen der Funktionen
  build-data.ts      build/js/*.js -> app/data/*.json
  build-fieldmap.ts  PDF -> app/data/fieldmap.json (Feld -> Widgets, DA, Rect, Q, Ff)
```

Die Ausgaben werden eingecheckt. Die Datensätze müssen also nie neu erzeugt werden;
für die Website genügt `tsc`.

### 4.2 Laufzeit (Browser, TypeScript, ohne Laufzeitabhängigkeiten)

Eine Quellbaum in TypeScript. Node 24 führt `.ts` unmittelbar aus (Type Stripping),
weshalb Werkzeuge und Tests dieselben Quellen ohne Übersetzungsschritt nutzen;
`tsc` übersetzt denselben Baum nach `app/js/` für den Browser.

```
src/
  core/           Regelkern — reine Funktionen, kein DOM
    types.ts        gemeinsame Domänentypen
    experience.ts   Erfahrungsgradtabelle
    costs.ts        AP-Formeln
    derived.ts      LE/AE/KE/SK/ZK/AW/INI/GS
    limits.ts       Erschaffungsgrenzen und Prüfungen
    character.ts    Datenmodell
  data/loader.ts    träges Nachladen je Kategorie
  state/            Store, Undo/Redo, Autosicherung (localStorage)
  ui/wizard/        ein Modul je Schritt
  io/
    pdf-lexer.ts    PDF-Wertemodell, Tokenizer, Filter
    pdf-document.ts XRef, Objektströme, Auflösung
    pdf-acroform.ts Feldbaum und Widgets
    pdf-writer.ts   inkrementelle Aktualisierung + Appearance-Streams
    fieldmap.ts     Charakter <-> PDF-Feldnamen
    json.ts         eigenes Format v1
app/
  index.html
  css/              Designsystem: Tokens, Layout, Komponenten, print.css
  js/               Übersetzungsergebnis aus src/
  data/*.json       erzeugt, eingecheckt
  assets/heldendokument.pdf
```

Die PDF-Module sind browserfähig geschrieben und nutzen nur Web-Standard-APIs
(`Uint8Array`, `TextDecoder`, `DecompressionStream`). Genau deshalb können die
Erzeugungswerkzeuge dieselben Dateien einbinden, statt einen zweiten Parser zu pflegen.

Der Regelkern kennt kein DOM. Das macht die Rechnung eigenständig prüfbar und hält
die Oberfläche dumm.

## 5. Regelkern

Alle Angaben belegt. Quellen in Abschnitt 12.

### 5.1 Erfahrungsgrade

Der Erfahrungsgrad legt das AP-Budget **und sämtliche Höchstwerte der Erschaffung**
fest. Tabelle wortgetreu aus dem Regel-Wiki, Spaltenüberschriften im Original:

| Erfahrungsgrad | AP-Konto | Höchstwert Eigenschaft | Höchstwert Fertigkeit | Höchstwert Kampftechnik | maximale Eigenschaftspunkte | max. Zahl Zauber/Liturgien (davon Fremdzauber) |
|---|---:|---:|---:|---:|---:|---|
| Unerfahren | 900 | 12 | 10 | 8 | 95 | 8 (0) |
| Durchschnittlich | 1.000 | 13 | 10 | 10 | 98 | 10 (1) |
| Erfahren | 1.100 | 14 | 10 | 12 | 100 | 12 (2) |
| Kompetent | 1.200 | 15 | 13 | 14 | 102 | 14 (3) |
| Meisterlich | 1.400 | 16 | 16 | 16 | 105 | 16 (4) |
| Brillant | 1.700 | 17 | 19 | 18 | 109 | 18 (5) |
| Legendär | 2.100 | 18 | 20 | 20 | 114 | 20 (6) |

Die letzte Spalte ist eine **Anzahl**, kein Fertigkeitswert. Zauber und Liturgien aus
der Profession sind automatisch aktiviert und zählen auf diese Anzahl an.

**Die Grenzen gelten ausschließlich bei der Erschaffung.** Nach Spielbeginn entfallen
sie („Eigenschaften sind nach Spielbeginn nicht mehr begrenzt"). Für importierte,
bereits bespielte Helden dürfen sie daher nicht erzwungen werden — der Assistent
unterscheidet zwischen *Erschaffung* und *Bearbeitung*.

### 5.2 Zwei unabhängige Obergrenzen

Bei Fertigkeiten, Kampftechniken, Zaubern und Liturgien greifen **zwei Schranken
gleichzeitig**. Es gilt die jeweils niedrigere:

```
Fertigkeit   <= min( höchste an der Probe beteiligte Eigenschaft + 2 , Höchstwert Fertigkeit )
Kampftechnik <= min( zugehörige Leiteigenschaft + 2                  , Höchstwert Kampftechnik )
Zauber/Lit.  <= min( höchste Probe-Eigenschaft + 2 , Höchstwert Fertigkeit , 14 )
```

Der Höchstwert Fertigkeit gilt für Zauber und Liturgien gleichermaßen; sie nutzen
dieselbe Steigerungstabelle. Die `+2`-Regel ist keine Erschaffungsregel, sondern gilt
dauerhaft, und deckt sich exakt mit `MaxTalentWert` und `MaxKampfWert` im
PDF-JavaScript — unabhängig bestätigt.

Die Schranke 14 für Zauber und Liturgien lässt sich durch **Merkmalskenntnis**
beziehungsweise **Aspektkenntnis** aufheben. **Herausragende Fertigkeit** und
**Herausragende Kampftechnik** heben die `+2`-Grenze je Rang um 1 an; das PDF wertet
das bereits aus.

### 5.3 Startwerte

```
Eigenschaften    je 8   (Summe 64 bereits verbraucht), Minimum 8 am Ende von Schritt 4
Kampftechniken   je 6
Fertigkeiten     je 0
```

### 5.4 Vor- und Nachteile

> „Die maximale Zahl an Abenteuerpunkten, die man in Vorteile investieren kann,
> beträgt 80 Punkte. Durch Nachteile kann man ebenfalls nur 80 Abenteuerpunkte
> dazugewinnen."

Die Anzahl ist unbegrenzt, nur der AP-Betrag zählt.

**Die automatisch durch die Spezies gewährten Vor- und Nachteile zählen mit.**
Ausdrückliche Regel, kein Auslegungsspielraum:

> „Bei dieser Begrenzung mitgerechnet werden die Vor- und Nachteile, die man bei der
> Wahl der Spezies automatisch erhält."

Das PDF führt je Spezies zwei getrennte Zahlen: `Gesamt` (Gesamtkosten der Spezies)
und `AP` (Anteil ohne die automatischen Vor- und Nachteile). Ihre Differenz entspricht
dem Wert der automatischen Einträge — für die Mehrzahl der Spezies rechnerisch
bestätigt. Die verbleibenden Fälle betreffen Vorteile mit Stufen oder Erweiterungen,
deren Kosten `VorteilKosten` gesondert bestimmt; dort ist `VorteilKosten` maßgeblich,
nicht `BasisKosten`.

*Umsetzungshinweis:* Nachteilskosten sind in den Daten **negativ** hinterlegt
(z. B. `NT65 Nicht humanoid = -30`). Das Vorzeichen darf beim Aufsummieren nicht
zusätzlich gedreht werden.

### 5.5 Kostenformeln

Aus dem PDF-JavaScript verifiziert, Aktivierungskosten zusätzlich im Regel-Wiki belegt.

**Eigenschaftskosten** (`EigenschaftAPRechner`)
```
w <= 8      -> 0
8 < w <= 13 -> (w - 8) * 15
w > 13      -> 75 + (w - 13) * (w - 12) * 7.5
```

**Fertigkeits-, Zauber- und Liturgiekosten** (`TalentKosten`), Spaltenfaktor A=1, B=2, C=3, D=4
```
w <= 11 -> w * faktor
w > 11  -> (11 + (w - 11) * (w - 10) / 2) * faktor
Aktivierungskosten: A = 1, B = 2, C = 3, D = 4 AP
```

**Energiekosten** (`EnergieKosten`)
```
p <= 11 -> p * 4
p > 11  -> 44 + (p - 11) * (p - 10) * 2
```

### 5.6 Abgeleitete Werte

Grundwerte (GW) je Spezies aus `SpeziesGetInfo`. Regel-Wiki und PDF stimmen überein.
```
LE  = GW(Spezies) + 2 * KO            +/- Vor-/Nachteile
SK  = GW(Spezies) + (MU + KL + IN)/6  +/- Vor-/Nachteile
ZK  = GW(Spezies) + (KO + KO + KK)/6  +/- Vor-/Nachteile
AW  = GE / 2                          +/- Vor-/Nachteile
INI = (MU + GE) / 2                   +/- Vor-/Nachteile
GS  = GW(Spezies)                     +/- Vor-/Nachteile
AE  = GW(Vorteil Zauberer)  + Leiteigenschaft der Tradition   (nur mit Tradition)
KE  = GW(Vorteil Geweihter) + Leiteigenschaft der Tradition   (nur mit Tradition)
```
Der Grundwert für AE und KE beträgt 20. Der **Traditionsfaktor** aus
`TraditionGetInfo` begrenzt nicht den Grundwert, sondern die **maximal zukaufbare**
Energie — das ist im PDF (`MaxEnergieKauf`) getrennt geführt und darf nicht
vermischt werden.

Alle Helden starten mit **3 Schicksalspunkten**, unabhängig vom Erfahrungsgrad.

*Anmerkung:* Das Regel-Wiki schreibt bei der Zähigkeit versehentlich
„Seelenkraft-Grundwert". Gemeint und im PDF umgesetzt ist der Zähigkeit-Grundwert.

### 5.7 Restliche AP

> „Auf diese Weise dürfen nicht mehr als 10 Abenteuerpunkte einbehalten werden."

Höchstens **10 AP** dürfen ungenutzt in das Spiel mitgenommen werden; ein negativer
Saldo ist unzulässig. Die Regel verhindert, dass die Erschaffungsgrenzen direkt nach
Spielbeginn umgangen werden. Der Prüfbericht in Schritt 12 setzt das durch.

### 5.8 Startalter

Tabelle je Spezies und Erfahrungsgrad, Grundalter plus Würfelwurf
(Mensch auf *Erfahren* 16+1W3, Elf 26+2W6). Die vollständige Tabelle liegt bereits im
PDF in `SpeziesGetInfo` Feld `Alter` als sieben Einträge je Spezies — je Erfahrungsgrad
einer. Stichprobe gegen das Regel-Wiki stimmt überein. Freie Wahl ist ausdrücklich
erlaubt; der Würfelwurf ist ein Angebot, kein Zwang.

## 6. Der Assistent

Zwölf Schritte. Sie folgen der offiziellen Reihenfolge der Heldenerschaffung; wo das
Regelwerk feiner unterteilt, fasst die Oberfläche zusammen. Die Spalte *offiziell*
nennt die entsprechenden Regelwerk-Schritte.

| # | Schritt | offiziell | Regelwirkung |
|---|---|---|---|
| 1 | Konzept und Erfahrungsgrad | 1, 2 | Budget und **alle** Höchstwerte; Archetyp-Vorfilter |
| 2 | Spezies | 3 | AP, Eigenschaftsmodifikatoren, GW, automatische Vor-/Nachteile (zählen auf die 80 AP) |
| 3 | Kultur | 4 | AP, Fertigkeitspaket, Sprachen, Verträglichkeit mit der Spezies |
| 4 | Eigenschaften | 5 | Basis 8, Minimum 8; Höchstwert **und** Punktsumme je Erfahrungsgrad |
| 5 | Profession | 6a, 6b | AP, Fertigkeiten, Kampftechniken, Sonderfertigkeiten, ggf. Tradition; Modifikation erlaubt |
| 6 | Vor- und Nachteile | 7 | je 80 AP inklusive der Spezies-Einträge; Voraussetzungen und Ausschlüsse |
| 7 | Fertigkeiten und Kampftechniken | 8, 9 | Kampftechniken ab 6; beide Schranken aus 5.2 gleichzeitig |
| 8 | Sonderfertigkeiten | 10 | Voraussetzungen; Merkmals-/Aspektkenntnis hebt die 14er-Grenze |
| 9 | Magie und Karma | 8, 10 | nur bei Tradition; Anzahl und Fremdzauber je Erfahrungsgrad; Professionszauber zählen mit |
| 10 | Ausrüstung | 13 | Geld, Gewicht, Waffen und Rüstung aus 3.308 Gegenständen |
| 11 | Details | 11, 14, 15 | Startalter je Spezies/Erfahrungsgrad, Größe und Gewicht, Name, Aussehen |
| 12 | Prüfen und Ausgeben | — | Prüfbericht inkl. **Restbestand ≤ 10 AP**, danach JSON, PDF, Druck |

**Eigenschaften stehen vor der Profession.** Das entspricht dem Regelwerk und ist
zwingend, weil die Fertigkeitsgrenzen aus 5.2 von den Eigenschaften abhängen.

Die **Basiswerte** aus 5.5 sind kein eigener Schritt. Sie stehen dauerhaft in einer
Seitenleiste und rechnen sich bei jeder Änderung neu — genau das, was am
PDF-Formular mühsam ist.

Schritte sind frei anspringbar, sobald ihre Voraussetzungen erfüllt sind. Schritt 9
erscheint nur bei vorhandener Tradition.

### Regelwissen in der Oberfläche

Der eigentliche Zweck des Projekts. Kein nachträglich angeklebtes Tooltip-System:

- **Regelkarten** je Eintrag: der Regeltext im Klartext samt Voraussetzungen, direkt
  aus dem Feld `Regel` des Datensatzes — nicht als Seitenverweis.
- **Kostenvorschau** beim Überfahren, bevor eine Wahl verbindlich wird.
- **Grenzanzeigen**, die begründen, *welche* der beiden Schranken aus 5.2 gerade
  greift — „begrenzt durch KL 13 +2“ gegen „begrenzt durch Erfahrungsgrad 10“.
  Genau diese Unterscheidung fehlt dem PDF vollständig.
- **Konzeptprüfung**: meldet Unstimmigkeiten — magische Profession ohne Tradition,
  gekaufte AE ohne Zauber, Eigenschaften quer zu den Proben der Profession,
  nicht ausgegebene AP, nicht ausgeschöpfte Nachteil-AP.
- **Archetypen** in Schritt 1 filtern die 951 Professionen auf ein menschliches Maß
  und schlagen passende Spezies und Kulturen vor. Volle Suche bleibt einen Klick entfernt.

## 7. Import und Export

| Format | Import | Export |
|---|---|---|
| JSON v1 (eigen) | ja, versioniertes Schema | ja, verlustfreier Rundlauf |
| PDF (offizielles Heldendokument) | ja, AcroForm-Werte lesen | ja, inkrementelle Aktualisierung |
| Druck | — | offizielles Blatt und kompakte Ansicht |

### 7.1 PDF lesen — nachgewiesen

Eigener Parser, nur Web-Standard-APIs (`Uint8Array`, `TextDecoder`,
`DecompressionStream`). Beherrscht Cross-Reference-Streams, Objektströme,
PNG-Prädiktoren und Flate. Gemessen: **17.151 Objekte in 120 ms**, 5.442 benannte
Felder aufgelöst.

### 7.2 PDF schreiben — nachgewiesen

Inkrementelle Aktualisierung: geänderte Objekte, neuer XRef-Stream, `/Prev` auf die
alte Tabelle. Das Original bleibt unberührt, das eingebettete JavaScript intakt.
Gemessen: **+60 KB** auf 10,8 MB, danach alle 5.970 Felder weiterhin lesbar,
Umlaute über UTF-16BE korrekt (`Held_Name = 'Grimmbart Söhnlein'`).

### 7.3 Appearance-Streams — der Kern der Druckbarkeit

`/NeedAppearances` genügt nicht. Nachgewiesen: `MU_1` besitzt **sechs Widget-Kinder**
mit je eigenem `/AP`. Wird `/AP` nur am Feld entfernt, überleben alle sechs veralteten
Darstellungen und werden gedruckt — im Test erschien weiterhin „8“ statt „13“.
`Held_Name` hat keine Kinder und wurde deshalb korrekt neu gezeichnet.

Der Export erzeugt daher je Widget selbst einen `/AP /N`-Formular-XObject:

1. Alle Widgets eines Feldes einsammeln (Feld selbst, falls kinderlos).
2. `/Rect`, `/DA` (Schrift, Größe, Farbe), `/Q` (Ausrichtung), `/Ff` (mehrzeilig, Kamm) lesen.
3. Bei `0 Tf` die Größe aus `/Widths` der Schrift und der Rechteckhöhe bestimmen.
4. Inhaltsstrom zeichnen, Schriften aus `/DR` referenzieren — nichts neu einbetten.
5. `/NeedAppearances` bleibt aus.

Ergebnis: Der Text steht in der Seitengrafik. Acrobat, Chrome, Vorschau und Druckerei
zeigen dasselbe. In Acrobat bleibt das Blatt weiterhin bearbeitbar und selbstrechnend.

### 7.4 Feldzuordnung

`fieldmap.json` bildet das Charaktermodell auf die PDF-Feldnamen ab. Das Blatt nutzt
teils getrennte Eingabe- und Anzeigefelder (180 Felder mit `Anzeige` im Namen,
z. B. `Held_Spezies_Anzeige`). Die Zuordnung wird erzeugt, nicht von Hand gepflegt,
und durch einen Rundlauftest abgesichert.

### 7.5 Kompakte Druckansicht

Eine bis zwei Seiten mit den Werten, die am Spieltisch tatsächlich gebraucht werden:
Eigenschaften, abgeleitete Werte, Kampfwerte, gesteigerte Fertigkeiten, Zauber und
Liturgien, Sonderfertigkeiten, Ausrüstung. Umgesetzt als `@media print` über eine
eigene Ansicht, ausgelöst per `window.print()`. Kein PDF-Code, keine zweite Bibliothek.

## 8. Gestaltung

Eigenständig statt generisch. Dunkle, pergamentnahe Grundstimmung mit ruhiger
Typografie; Inhalt vor Ornament. Tastaturbedienbar, sichtbarer Fokus, ausreichender
Kontrast. Die Oberfläche muss auf einem Laptop ohne Scrollen je Schritt lesbar bleiben.
Ausgearbeitet wird sie zur Umsetzungszeit mit der `frontend-design`-Fähigkeit.

## 9. Prüfung

Playwright, ausschließlich Entwicklungsabhängigkeit, als einziger Testläufer für
Einheiten- **und** Browsertests. Statischer Server aus Nodes eingebautem `http`,
ohne Zusatzpakete. Zusätzlich `tsc --noEmit` als eigene Prüfstufe.

1. **Vollständiger Durchlauf, weltlich** — Held von Schritt 1 bis 11, AP-Rechnung an
   jedem Schritt gegen von Hand gerechnete Werte geprüft.
2. **Vollständiger Durchlauf, magisch** — Tradition, AE, Zauber, Höchstwerte.
3. **JSON-Rundlauf** — Export, Import, Modell identisch.
4. **PDF-Rundlauf** — Export, erneuter Import in die App, Werte gleich.
5. **Druckbarkeit** — exportiertes PDF rastern und prüfen, dass die gesetzten Werte
   sichtbar sind. Das ist der Test, den die `/NeedAppearances`-Fassung nicht bestanden hätte.
6. **Grenzen** — Eigenschaft über 14 gesperrt, Budgetüberschreitung gesperrt,
   Schalter „Regeln lockern“ hebt beides auf.
7. **Sicherung** — Neuladen stellt den Stand wieder her.
8. **Tastatur** — der gesamte Assistent ist ohne Maus bedienbar.

Der Regelkern wird zusätzlich direkt geprüft: Kostenkurven und abgeleitete Werte gegen
Tabellenwerte, ausgeführt im selben Playwright-Lauf.

## 10. Risiken

| Risiko | Bewertung | Umgang |
|---|---|---|
| PDF lesen und schreiben | **erledigt**, im Versuch nachgewiesen | — |
| Appearance-Streams, Auto-Größe und Ausrichtung | mittel | Früh umsetzen, durch Rasterprüfung abgesichert |
| Feldzuordnung über 5.970 Felder | mittel | Erzeugt statt handgepflegt, Rundlauftest |
| Umfang der Oberfläche für Magie und Karma | mittel | Schritt 8 zuletzt, weltlicher Pfad zuerst lauffähig |
| Erschaffungsgrenzen | **erledigt**, recherchiert und belegt | siehe 5.1–5.3 und Quellen in 12 |
| Datenmenge im Browser | gering | Träges Nachladen je Kategorie |

## 11. Reihenfolge der Umsetzung

1. Extraktion und Datenerzeugung, Datensätze eingecheckt
2. Regelkern mit eigenen Prüfungen
3. Gerüst des Assistenten, Store, Autosicherung
4. Schritte 1–7, weltlicher Pfad vollständig lauffähig
5. JSON-Import und -Export
6. PDF lesen, PDF schreiben mit Appearance-Streams, Rasterprüfung
7. Kompakte Druckansicht
8. Schritt 8, Magie und Karma
9. Schritte 9 und 10, Ausrüstung und Details
10. Gestaltungsdurchgang, Zugänglichkeit, vollständige E2E-Abdeckung

## 12. Quellen

Recherchiert und gegengeprüft am 2026-08-19 im offiziellen
[DSA Regel-Wiki](https://dsa.ulisses-regelwiki.de/).

| Beleg | Seite |
|---|---|
| Schrittfolge der Erschaffung | [Heldenerschaffung](https://dsa.ulisses-regelwiki.de/Heldenerschaffung.html) |
| Erfahrungsgradtabelle, wortgetreu | [Schritt 2](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-2-erfahrungsgrad-waehlen.html) |
| Spezies: Grundwerte, Modifikatoren | [Schritt 3](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-3-spezies-waehlen.html) |
| Eigenschaften: Start 8, Minimum, Punktsumme | [Schritt 5](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-5-eigenschaftspunkte-verteilen.html) |
| Profession: Paketinhalt, AP, Zauber zählen mit | [Schritt 6a](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-6a-profession-auswaehlen.html) |
| 80-AP-Grenze, wortgetreu | [Schritt 7](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-7-vor-und-nachteile-waehlen.html) |
| `+2`-Regel, Aktivierungskosten A–D | [Schritt 8](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-8-steigerungen-vornehmen.html) |
| Kampftechniken starten bei 6 | [Schritt 9](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-9-kampftechniken-berechnen.html) |
| Restbestand höchstens 10 AP | [Schritt 11](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-11-letzte-anpassungen-vornehmen.html) |
| Basiswerte-Formeln | [Schritt 12](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-12-basiswerte-berechnen.html) |
| Startalter je Spezies und Grad | [Schritt 14](https://dsa.ulisses-regelwiki.de/Heldenerschaffung/schritt-14-startalter-festlegen.html) |
| Höchstwerte, Merkmals-/Aspektkenntnis | [Erfahrung](https://dsa.ulisses-regelwiki.de/Erfahrung.html) |
| Unabhängige Bestätigung AP/Eigenschaften | [Wiki Aventurica — Erfahrungsgrad](https://de.wiki-aventurica.de/wiki/Erfahrungsgrad) |

Primärquellen laut Regel-Wiki: *Regelwerk* S. 38–39 und 56, *Kodex der Helden* S. 8–9,
14–17, 20, 23–24.

Aus dem PDF-JavaScript des Heldendokuments V2.13 verifiziert: Kostenformeln
(`EigenschaftAPRechner`, `TalentKosten`, `EnergieKosten`), `MaxTalentWert`,
`MaxKampfWert`, `ErfahrungsgradGetInfo`, Startaltertabelle in `SpeziesGetInfo`.
