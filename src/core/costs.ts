/** AP-Kostenformeln. Quelle: Heldendokument V2.13, Regel-Wiki (Spec §5.5). */
import type { Spalte } from './types.ts';

export const SPALTEN_FAKTOR: Readonly<Record<Spalte, number>> = Object.freeze({
  A: 1, B: 2, C: 3, D: 4,
});

const isSpalte = (v: string): v is Spalte => v === 'A' || v === 'B' || v === 'C' || v === 'D';

export function spaltenFaktor(spalte: string): number {
  const key = spalte.trim().toUpperCase();
  if (!isSpalte(key)) throw new Error(`unbekannte Steigerungsspalte: ${spalte}`);
  return SPALTEN_FAKTOR[key];
}

/**
 * Report, don't coerce (same discipline as `pruefeEigenschaften`, see Ruling R13's
 * neighbourhood in limits.ts): a `NaN`/`Infinity` input is corrupt caller state, not a
 * legitimate zero. Silently substituting 0 made a broken attribute cost 0 AP, so the AP
 * total under-reported and `pruefeRestAP` went on to report a bogus surplus instead of the
 * caller ever finding out something was wrong.
 */
function endlich(wert: number, feld: string): number {
  if (!Number.isFinite(wert)) {
    throw new Error(`${feld} ist kein gültiger Wert: ${wert}`);
  }
  return wert;
}

/** Kumulative AP-Kosten, um eine Eigenschaft vom Startwert 8 auf `wert` zu bringen. */
export function eigenschaftKosten(wert: number): number {
  const w = endlich(wert, 'wert');
  if (w <= 8) return 0;
  if (w <= 13) return (w - 8) * 15;
  return 75 + (w - 13) * (w - 12) * 7.5;
}

export function eigenschaftKostenGesamt(werte: readonly number[]): number {
  return werte.reduce((sum, w) => sum + eigenschaftKosten(w), 0);
}

/** Kosten für Fertigkeiten, Zauber und Liturgien — dieselbe Tabelle. */
export function fertigkeitKosten(
  wert: number,
  spalte: string,
  opts: { aktivieren?: boolean } = {},
): number {
  const faktor = spaltenFaktor(spalte);
  const w = endlich(wert, 'wert');
  let kosten = 0;
  if (w > 0) kosten = w > 11 ? (11 + ((w - 11) * (w - 10)) / 2) * faktor : w * faktor;
  if (opts.aktivieren === true) kosten += faktor;
  return kosten;
}

export function energieKosten(punkte: number): number {
  const p = endlich(punkte, 'punkte');
  if (p <= 0) return 0;
  if (p <= 11) return p * 4;
  return 44 + (p - 11) * (p - 10) * 2;
}
