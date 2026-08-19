/**
 * Schritt III — Kultur. Die Liste ist strikt auf die Kulturen gefiltert, die
 * `spezies.Kulturen` für die in Schritt II gewählte Spezies zulässt. Ohne gewählte Spezies
 * gibt es keine gültige Filterung — dann erscheint ein Hinweis statt einer (irreführenden)
 * ungefilterten Liste aller 57 Kulturen.
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { feldStr, feldStrArr, feldNamenWerte, findeZeile, summeGesamt } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { Schritt } from '../types.ts';

function bauePaketDetails(zeile: DatensatzZeile): HTMLElement {
  const talente = feldNamenWerte(zeile, 'Talent');
  return el('details', { class: 'kultur-details' }, [
    el('summary', {}, [`Fertigkeitspaket ansehen (${talente.length})`]),
    el('ul', { class: 'paket-liste' }, talente.map((t) =>
      el('li', {}, [el('span', {}, [t.name]), el('span', { class: 'zahl' }, [`+${t.wert}`])]),
    )),
  ]);
}

export const schrittKultur: Schritt = {
  id: 'kultur',
  titel: 'Kultur',

  istAbgeschlossen: (held) => held.kultur !== null,

  render(container, { store }) {
    let speziesZeilen: ReadonlyArray<DatensatzZeile> | null = null;
    let kulturZeilen: ReadonlyArray<DatensatzZeile> | null = null;

    const inhalt = el('div', {});
    const abschnitt = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Kultur']),
      el('p', { class: 'abschnitt-untertitel' }, [
        'Nur Kulturen, die die gewählte Spezies zulässt. Jede bringt ein festes Fertigkeitspaket mit.',
      ]),
      inhalt,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    const waehleKultur = (id: string): void => {
      store.setze((h) => (h.kultur === id ? h : { ...h, kultur: id }));
    };

    const renderInhalt = (): void => {
      leeren(inhalt);
      if (speziesZeilen === null || kulturZeilen === null) {
        inhalt.append(el('p', { class: 'leere-liste-hinweis' }, ['Datensätze laden …']));
        return;
      }

      const held = store.held();
      if (held.spezies === null) {
        inhalt.append(el('p', { class: 'leere-liste-hinweis', 'data-testid': 'kultur-ohne-spezies' }, [
          'Bitte zuerst in Schritt II eine Spezies wählen — sie bestimmt, welche Kulturen zur Auswahl stehen.',
        ]));
        return;
      }

      const speziesZeile = findeZeile(speziesZeilen, 'ID', held.spezies);
      const erlaubteIds = speziesZeile === undefined ? [] : feldStrArr(speziesZeile, 'Kulturen');
      const erlaubt = kulturZeilen.filter((zeile) => erlaubteIds.includes(feldStr(zeile, 'ID')));

      if (erlaubt.length === 0) {
        inhalt.append(el('p', { class: 'leere-liste-hinweis' }, ['Für diese Spezies ist keine Kultur hinterlegt.']));
        return;
      }

      const zeilenElemente = erlaubt.map((zeile) => {
        const id = feldStr(zeile, 'ID');
        const gewaehlt = held.kultur === id;
        return el('li', {}, [
          el('button', {
            type: 'button',
            class: `auswahl-zeile${gewaehlt ? ' auswahl-zeile--gewaehlt' : ''}`,
            'data-testid': `kultur-${id}`,
            'aria-pressed': gewaehlt,
            onclick: () => waehleKultur(id),
          }, [
            el('span', { class: 'auswahl-zeile__name' }, [feldStr(zeile, 'Name Plural')]),
            el('span', { class: 'auswahl-zeile__ap zahl' }, [`${summeGesamt(feldStr(zeile, 'Gesamt'))} AP`]),
          ]),
          gewaehlt ? bauePaketDetails(zeile) : null,
        ]);
      });

      inhalt.append(el('ul', { class: 'auswahl-liste', 'data-testid': 'kultur-liste' }, zeilenElemente));
    };

    renderInhalt();
    const abbestellen = store.abonniere(renderInhalt);

    void Promise.all([ladeDatensatz('spezies'), ladeDatensatz('kulturen')]).then(([spezies, kulturen]) => {
      speziesZeilen = spezies;
      kulturZeilen = kulturen;
      renderInhalt();
    });

    return () => abbestellen();
  },
};
