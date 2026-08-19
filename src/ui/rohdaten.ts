/**
 * Schmale, typsichere Zugriffe auf rohe Datensatz-Zeilen (`DatensatzZeile` =
 * `Record<string, unknown>`, siehe src/data/loader.ts). Die Felder in app/data/*.json sind
 * NICHT einheitlich benannt (Spec-Hinweis) — diese Helfer machen den Zugriff defensiv statt
 * an jeder Aufrufstelle erneut `unknown` zu entpacken, ohne die Rohdaten-Typen aus
 * src/core zu duplizieren (die UI-Schicht bleibt für ihre eigenen Anzeigebedürfnisse
 * zuständig, src/core bleibt unangetastet).
 */
import type { DatensatzZeile } from '../data/loader.ts';

export function feldStr(zeile: DatensatzZeile, feld: string): string {
  const wert = zeile[feld];
  return typeof wert === 'string' ? wert : '';
}

export function feldNum(zeile: DatensatzZeile, feld: string): number {
  const wert = zeile[feld];
  return typeof wert === 'number' ? wert : 0;
}

export function feldStrArr(zeile: DatensatzZeile, feld: string): readonly string[] {
  const wert = zeile[feld];
  if (!Array.isArray(wert)) return [];
  return wert.filter((eintrag): eintrag is string => typeof eintrag === 'string');
}

/** Paare aus String-Tupeln, z. B. `Vorteil`/`Nachteil`: `[["VT201", ""], ...]`. */
export function feldStrPaare(zeile: DatensatzZeile, feld: string): ReadonlyArray<readonly [string, string]> {
  const wert = zeile[feld];
  if (!Array.isArray(wert)) return [];
  const ergebnis: Array<readonly [string, string]> = [];
  for (const eintrag of wert) {
    if (
      Array.isArray(eintrag) && eintrag.length === 2
      && typeof eintrag[0] === 'string' && typeof eintrag[1] === 'string'
    ) {
      ergebnis.push([eintrag[0], eintrag[1]]);
    }
  }
  return ergebnis;
}

/** Flache Name/Wert-Folgen, z. B. `Talent`: `["Schwimmen", 1, "Klettern", 2, ...]`. */
export function feldNamenWerte(
  zeile: DatensatzZeile, feld: string,
): ReadonlyArray<{ readonly name: string; readonly wert: number }> {
  const wert = zeile[feld];
  if (!Array.isArray(wert)) return [];
  const ergebnis: Array<{ name: string; wert: number }> = [];
  for (let i = 0; i + 1 < wert.length; i += 2) {
    const name = wert[i];
    const zahl = wert[i + 1];
    if (typeof name === 'string' && typeof zahl === 'number') ergebnis.push({ name, wert: zahl });
  }
  return ergebnis;
}

export function findeZeile(
  zeilen: ReadonlyArray<DatensatzZeile>, idFeld: string, id: string,
): DatensatzZeile | undefined {
  return zeilen.find((zeile) => zeile[idFeld] === id);
}

/** "55" -> 55, "322+130" -> 452 (Kultur-/Professionspakete können mehrere Summanden haben). */
export function summeGesamt(gesamt: string): number {
  return gesamt.split('+').reduce((summe, teil) => summe + Number(teil), 0);
}

/**
 * "6/24" mit stufe=2 -> 24 (1-basiert). Einfache, einstufige Werte (z. B. "-30") liefern bei
 * jeder Stufe denselben Wert. Spiegelt absichtlich dieselbe Index-Klemmung wie das private
 * `eigenheitKosten` in core/apkonto.ts, damit die Vorschau in der UI nie von der tatsächlichen
 * AP-Kontoführung abweicht.
 */
export function stufenKosten(basisKosten: string, stufe: number): number {
  const teile = basisKosten.split('/').map(Number);
  const index = Math.min(Math.max(stufe - 1, 0), teile.length - 1);
  return teile[index] ?? 0;
}

/** Anzahl der Stufen aus `BasisKosten`, z. B. "6/24" -> 2, "-30" -> 1. */
export function stufenAnzahl(basisKosten: string): number {
  return basisKosten.split('/').length;
}

/**
 * Liest ein Feld, das eine Zahl im deutschen Komma-Format trägt (z. B. `app/data/ausruestung.json`s
 * `Wert`/`Gewicht`: `"0,5"`, `"1,2"`). Fehlt das Feld oder ist es kein Text, liefert 0 statt zu werfen
 * — dieselbe "defensiv statt strikt" Haltung wie die übrigen `feld*`-Helfer in dieser Datei.
 */
export function feldKommaZahl(zeile: DatensatzZeile, feld: string): number {
  const wert = zeile[feld];
  if (typeof wert !== 'string') return 0;
  const zahl = Number(wert.replace(',', '.'));
  return Number.isFinite(zahl) ? zahl : 0;
}
