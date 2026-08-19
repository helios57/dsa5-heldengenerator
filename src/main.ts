/**
 * Einstiegspunkt: baut den `Store` (aus Autosave, wenn vorhanden), lädt den `DatenIndex`
 * fürs AP-Konto, und startet den Wizard in das in app/index.html vorgegebene Grundgerüst.
 */
import { erzeugeStore, ladeGespeicherten } from './state/store.ts';
import { leererHeld } from './core/character.ts';
import { baueDatenIndex } from './data/loader.ts';
import { starteWizard } from './ui/wizard/index.ts';

function pflichtElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Grundgerüst-Element #${id} fehlt in app/index.html.`);
  return element;
}

async function starte(): Promise<void> {
  const elemente = {
    apBand: pflichtElement('ap-band'),
    rail: pflichtElement('step-rail'),
    inhalt: pflichtElement('step-content'),
    basiswerte: pflichtElement('basiswerte-panel'),
  };

  const gespeicherterHeld = ladeGespeicherten();
  const store = erzeugeStore(gespeicherterHeld ?? leererHeld());
  const daten = await baueDatenIndex();

  starteWizard(elemente, store, daten);

  const statusAnzeige = document.querySelector<HTMLElement>('#status');
  if (statusAnzeige !== null) statusAnzeige.textContent = 'bereit';
}

void starte().catch((fehler: unknown) => {
  console.error('DSA5 Heldengenerator konnte nicht gestartet werden:', fehler);
  const statusAnzeige = document.querySelector<HTMLElement>('#status');
  if (statusAnzeige !== null) statusAnzeige.textContent = 'Fehler beim Start.';
});
