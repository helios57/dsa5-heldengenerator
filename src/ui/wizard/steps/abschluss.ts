/**
 * Schritt XII — Prüfen und Ausgeben. Der Zielpunkt der ganzen Erschaffung:
 *   1. ein vollständiger Prüfbericht (Regelverstöße in Klartext, mit Verweis auf den
 *      reparierenden Schritt),
 *   2. die AP-Bilanz (höchstens `MAX_REST_AP` ungenutzt, nie negativ — beides einzeln
 *      ausgewiesen),
 *   3. Export (JSON, PDF, Druck) und Import (JSON, ausgefülltes PDF), alles rein clientseitig.
 *
 * PDF-Export/-Import laufen in `pdfWorker.ts` (Web Worker) — `PDFDoc.load`/`readAcroFields`/
 * `schreibeFormular` sind bei 10,8 MB/5442 Feldern spürbar rechenintensiv; ein Worker hält das
 * vom Hauptthread fern, ein Fortschrittstext hier hält die Oberfläche währenddessen ehrlich
 * (Download-Prozent, dann grobe Verarbeitungsstufen vom Worker).
 *
 * "Prüfbericht" bündelt drei Quellen zu EINER Liste:
 *   - `pruefeEigenschaften` (Ruling R13: mit `eigenschaftenGekauft`, NIE mit `eigenschaftenFinal`),
 *   - `pruefeVorNachteile`, `pruefeRestAP` (beide aus `apKonto()`),
 *   - lokale Kohärenz-Prüfungen, die keine Entsprechung in `src/core/` haben (magische/karmale
 *     Profession ohne Tradition, gekaufte AE/KE ohne einen einzigen Zauber/eine einzige Liturgie)
 *     — bewusst NICHT in `src/core/limits.ts` (unantastbar), sondern hier als reine UI-
 *     Zusammenführung bereits vorhandener `held`-Felder.
 * Jeder Befund bekommt einen Schritt-Verweis als Klartext-Suffix; die Schritt-Leiste erlaubt
 * keine programmatische Navigation aus einem Schritt heraus (siehe Vertrag in wizard/index.ts),
 * daher ist der Verweis beschreibend ("Schritt IV — Eigenschaften"), kein Link.
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { apKonto } from '../../../core/apkonto.ts';
import type {
  DatenIndex, SpeziesEintrag, KulturEintrag, ProfessionEintrag, TalentEintrag, ZauberLiturgieEintrag,
} from '../../../core/apkonto.ts';
import { pruefeEigenschaften, pruefeVorNachteile, pruefeRestAP, MAX_REST_AP } from '../../../core/limits.ts';
import { eigenschaftenFinal } from '../../../core/character.ts';
import { EIGENSCHAFTEN, basiswerte } from '../../../core/derived.ts';
import type { Grundwerte, Problem } from '../../../core/types.ts';
import type { Held } from '../../../core/character.ts';
import { exportiereJSON, importiereJSON } from '../../../io/json.ts';
import { felderZuHeld } from '../../../io/fieldmap.ts';
import type { Schritt } from '../types.ts';
import type { WorkerAnfrage, WorkerAntwort } from './pdfWorker.ts';

const PDF_VORLAGE_PFAD = './423187-Charakterbogen_V2_13_(ausfuellbar_selbstrechnend_ohne_Hintergrund)_korr_V2.pdf';

// --- Erweiterte, lokale Sichten auf DatenIndex-Einträge (dieselbe Technik wie io/fieldmap.ts:
// `DatenIndex` trägt nur, was `apKonto()` braucht; die zugrundeliegenden Datensatz-Zeilen haben
// mehr Felder, die hier für Anzeigenamen/Basiswerte gebraucht werden). --------------------------
type SpeziesAnzeige = SpeziesEintrag & {
  readonly 'Name divers'?: string; readonly EW?: unknown;
  readonly LE?: number; readonly SK?: number; readonly ZK?: number; readonly GS?: number;
};
type KulturAnzeige = KulturEintrag & { readonly 'Name Plural'?: string };
type ProfessionAnzeige = ProfessionEintrag & { readonly LeitMagie?: string; readonly LeitKarma?: string };
type TalentAnzeige = TalentEintrag & { readonly Name?: string };
type ZauberLiturgieAnzeige = ZauberLiturgieEintrag & { readonly Name?: string };

function beschreibeFehler(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

function zahlOderNull(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
}

function grundwerteVon(eintrag: SpeziesAnzeige | undefined): Grundwerte | null {
  if (eintrag === undefined) return null;
  const le = zahlOderNull(eintrag.LE);
  const sk = zahlOderNull(eintrag.SK);
  const zk = zahlOderNull(eintrag.ZK);
  const gs = zahlOderNull(eintrag.GS);
  if (le === null || sk === null || zk === null || gs === null) return null;
  return { le, sk, zk, gs };
}

function dateiname(name: string, endung: string): string {
  const sicher = name.trim().length > 0 ? name.trim().replace(/[\\/:*?"<>|]+/g, '_') : 'Held';
  return `${sicher}.${endung}`;
}

/** Blob bauen, Objekt-URL erzeugen, synthetischen Klick auf `<a download>` auslösen, aufräumen. */
function ladeHerunter(inhalt: BlobPart, typ: string, name: string): void {
  const blob = new Blob([inhalt], { type: typ });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function neuerPdfWorker(): Worker {
  return new Worker(new URL('./pdfWorker.js', import.meta.url), { type: 'module' });
}

/** Lädt die 10,8-MB-Vorlage mit Fortschritt (0–1), sofern der Server `Content-Length` sendet. */
async function ladePdfVorlage(fortschritt: (anteil: number | null) => void): Promise<ArrayBuffer> {
  const antwort = await fetch(PDF_VORLAGE_PFAD);
  if (!antwort.ok) {
    throw new Error(`Vorlage antwortete mit Status ${antwort.status}.`);
  }
  const gesamtHeader = antwort.headers.get('content-length');
  const gesamt = gesamtHeader !== null ? Number(gesamtHeader) : NaN;
  if (antwort.body === null || !Number.isFinite(gesamt) || gesamt <= 0) {
    fortschritt(null);
    return await antwort.arrayBuffer();
  }

  const leser = antwort.body.getReader();
  const teile: Uint8Array[] = [];
  let geladenBytes = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    if (value !== undefined) {
      teile.push(value);
      geladenBytes += value.byteLength;
      fortschritt(Math.min(1, geladenBytes / gesamt));
    }
  }
  const zusammengefasst = new Uint8Array(geladenBytes);
  let versatz = 0;
  for (const teil of teile) {
    zusammengefasst.set(teil, versatz);
    versatz += teil.byteLength;
  }
  return zusammengefasst.buffer;
}

async function frageWorker(worker: Worker, anfrage: WorkerAnfrage, transfer: readonly Transferable[], fortschritt: (stufe: string) => void): Promise<WorkerAntwort> {
  return await new Promise<WorkerAntwort>((resolve, reject) => {
    worker.addEventListener('message', (ev) => {
      const antwort = ev.data as WorkerAntwort;
      if (antwort.art === 'fortschritt') {
        fortschritt(antwort.stufe);
        return;
      }
      resolve(antwort);
    });
    worker.addEventListener('error', (ev) => reject(new Error(ev.message)));
    worker.postMessage(anfrage, [...transfer]);
  });
}

// --- Prüfbericht ---------------------------------------------------------------------------

function schrittHinweis(code: Problem['code']): string {
  switch (code) {
    case 'eigenschaft-min':
    case 'eigenschaft-max':
    case 'eigenschaftspunkte':
    case 'eigenschaft-fehlt':
      return 'Schritt IV — Eigenschaften';
    case 'vorteil-ap':
    case 'nachteil-ap':
      return 'Schritt V–VII — Vorteile & Nachteile';
    case 'rest-ap':
    case 'ap-ueberzogen':
      return 'AP-Band oben';
  }
}

function baueBefunde(held: Held, daten: DatenIndex): readonly string[] {
  const konto = apKonto(held, daten);
  const befunde: string[] = [];

  for (const p of pruefeEigenschaften({ eigenschaften: held.eigenschaftenGekauft, grad: held.erfahrungsgrad })) {
    befunde.push(`${p.text} (${schrittHinweis(p.code)})`);
  }
  for (const p of pruefeVorNachteile({ vorteilAP: konto.vorteilAP, nachteilAP: konto.nachteilAP })) {
    befunde.push(`${p.text} (${schrittHinweis(p.code)})`);
  }
  for (const p of pruefeRestAP({ budget: konto.budget, ausgegeben: konto.ausgegeben })) {
    befunde.push(`${p.text} (${schrittHinweis(p.code)})`);
  }

  const professionEintrag = held.profession !== null
    ? (daten.professionen.get(held.profession) as ProfessionAnzeige | undefined) : undefined;
  if (professionEintrag?.LeitMagie !== undefined && held.traditionMagisch === null) {
    befunde.push('Die gewählte Profession ist magisch, aber es wurde keine Zaubertradition gewählt. (Schritt IX — Magie und Karma)');
  }
  if (professionEintrag?.LeitKarma !== undefined && held.traditionKarmal === null) {
    befunde.push('Die gewählte Profession ist karmal, aber es wurde keine Tradition gewählt. (Schritt IX — Magie und Karma)');
  }
  if (held.energienKauf.ae > 0 && !Object.values(held.zauber).some((w) => w > 0)) {
    befunde.push('Astralenergie wurde zusätzlich gekauft, aber kein Zauber wurde erlernt. (Schritt IX — Magie und Karma)');
  }
  if (held.energienKauf.ke > 0 && !Object.values(held.liturgien).some((w) => w > 0)) {
    befunde.push('Karmaenergie wurde zusätzlich gekauft, aber keine Liturgie wurde erlernt. (Schritt IX — Magie und Karma)');
  }

  return befunde;
}

function baueSpielbogen(held: Held, daten: DatenIndex): HTMLElement {
  const speziesEintrag = held.spezies !== null ? (daten.spezies.get(held.spezies) as SpeziesAnzeige | undefined) : undefined;
  const kulturEintrag = held.kultur !== null ? (daten.kulturen.get(held.kultur) as KulturAnzeige | undefined) : undefined;
  const final = eigenschaftenFinal(held, speziesEintrag?.EW);
  const grundwerte = grundwerteVon(speziesEintrag);
  const werte = grundwerte !== null ? basiswerte(grundwerte, final) : null;

  const kampftechniken = Object.entries(held.kampftechniken).filter(([, w]) => w > 0)
    .map(([name, w]) => `${name} ${w}`);
  const fertigkeiten = Object.entries(held.fertigkeiten).filter(([, w]) => w > 0)
    .map(([id, w]) => {
      const eintrag = daten.talente.get(id) as TalentAnzeige | undefined;
      return `${eintrag?.Name ?? id} ${w}`;
    });
  const zauber = Object.entries(held.zauber).filter(([, w]) => w > 0)
    .map(([id, w]) => {
      const eintrag = daten.zauber.get(id) as ZauberLiturgieAnzeige | undefined;
      return `${eintrag?.Name ?? id} ${w}`;
    });
  const liturgien = Object.entries(held.liturgien).filter(([, w]) => w > 0)
    .map(([id, w]) => {
      const eintrag = daten.liturgien.get(id) as ZauberLiturgieAnzeige | undefined;
      return `${eintrag?.Name ?? id} ${w}`;
    });
  // `held.sonderfertigkeiten[].id` ist `"<datensatz>:<Name divers>"` (Konvention aus Schritt
  // VIII, sonderfertigkeiten.ts) — nur am ERSTEN Doppelpunkt trennen, falls der Name selbst
  // einen enthält.
  const sonderfertigkeiten = held.sonderfertigkeiten.map((e) => {
    const trennstelle = e.id.indexOf(':');
    return trennstelle === -1 ? e.id : e.id.slice(trennstelle + 1);
  });
  const ausruestung = held.ausruestung.map((a) => `${a.id} × ${a.anzahl}`);

  const liste = (titel: string, eintraege: readonly string[]): HTMLElement | null =>
    eintraege.length > 0 ? el('div', { class: 'spielbogen-block' }, [
      el('h3', {}, [titel]),
      el('p', {}, [eintraege.join(' · ')]),
    ]) : null;

  return el('section', { class: 'spielbogen-druck' }, [
    el('h2', {}, [held.meta.name.trim().length > 0 ? held.meta.name : 'Unbenannter Held']),
    el('p', { class: 'spielbogen-kopf' }, [
      [speziesEintrag?.['Name divers'] ?? held.spezies, kulturEintrag?.['Name Plural'] ?? held.kultur, held.profession]
        .filter((t): t is string => t !== null && t !== undefined && t.length > 0).join(' · '),
    ]),
    el('div', { class: 'spielbogen-block' }, [
      el('h3', {}, ['Eigenschaften']),
      el('p', {}, [EIGENSCHAFTEN.map((n) => `${n} ${final[n]}`).join(' · ')]),
    ]),
    werte !== null ? el('div', { class: 'spielbogen-block' }, [
      el('h3', {}, ['Basiswerte']),
      el('p', {}, [`LE ${werte.LE} · SK ${werte.SK} · ZK ${werte.ZK} · AW ${werte.AW} · INI ${werte.INI} · GS ${werte.GS}`]),
    ]) : null,
    liste('Kampftechniken', kampftechniken),
    liste('Fertigkeiten', fertigkeiten),
    liste('Zauber', zauber),
    liste('Liturgien', liturgien),
    liste('Sonderfertigkeiten', sonderfertigkeiten),
    liste('Ausrüstung', ausruestung),
  ]);
}

export const schrittAbschluss: Schritt = {
  id: 'abschluss',
  titel: 'Prüfen und Ausgeben',

  istAbgeschlossen: (held) => {
    // Grobe Heuristik ohne Datensatz-Zugriff (istAbgeschlossen bekommt nur `held`, siehe
    // Vertrag): "im Wesentlichen fertig" heißt hier, dass zumindest die reinen
    // Eigenschafts-Grenzen eingehalten sind — der volle Bericht (inkl. AP-Konto, das einen
    // `DatenIndex` braucht) steht nur innerhalb dieses Schritts selbst zur Verfügung.
    return pruefeEigenschaften({ eigenschaften: held.eigenschaftenGekauft, grad: held.erfahrungsgrad }).length === 0;
  },

  render(container, { store, daten }) {
    const berichtListe = el('ul', { class: 'pruefbericht-liste', 'data-testid': 'pruefbericht' });
    const bilanzBox = el('div', { class: 'ap-bilanz', 'data-testid': 'ap-bilanz' });
    const pdfStatus = el('p', { class: 'export-fortschritt__text', 'data-testid': 'export-pdf-status' });
    const pdfLauf = el('div', { class: 'export-fortschritt__fuellung' });
    const jsonImportStatus = el('p', { class: 'export-fortschritt__text', 'data-testid': 'import-json-status' });
    const pdfImportStatus = el('p', { class: 'export-fortschritt__text', 'data-testid': 'import-pdf-status' });
    const spielbogenSlot = el('div', {});

    const exportJsonKnopf = el('button', {
      type: 'button', class: 'schritt-knopf export-knopf', 'data-testid': 'export-json',
      onclick: () => {
        const held = store.held();
        ladeHerunter(exportiereJSON(held), 'application/json', dateiname(held.meta.name, 'json'));
      },
    }, ['Als JSON herunterladen']);

    const exportDruckKnopf = el('button', {
      type: 'button', class: 'schritt-knopf export-knopf', 'data-testid': 'export-druck',
      onclick: () => window.print(),
    }, ['Spielbogen drucken']);

    const exportPdfKnopf = el('button', {
      type: 'button', class: 'schritt-knopf export-knopf', 'data-testid': 'export-pdf',
      onclick: () => { void fuehreExportPdfAus(); },
    }, ['Als ausgefülltes PDF herunterladen']);

    async function fuehreExportPdfAus(): Promise<void> {
      const held = store.held();
      exportPdfKnopf.toggleAttribute('disabled', true);
      leeren(pdfStatus);
      pdfStatus.append('Vorlage wird heruntergeladen …');
      pdfLauf.style.width = '0%';

      let worker: Worker | null = null;
      try {
        const vorlage = await ladePdfVorlage((anteil) => {
          if (anteil !== null) pdfLauf.style.width = `${Math.round(anteil * 100)}%`;
        });
        worker = neuerPdfWorker();
        const anfrage: WorkerAnfrage = { art: 'export', pdfBytes: vorlage, held, daten };
        const antwort = await frageWorker(worker, anfrage, [vorlage], (stufe) => {
          leeren(pdfStatus);
          pdfStatus.append(stufe);
        });
        if (antwort.art !== 'export-ergebnis') throw new Error('Unerwartete Antwort vom PDF-Worker.');
        if (!antwort.ok) throw new Error(antwort.fehler);
        ladeHerunter(antwort.bytes, 'application/pdf', dateiname(held.meta.name, 'pdf'));
        leeren(pdfStatus);
        pdfStatus.append('PDF heruntergeladen.');
        pdfLauf.style.width = '100%';
      } catch (fehler) {
        leeren(pdfStatus);
        pdfStatus.append(`Fehler: ${beschreibeFehler(fehler)}`);
      } finally {
        worker?.terminate();
        exportPdfKnopf.toggleAttribute('disabled', false);
      }
    }

    async function verarbeiteJsonImport(datei: File): Promise<void> {
      leeren(jsonImportStatus);
      jsonImportStatus.append('JSON wird gelesen …');
      try {
        const text = await datei.text();
        const ergebnis = importiereJSON(text);
        if (!ergebnis.ok) {
          leeren(jsonImportStatus);
          jsonImportStatus.append(`Fehler: ${ergebnis.fehler.join(' ')}`);
          return;
        }
        store.ersetze(ergebnis.held);
        leeren(jsonImportStatus);
        jsonImportStatus.append('JSON importiert.');
      } catch (fehler) {
        leeren(jsonImportStatus);
        jsonImportStatus.append(`Fehler: ${beschreibeFehler(fehler)}`);
      }
    }

    async function verarbeitePdfImport(datei: File): Promise<void> {
      leeren(pdfImportStatus);
      pdfImportStatus.append('PDF wird gelesen …');
      let worker: Worker | null = null;
      try {
        const bytes = await datei.arrayBuffer();
        worker = neuerPdfWorker();
        const anfrage: WorkerAnfrage = { art: 'import', pdfBytes: bytes };
        const antwort = await frageWorker(worker, anfrage, [bytes], (stufe) => {
          leeren(pdfImportStatus);
          pdfImportStatus.append(stufe);
        });
        if (antwort.art !== 'import-ergebnis') throw new Error('Unerwartete Antwort vom PDF-Worker.');
        if (!antwort.ok) throw new Error(antwort.fehler);
        const held = felderZuHeld(new Map(antwort.werte), daten);
        store.ersetze(held);
        leeren(pdfImportStatus);
        pdfImportStatus.append('PDF importiert.');
      } catch (fehler) {
        leeren(pdfImportStatus);
        pdfImportStatus.append(`Fehler: ${beschreibeFehler(fehler)}`);
      } finally {
        worker?.terminate();
      }
    }

    const jsonDateiEingabe = el('input', {
      type: 'file', accept: 'application/json,.json', class: 'suchfeld', 'data-testid': 'import-json-datei',
      onchange: (ev) => {
        const datei = (ev.target as HTMLInputElement).files?.[0];
        if (datei !== undefined) void verarbeiteJsonImport(datei);
      },
    });
    const pdfDateiEingabe = el('input', {
      type: 'file', accept: 'application/pdf,.pdf', class: 'suchfeld', 'data-testid': 'import-pdf-datei',
      onchange: (ev) => {
        const datei = (ev.target as HTMLInputElement).files?.[0];
        if (datei !== undefined) void verarbeitePdfImport(datei);
      },
    });

    const abschnitt = el('section', { class: 'abschnitt abschnitt--breit' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Prüfen und Ausgeben']),
      el('h3', { class: 'unterabschnitt-titel' }, ['Prüfbericht']),
      berichtListe,
      el('h3', { class: 'unterabschnitt-titel' }, ['AP-Bilanz']),
      bilanzBox,
      el('h3', { class: 'unterabschnitt-titel' }, ['Exportieren']),
      el('div', { class: 'export-knopf-reihe' }, [exportJsonKnopf, exportPdfKnopf, exportDruckKnopf]),
      el('div', { class: 'export-fortschritt' }, [
        el('div', { class: 'export-fortschritt__lauf' }, [pdfLauf]),
        pdfStatus,
      ]),
      el('h3', { class: 'unterabschnitt-titel' }, ['Importieren']),
      el('div', { class: 'import-reihe' }, [
        el('label', { class: 'feld-label' }, ['Held aus JSON laden', jsonDateiEingabe]),
        jsonImportStatus,
        el('label', { class: 'feld-label' }, ['Held aus ausgefülltem PDF laden', pdfDateiEingabe]),
        pdfImportStatus,
      ]),
      spielbogenSlot,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    const renderBericht = (): void => {
      const held = store.held();
      const befunde = baueBefunde(held, daten);

      leeren(berichtListe);
      if (befunde.length === 0) {
        berichtListe.append(
          el('li', { class: 'pruefbericht-erfolg', 'data-testid': 'pruefbericht-leer' }, [
            'Keine Probleme gefunden — bereit zum Ausgeben.',
          ]),
        );
      } else {
        berichtListe.append(...befunde.map((text) =>
          el('li', { class: 'marginale marginale--verletzung', 'data-testid': 'befund' }, [text])));
      }

      const konto = apKonto(held, daten);
      const rest = konto.budget - konto.ausgegeben;
      const negativ = rest < 0;
      const zuHoch = rest > MAX_REST_AP;
      leeren(bilanzBox);
      bilanzBox.append(
        el('p', {
          class: `ap-bilanz__zeile${negativ ? ' ap-bilanz__zeile--verletzung' : ''}`,
          'data-testid': 'ap-bilanz-negativ',
        }, [negativ ? `Restbudget negativ: ${rest} AP.` : 'Restbudget nicht negativ.']),
        el('p', {
          class: `ap-bilanz__zeile${zuHoch ? ' ap-bilanz__zeile--verletzung' : ''}`,
          'data-testid': 'ap-bilanz-rest',
        }, [zuHoch
          ? `Zu viele ungenutzte AP: ${rest} (höchstens ${MAX_REST_AP} dürfen mitgenommen werden).`
          : `Ungenutzte AP im erlaubten Rahmen (${rest} / ${MAX_REST_AP}).`]),
      );

      leeren(spielbogenSlot);
      spielbogenSlot.append(baueSpielbogen(held, daten));
    };

    renderBericht();
    const abbestellen = store.abonniere(renderBericht);

    return () => abbestellen();
  },
};
