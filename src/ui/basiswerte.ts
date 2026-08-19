/**
 * Basiswerte-Panel — rechts, immer sichtbar. Rechnet LE/SK/ZK/AW/INI/GS bei jeder Störung
 * live neu. Das ist genau das, was der Papierbogen mühsam macht: hier ist es müheloses
 * Nachschlagen. Grundwerte (LE/SK/ZK/GS) kommen aus der gewählten Spezies-Zeile — vor der
 * Spezieswahl wird mit 0 gerechnet und ein Hinweis eingeblendet.
 */
import { el, leeren, anhaengen } from './dom.ts';
import { basiswerte } from '../core/derived.ts';
import { eigenschaftenFinal } from '../core/character.ts';
import { ladeDatensatz } from '../data/loader.ts';
import { findeZeile, feldNum } from './rohdaten.ts';
import type { DatensatzZeile } from '../data/loader.ts';
import type { Store } from '../state/store.ts';
import type { Grundwerte } from '../core/types.ts';

function eintrag(kuerzel: string, wert: number): HTMLElement {
  return el('div', { class: 'basiswerte-eintrag' }, [
    el('dt', {}, [kuerzel]),
    el('dd', { class: 'zahl', 'data-testid': `basiswert-${kuerzel}` }, [String(wert)]),
  ]);
}

export function erzeugeBasiswertePanel(container: HTMLElement, store: Store): () => void {
  let speziesZeilen: ReadonlyArray<DatensatzZeile> | null = null;
  let lebendig = true;

  const render = (): void => {
    const held = store.held();
    const zeile = speziesZeilen !== null && held.spezies !== null
      ? findeZeile(speziesZeilen, 'ID', held.spezies)
      : undefined;

    const grundwerte: Grundwerte = zeile === undefined
      ? { le: 0, sk: 0, zk: 0, gs: 0 }
      : { le: feldNum(zeile, 'LE'), sk: feldNum(zeile, 'SK'), zk: feldNum(zeile, 'ZK'), gs: feldNum(zeile, 'GS') };

    const final = eigenschaftenFinal(held, zeile?.['EW']);
    const werte = basiswerte(grundwerte, final);

    leeren(container);
    anhaengen(container, [
      el('h2', { class: 'panel-titel' }, ['Basiswerte']),
      el('dl', { class: 'basiswerte-liste' }, [
        eintrag('LE', werte.LE),
        eintrag('SK', werte.SK),
        eintrag('ZK', werte.ZK),
        eintrag('AW', werte.AW),
        eintrag('INI', werte.INI),
        eintrag('GS', werte.GS),
      ]),
      zeile === undefined
        ? el('p', { class: 'basiswerte-hinweis' }, ['Vorläufig ohne Spezies berechnet.'])
        : null,
    ]);
  };

  render();
  const abbestellen = store.abonniere(render);

  void ladeDatensatz('spezies').then((zeilen) => {
    if (!lebendig) return;
    speziesZeilen = zeilen;
    render();
  });

  return () => {
    lebendig = false;
    abbestellen();
  };
}
