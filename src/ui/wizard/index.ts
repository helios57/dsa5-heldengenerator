/**
 * Der DSA5-Heldenerschaffungs-Wizard — Kanzlei-Hülle.
 *
 * ============================================================================
 * SCHRITT-VERTRAG — bitte lesen, bevor ein neuer Schritt (V–XII) ergänzt wird.
 * ============================================================================
 *
 * Ein Schritt ist EIN Objekt vom Typ `Schritt` (siehe `./types.ts`):
 *
 *   export type Schritt = {
 *     id: string;                                          // stabil, z. B. 'vorteile'
 *     titel: string;                                        // Deutsch, für die Leiste
 *     render(container: HTMLElement, ctx: SchrittKontext): () => void;
 *     istAbgeschlossen(held: Held): boolean;
 *   };
 *
 * Konventionen (siehe steps/konzept.ts, steps/spezies.ts, steps/kultur.ts,
 * steps/eigenschaften.ts als Referenzimplementierungen):
 *
 *   - Eine Datei pro Schritt unter `src/ui/wizard/steps/`, exportiert genau EIN
 *     `Schritt`-Objekt (benannter Export, z. B. `schrittVorteile`).
 *   - `render()` baut die UI in `container` auf (der Wizard hat ihn bereits geleert —
 *     selbst nicht nochmal leeren). Oberste Abschnitte über `anhaengenGestaffelt()`
 *     (src/ui/dom.ts) einhängen, das liefert die ~40-ms-gestaffelte Enthüllung aus dem
 *     Entwurf gratis mit.
 *   - `render()` MUSS synchron ein Grundgerüst aufbauen; Datensätze (via
 *     `ladeDatensatz()`/`baueDatenIndex()`) dürfen danach asynchron nachgeladen werden,
 *     aber der Container darf nie blockierend auf ein Promise warten.
 *   - `render()` abonniert bei Bedarf `ctx.store` für Live-Updates (AP-Kosten, Marginalien,
 *     Basiswerte ändern sich mit jeder Eingabe) und MUSS die zurückgegebene
 *     Abbestell-Funktion in der eigenen Aufräumfunktion aufrufen — sonst leckt das Abo über
 *     einen Schrittwechsel hinaus.
 *   - Zustand gehört in `held`, NIE in Modul-globale Variablen (der Schritt kann jederzeit
 *     neu gemountet werden). Ausnahme: rein UI-lokaler, nicht persistenter Zustand wie ein
 *     Such-/Filtertext darf in einer Closure innerhalb von `render()` leben.
 *   - Ruling R13 (siehe character.ts/limits.ts): Eigenschafts-bezogene Schritte validieren
 *     IMMER `held.eigenschaftenGekauft` (gekauft), zeigen aber `eigenschaftenFinal()` an.
 *     Nie das Ergebnis von `eigenschaftenFinal` an `pruefeEigenschaften` übergeben.
 *   - Deckel anzeigen? Über `src/ui/marginale.ts` (`erzeugeMarginale`, `begrenzungstext`,
 *     `erzeugePulsWaechter`) — nicht neu erfinden. `maxFertigkeit`/`maxKampftechnik`/
 *     `maxZauber` liefern bereits `{ wert, grund }`, `begrenzungstext()` übersetzt das in
 *     den Marginalien-Satz.
 *   - Regel-Text aus einem Datensatz zeigen (Vorteile/Nachteile/Sonderfertigkeiten haben ein
 *     `Regel`-Feld)? `src/ui/ruleCard.ts` (`erzeugeRegelKarte`) verwenden, nicht neu bauen.
 *
 * Einhängen: neue Datei unter `steps/` anlegen, hier importieren und an der gewünschten
 * Position in `SCHRITTE` einfügen. Die römische Nummerierung und die Schritt-Leiste ergeben
 * sich automatisch aus der Position in diesem Array — sonst ist an der Hülle nichts
 * anzufassen.
 */
import { leeren } from '../dom.ts';
import { erzeugeAPBand } from '../apBand.ts';
import { erzeugeBasiswertePanel } from '../basiswerte.ts';
import { erzeugeStepRail } from '../stepRail.ts';
import { schrittKonzept } from './steps/konzept.ts';
import { schrittSpezies } from './steps/spezies.ts';
import { schrittKultur } from './steps/kultur.ts';
import { schrittEigenschaften } from './steps/eigenschaften.ts';
import { schrittProfession } from './steps/profession.ts';
import { schrittVorNachteile } from './steps/vorNachteile.ts';
import { schrittFertigkeiten } from './steps/fertigkeiten.ts';
import { schrittSonderfertigkeiten } from './steps/sonderfertigkeiten.ts';
import { schrittMagieKarma } from './steps/magieKarma.ts';
import { schrittAusruestung } from './steps/ausruestung.ts';
import { schrittDetails } from './steps/details.ts';
import { schrittAbschluss } from './steps/abschluss.ts';
import type { Schritt, SchrittKontext } from './types.ts';
import type { Store } from '../../state/store.ts';
import type { DatenIndex } from '../../core/apkonto.ts';

export const SCHRITTE: readonly Schritt[] = [
  schrittKonzept,
  schrittSpezies,
  schrittKultur,
  schrittEigenschaften,
  schrittProfession,
  schrittVorNachteile,
  schrittFertigkeiten,
  schrittSonderfertigkeiten,
  schrittMagieKarma,
  schrittAusruestung,
  schrittDetails,
  schrittAbschluss,
];

export type WizardElemente = {
  readonly apBand: HTMLElement;
  readonly rail: HTMLElement;
  readonly inhalt: HTMLElement;
  readonly basiswerte: HTMLElement;
};

/** Baut die Kanzlei-Hülle in bereits vorhandene Container (siehe app/index.html). */
export function starteWizard(elemente: WizardElemente, store: Store, daten: DatenIndex): () => void {
  const kontext: SchrittKontext = { store, daten };
  let schrittAufraeumen: (() => void) | null = null;

  const apBandAufraeumen = erzeugeAPBand(elemente.apBand, store, daten);
  const basiswerteAufraeumen = erzeugeBasiswertePanel(elemente.basiswerte, store);

  const zeigeSchritt = (index: number): void => {
    const schritt = SCHRITTE[index];
    if (schritt === undefined) return;
    if (schrittAufraeumen !== null) {
      schrittAufraeumen();
      schrittAufraeumen = null;
    }
    rail.setAktuellenIndex(index);
    leeren(elemente.inhalt);
    schrittAufraeumen = schritt.render(elemente.inhalt, kontext);
    elemente.inhalt.focus();
  };

  const rail = erzeugeStepRail(elemente.rail, SCHRITTE, store, (index) => zeigeSchritt(index));

  zeigeSchritt(0);

  return () => {
    if (schrittAufraeumen !== null) schrittAufraeumen();
    rail.zerstoeren();
    apBandAufraeumen();
    basiswerteAufraeumen();
  };
}
