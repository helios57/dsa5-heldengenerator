/**
 * Web Worker für den PDF-Export/-Import in Schritt XII.
 *
 * `PDFDoc.load`/`readAcroFields`/`schreibeFormular` sind bei einem 10,8-MB-Dokument mit 5442
 * Feldern spürbar rechenintensiv — dieser Worker hält sie vom Hauptthread fern, damit die
 * Oberfläche währenddessen bedienbar bleibt. `abschluss.ts` postet eine `WorkerAnfrage` und
 * hört auf `WorkerAntwort`-Nachrichten (Zwischenstände als `'fortschritt'`, dann genau EIN
 * Ergebnis).
 *
 * Getippt ohne die `"webworker"`-Standardbibliothek: `tsconfig.app.json` setzt nur `"DOM"`
 * (dieselbe Kompilation deckt auch den Hauptthread-Code ab, und `"DOM"`+`"webworker"` würden
 * sich mit widersprüchlichen globalen Scopes in die Quere kommen). `self`/`postMessage` sind
 * unter `"DOM"` als `Window`-artig getippt, was hier nicht passt — daher ein enger, lokal
 * definierter Cast auf genau die zwei Funktionen, die dieser Worker tatsächlich benutzt, statt
 * eines pauschalen `any`. Dasselbe Cast-Muster verwendet bereits
 * `tests/unit/pdf-acroform.cycle-worker.ts` (`as unknown as PDFDoc`).
 */
import { PDFDoc } from '../../../io/pdf-document.ts';
import { readAcroFields, fieldValue } from '../../../io/pdf-acroform.ts';
import type { FieldInfo } from '../../../io/pdf-acroform.ts';
import { schreibeFormular } from '../../../io/pdf-writer.ts';
import { heldZuFeldern } from '../../../io/fieldmap.ts';
import type { Held } from '../../../core/character.ts';
import type { DatenIndex } from '../../../core/apkonto.ts';

export type WorkerAnfrage =
  | { readonly art: 'export'; readonly pdfBytes: ArrayBuffer; readonly held: Held; readonly daten: DatenIndex }
  | { readonly art: 'import'; readonly pdfBytes: ArrayBuffer };

export type WorkerAntwort =
  | { readonly art: 'fortschritt'; readonly stufe: string }
  | { readonly art: 'export-ergebnis'; readonly ok: true; readonly bytes: ArrayBuffer }
  | { readonly art: 'export-ergebnis'; readonly ok: false; readonly fehler: string }
  | { readonly art: 'import-ergebnis'; readonly ok: true; readonly werte: ReadonlyArray<readonly [string, string]> }
  | { readonly art: 'import-ergebnis'; readonly ok: false; readonly fehler: string };

type WorkerScope = {
  postMessage(message: WorkerAntwort, transfer?: readonly Transferable[]): void;
  addEventListener(art: 'message', hoerer: (ev: MessageEvent) => void): void;
};
const bereich = self as unknown as WorkerScope;

function beschreibeFehler(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

function sende(antwort: WorkerAntwort, transfer: readonly Transferable[] = []): void {
  bereich.postMessage(antwort, transfer);
}

async function fuehreImportAus(pdfBytes: ArrayBuffer): Promise<void> {
  sende({ art: 'fortschritt', stufe: 'PDF wird geöffnet …' });
  let doc: PDFDoc;
  try {
    doc = await PDFDoc.load(new Uint8Array(pdfBytes));
  } catch (fehler) {
    sende({ art: 'import-ergebnis', ok: false, fehler: `PDF konnte nicht gelesen werden: ${beschreibeFehler(fehler)}` });
    return;
  }

  sende({ art: 'fortschritt', stufe: 'Formularfelder werden gelesen …' });
  let felder: Map<string, FieldInfo>;
  try {
    felder = await readAcroFields(doc);
  } catch (fehler) {
    sende({
      art: 'import-ergebnis', ok: false,
      fehler: `Formularfelder konnten nicht gelesen werden: ${beschreibeFehler(fehler)}`,
    });
    return;
  }

  try {
    const werte = await Promise.all(
      [...felder.entries()].map(async ([name, info]): Promise<readonly [string, string]> =>
        [name, await fieldValue(doc, info)]),
    );
    sende({ art: 'import-ergebnis', ok: true, werte });
  } catch (fehler) {
    sende({
      art: 'import-ergebnis', ok: false,
      fehler: `Feldwerte konnten nicht gelesen werden: ${beschreibeFehler(fehler)}`,
    });
  }
}

async function fuehreExportAus(pdfBytes: ArrayBuffer, held: Held, daten: DatenIndex): Promise<void> {
  const original = new Uint8Array(pdfBytes);

  sende({ art: 'fortschritt', stufe: 'Vorlage wird geöffnet …' });
  let doc: PDFDoc;
  try {
    doc = await PDFDoc.load(original);
  } catch (fehler) {
    sende({ art: 'export-ergebnis', ok: false, fehler: `Vorlage konnte nicht geöffnet werden: ${beschreibeFehler(fehler)}` });
    return;
  }

  sende({ art: 'fortschritt', stufe: 'Formularfelder werden gelesen …' });
  let felder: Map<string, FieldInfo>;
  try {
    felder = await readAcroFields(doc);
  } catch (fehler) {
    sende({
      art: 'export-ergebnis', ok: false,
      fehler: `Formularfelder konnten nicht gelesen werden: ${beschreibeFehler(fehler)}`,
    });
    return;
  }

  sende({ art: 'fortschritt', stufe: 'Werte werden übertragen …' });
  const werte = heldZuFeldern(held, daten, new Set(felder.keys()));

  sende({ art: 'fortschritt', stufe: 'Formular wird geschrieben …' });
  try {
    const ausgabe = await schreibeFormular(original, doc, felder, werte);
    // Frische, exakt passende Kopie (statt `.buffer` direkt zu transferieren): garantiert
    // byteOffset 0 und byteLength === Puffergröße, unabhängig davon, wie `schreibeFormular`
    // intern allokiert hat.
    const kopie = ausgabe.slice();
    sende({ art: 'export-ergebnis', ok: true, bytes: kopie.buffer }, [kopie.buffer]);
  } catch (fehler) {
    sende({
      art: 'export-ergebnis', ok: false,
      fehler: `Formular konnte nicht geschrieben werden: ${beschreibeFehler(fehler)}`,
    });
  }
}

bereich.addEventListener('message', (ev: MessageEvent) => {
  const anfrage = ev.data as WorkerAnfrage;
  if (anfrage.art === 'import') {
    void fuehreImportAus(anfrage.pdfBytes);
  } else {
    void fuehreExportAus(anfrage.pdfBytes, anfrage.held, anfrage.daten);
  }
});
