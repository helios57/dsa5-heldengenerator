/**
 * Marginalien — das Signaturdetail des Produkts.
 *
 * Wenn ein Wert gedeckelt ist, wird das NICHT nur durch ein deaktiviertes Bedienelement
 * gezeigt, sondern durch eine Randnotiz (kursives Gentium), die benennt, WELCHE Regel greift
 * — z. B. „begrenzt durch KL 13 +2" statt „begrenzt durch Erfahrungsgrad 10". `maxFertigkeit`,
 * `maxKampftechnik` und `maxZauber` (src/core/limits.ts) liefern dafür bereits `{ wert, grund }`
 * — `begrenzungstext()` übersetzt ein solches `Limit` in genau diesen Satz.
 *
 * Zwei Ausprägungen:
 *   - 'info'       — ein Deckel greift, aber es liegt (noch) kein Regelverstoß vor (z. B. der
 *                     Steller ist exakt am Maximum, weiter erhöhen ist einfach nicht möglich).
 *                     Bronze-Gold-Randlinie, keine Animation.
 *   - 'verletzung' — ein tatsächlicher Regelverstoß (ein `Problem` aus limits.ts greift).
 *                     Oxblood, und beim ERSTEN Erscheinen ein einmaliger Puls (steuerbar über
 *                     `gesehen`, siehe unten) — `prefers-reduced-motion` schaltet ihn ab.
 */
import { el } from './dom.ts';
import type { Limit } from '../core/types.ts';
import type { Erfahrungsgrad } from '../core/experience.ts';

export type MarginaleArt = 'info' | 'verletzung';

export function erzeugeMarginale(
  text: string,
  art: MarginaleArt,
  optionen: { gepulst?: boolean } = {},
): HTMLElement {
  const klassen = ['marginale', `marginale--${art}`];
  if (art === 'verletzung' && optionen.gepulst === true) klassen.push('puls');
  return el('p', { class: klassen.join(' ') }, [text]);
}

/**
 * Hilft künftigen Schritten (Fertigkeiten, Kampftechniken, Zauber — V ff.), ein `Limit` aus
 * limits.ts in einen Marginalien-Satz zu übersetzen. `eigenschaftHinweis` sollte die
 * konkrete Eigenschaft + Wert benennen (z. B. "KL 13"), wenn `grund === 'eigenschaft'` —
 * ohne sie bleibt der Satz generisch.
 */
export function begrenzungstext(
  limit: Limit,
  grad: Erfahrungsgrad,
  eigenschaftHinweis?: string,
): string {
  switch (limit.grund) {
    case 'eigenschaft':
      return `begrenzt durch ${eigenschaftHinweis ?? 'die Leiteigenschaft'} +2 (max ${limit.wert})`;
    case 'erfahrungsgrad':
      return `begrenzt durch Erfahrungsgrad ${grad.name} (max ${limit.wert})`;
    case 'zauberobergrenze':
      return `begrenzt durch die Zauberobergrenze (max ${limit.wert})`;
  }
}

/**
 * Merkt sich pro Schritt-Einstieg, welche Marginalien-Schlüssel bereits einmal gepulst
 * haben, damit „einmal pulsen" nicht bei jedem Tastendruck erneut auslöst. Jedes Schritt-
 * Modul erzeugt beim `render()`-Aufruf eine frische Instanz.
 */
export function erzeugePulsWaechter(): { istErstesErscheinen(schluessel: string): boolean } {
  const gesehen = new Set<string>();
  return {
    /** true beim ersten Aufruf für `schluessel` (→ jetzt pulsen), danach immer false. */
    istErstesErscheinen(schluessel: string): boolean {
      if (gesehen.has(schluessel)) return false;
      gesehen.add(schluessel);
      return true;
    },
  };
}
