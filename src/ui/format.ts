/** Kleine Formatierungshelfer für die UI-Schicht (keine Geschäftslogik). */

const ROEMISCH_TABELLE: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Wandelt eine positive Ganzzahl (1-basiert, wie Schritt-Nummern) in eine römische Ziffer. */
export function roemisch(zahl: number): string {
  if (!Number.isInteger(zahl) || zahl <= 0) {
    throw new Error(`roemisch() erwartet eine positive Ganzzahl, erhielt: ${zahl}`);
  }
  let rest = zahl;
  let ergebnis = '';
  for (const [wert, zeichen] of ROEMISCH_TABELLE) {
    while (rest >= wert) {
      ergebnis += zeichen;
      rest -= wert;
    }
  }
  return ergebnis;
}

/** Ganzzahl mit erzwungenem Vorzeichen, z. B. für Eigenschafts-Modifikatoren ("+1", "−2"). */
export function mitVorzeichen(wert: number): string {
  if (wert === 0) return '±0';
  // Halbgeviertstrich (−) statt Bindestrich, passend zum Ledger-Schriftbild.
  return wert > 0 ? `+${wert}` : `−${Math.abs(wert)}`;
}
