/**
 * AP-Budgetband — die volle Bandbreite oben, immer sichtbar. Eine dünne, waagerechte
 * Ledger-Linie, die sich mit dem Verbrauch füllt; bei Überschreitung schlägt sie in Oxblood
 * um. Rechnet bei jeder Störung des `Store` live über `apKonto` neu.
 */
import { el, leeren } from './dom.ts';
import { apKonto } from '../core/apkonto.ts';
import type { DatenIndex } from '../core/apkonto.ts';
import type { Store } from '../state/store.ts';

export function erzeugeAPBand(container: HTMLElement, store: Store, daten: DatenIndex): () => void {
  container.classList.add('ap-band');

  const render = (): void => {
    const konto = apKonto(store.held(), daten);
    const ueberzogen = konto.rest < 0;
    container.classList.toggle('ap-band--ueberzogen', ueberzogen);

    const anteil = konto.budget > 0 ? Math.min(100, (konto.ausgegeben / konto.budget) * 100) : 0;

    leeren(container);
    container.append(
      el('div', { class: 'ap-band__zeile' }, [
        el('span', { class: 'ap-band__label' }, ['AP-Konto']),
        el('span', { class: 'ap-band__werte' }, [
          el('span', { class: 'zahl', 'data-testid': 'ap-ausgegeben' }, [String(konto.ausgegeben)]),
          ' / ',
          el('span', { class: 'zahl', 'data-testid': 'ap-budget' }, [String(konto.budget)]),
          ' verbraucht · ',
          el('span', { class: 'zahl', 'data-testid': 'ap-rest' }, [String(konto.rest)]),
          ' verbleibend',
        ]),
      ]),
      el(
        'div',
        {
          class: 'ap-band__lauf', role: 'progressbar',
          'aria-valuemin': 0, 'aria-valuemax': konto.budget, 'aria-valuenow': konto.ausgegeben,
          'aria-label': 'Verbrauchte Abenteuerpunkte',
        },
        [el('div', { class: 'ap-band__fuellung', style: `width: ${anteil}%` })],
      ),
    );
  };

  render();
  return store.abonniere(render);
}
