/**
 * Schritt-Leiste (links) — Schritte I–…, römisch in Gentium gesetzt, mit Abschlussstatus.
 * Reagiert sowohl auf Store-Änderungen (Abschlussstatus kann sich mit jeder Eingabe ändern)
 * als auch auf den aktiven Schritt (von außen über `setAktuellenIndex` gesetzt).
 */
import { el, leeren } from './dom.ts';
import { roemisch } from './format.ts';
import type { Store } from '../state/store.ts';
import type { Schritt } from './wizard/types.ts';

export type StepRailAPI = {
  setAktuellenIndex(index: number): void;
  zerstoeren(): void;
};

export function erzeugeStepRail(
  container: HTMLElement,
  schritte: readonly Schritt[],
  store: Store,
  waehle: (index: number) => void,
): StepRailAPI {
  let aktuellerIndex = 0;

  const render = (): void => {
    const held = store.held();
    const liste = el(
      'ol',
      { class: 'schritt-liste' },
      schritte.map((schritt, index) => {
        const aktiv = index === aktuellerIndex;
        const fertig = schritt.istAbgeschlossen(held);
        const knopf = el(
          'button',
          {
            class: `schritt-knopf${fertig ? ' schritt-knopf--fertig' : ''}`,
            type: 'button',
            'aria-current': aktiv ? 'step' : undefined,
            'data-testid': `schritt-${schritt.id}`,
            onclick: () => waehle(index),
          },
          [
            el('span', { class: 'schritt-knopf__ziffer' }, [roemisch(index + 1)]),
            el('span', { class: 'schritt-knopf__titel' }, [schritt.titel]),
            el('span', { class: 'schritt-knopf__status', 'aria-hidden': 'true' }),
          ],
        );
        return el('li', {}, [knopf]);
      }),
    );
    leeren(container);
    container.append(liste);
  };

  render();
  const abbestellen = store.abonniere(render);

  return {
    setAktuellenIndex(index) {
      aktuellerIndex = index;
      render();
    },
    zerstoeren() {
      abbestellen();
    },
  };
}
