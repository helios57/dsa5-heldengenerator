/**
 * Der Schritt-Vertrag. Siehe den ausführlichen Kommentar in `wizard/index.ts` — dort steht,
 * wie ein neuer Schritt eingehängt wird. Diese Datei hält nur die Typen, damit sowohl die
 * Schritt-Module als auch die Kanzlei-Hülle (index.ts, stepRail.ts) sie importieren können,
 * ohne einen Laufzeit-Zyklus zwischen index.ts und den einzelnen Schritt-Dateien zu erzeugen.
 */
import type { DatenIndex } from '../../core/apkonto.ts';
import type { Held } from '../../core/character.ts';
import type { Store } from '../../state/store.ts';

export type SchrittKontext = {
  readonly store: Store;
  readonly daten: DatenIndex;
};

export type Schritt = {
  /** Stabiler, nicht lokalisierter Schlüssel, z. B. 'konzept'. Für data-testid/Routing. */
  readonly id: string;
  /** Anzeigename in der Schritt-Leiste (Deutsch). */
  readonly titel: string;
  /**
   * Baut die UI einmalig in `container` auf (der Wizard hat ihn bereits geleert). Darf
   * synchron ein Grundgerüst aufbauen und danach asynchron nachladen (Datensätze etc.) —
   * nie blockierend warten. Gibt eine Aufräumfunktion zurück, die beim Verlassen des
   * Schritts aufgerufen wird (Store-Abos abbestellen, Timer stoppen).
   */
  render(container: HTMLElement, kontext: SchrittKontext): () => void;
  /** Rein lesend: Abschlussstatus für den Punkt in der Schritt-Leiste. */
  istAbgeschlossen(held: Held): boolean;
};
