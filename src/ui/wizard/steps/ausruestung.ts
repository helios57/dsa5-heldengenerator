/**
 * Schritt X — Ausrüstung. 3309 Gegenstände (`app/data/ausruestung.json`: `Name`, `Wert` in
 * Silbertaler, `Gewicht` in Stein — beide im deutschen Komma-Format, `feldKommaZahl` liest
 * sie), gruppiert über `Typ`. KEIN eigenes `ID`-Feld im Datensatz — `Name` ist eindeutig
 * (geprüft: 3309 von 3309 Namen sind es) und dient als `held.ausruestung[].id`.
 *
 * 3309 Zeilen werden NIE ungefiltert gebaut: ohne Suchtext zeigt die Liste nur das bereits
 * Gekaufte; mit Suchtext nur Treffer, zusätzlich auf `TREFFER_DECKEL` begrenzt. Laufende
 * Summen (Gewicht, Wert) stehen unten; `held.geld` bleibt ein frei editierbares Feld (die
 * Anschaffungskosten werden bewusst NICHT automatisch abgezogen — das Held-Modell speichert
 * nur den *aktuellen* Bestand, keinen separaten "Startbudget"-Wert, und DSA5s Start-Geld hängt
 * vom Sozialstatus ab, den dieser Schritt nicht kennt).
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { feldStr, feldStrArr, feldKommaZahl } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { Held } from '../../../core/character.ts';
import type { Schritt } from '../types.ts';

const TREFFER_DECKEL = 100;

function formatKomma(zahl: number): string {
  return zahl.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

function findeZeileNachName(zeilen: ReadonlyArray<DatensatzZeile>, name: string): DatensatzZeile | undefined {
  return zeilen.find((z) => feldStr(z, 'Name') === name);
}

export const schrittAusruestung: Schritt = {
  id: 'ausruestung',
  titel: 'Ausrüstung',

  // Ausrüstung ist frei — kein Pflichtinventar in DSA5. Der Schritt gilt immer als abgeschlossen.
  istAbgeschlossen: () => true,

  render(container, { store }) {
    let suchtext = '';
    let gruppenFilter = '';
    let zeilen: ReadonlyArray<DatensatzZeile> | null = null;

    const suchfeldId = 'ausruestung-suche';
    const suchfeld = el('input', {
      id: suchfeldId, class: 'suchfeld', type: 'search', 'data-testid': 'ausruestung-suche',
      placeholder: 'Ausrüstung suchen …',
      oninput: (ev) => { suchtext = (ev.target as HTMLInputElement).value; renderInhalt(); },
    });
    const gruppenAuswahl = el('select', {
      class: 'suchfeld', 'data-testid': 'ausruestung-gruppe', 'aria-label': 'Warengruppe filtern',
      onchange: (ev) => { gruppenFilter = (ev.target as HTMLSelectElement).value; renderInhalt(); },
    }, [el('option', { value: '' }, ['Alle Warengruppen'])]);

    const bestandListe = el('ul', { class: 'auswahl-liste', 'data-testid': 'ausruestung-bestand' });
    const trefferListe = el('ul', { class: 'auswahl-liste', 'data-testid': 'ausruestung-treffer' });
    const trefferHinweis = el('p', { class: 'leere-liste-hinweis' });
    const summenZeile = el('div', { class: 'sf-summe' });
    const geldZeile = el('div', { class: 'geld-zeile' });

    const abschnitt = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Ausrüstung']),
      el('p', { class: 'abschnitt-untertitel' }, [
        'Gewicht in Stein, Wert in Silbertaler. Das mitgeführte Geld unten ist frei editierbar.',
      ]),
      el('h3', { class: 'unterabschnitt-titel' }, ['Bestand']),
      bestandListe,
      summenZeile,
      el('h3', { class: 'unterabschnitt-titel' }, ['Geld']),
      geldZeile,
      el('h3', { class: 'unterabschnitt-titel' }, ['Hinzufügen']),
      el('div', { class: 'ausruestung-filter' }, [
        el('label', { class: 'sr-only', for: suchfeldId }, ['Ausrüstung suchen']),
        suchfeld,
        gruppenAuswahl,
      ]),
      trefferListe,
      trefferHinweis,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    const aendereAnzahl = (id: string, delta: number): void => {
      store.setze((h) => {
        const bestehend = h.ausruestung.find((a) => a.id === id);
        const neueAnzahl = (bestehend?.anzahl ?? 0) + delta;
        if (neueAnzahl <= 0) {
          return { ...h, ausruestung: h.ausruestung.filter((a) => a.id !== id) };
        }
        if (bestehend === undefined) {
          return { ...h, ausruestung: [...h.ausruestung, { id, anzahl: neueAnzahl }] };
        }
        return {
          ...h,
          ausruestung: h.ausruestung.map((a) => (a.id === id ? { ...a, anzahl: neueAnzahl } : a)),
        };
      });
    };

    const setzeGeld = (feld: keyof Held['geld'], wert: number): void => {
      const begrenzt = Math.max(0, Math.round(wert));
      store.setze((h) => ({ ...h, geld: { ...h.geld, [feld]: begrenzt } }));
    };

    function baueBestandZeile(id: string, anzahl: number): HTMLElement {
      const zeile = zeilen !== null ? findeZeileNachName(zeilen, id) : undefined;
      const wert = zeile !== undefined ? feldKommaZahl(zeile, 'Wert') : 0;
      const gewicht = zeile !== undefined ? feldKommaZahl(zeile, 'Gewicht') : 0;
      return el('li', { class: 'ausruestung-zeile', 'data-testid': `ausruestung-bestand-${id}` }, [
        el('span', { class: 'auswahl-zeile__name' }, [id]),
        el('span', { class: 'zahl' }, [`${formatKomma(gewicht * anzahl)} Stein`]),
        el('span', { class: 'zahl' }, [`${formatKomma(wert * anzahl)} S`]),
        el('div', { class: 'eigenschaft-steuerung' }, [
          el('button', {
            class: 'stepper-knopf', type: 'button', 'aria-label': `${id} verringern`,
            onclick: () => aendereAnzahl(id, -1),
          }, ['−']),
          el('span', { class: 'zahl', 'data-testid': `ausruestung-anzahl-${id}` }, [String(anzahl)]),
          el('button', {
            class: 'stepper-knopf', type: 'button', 'aria-label': `${id} erhöhen`,
            onclick: () => aendereAnzahl(id, 1),
          }, ['+']),
        ]),
      ]);
    }

    function baueTrefferZeile(zeile: DatensatzZeile): HTMLElement {
      const name = feldStr(zeile, 'Name');
      const wert = feldKommaZahl(zeile, 'Wert');
      const gewicht = feldKommaZahl(zeile, 'Gewicht');
      return el('li', {}, [
        el('button', {
          type: 'button', class: 'auswahl-zeile', 'data-testid': `ausruestung-${name}`,
          onclick: () => aendereAnzahl(name, 1),
        }, [
          el('span', { class: 'auswahl-zeile__name' }, [name]),
          el('span', { class: 'auswahl-zeile__ap zahl' }, [`${formatKomma(gewicht)} St.`]),
          el('span', { class: 'auswahl-zeile__ap zahl' }, [`${formatKomma(wert)} S`]),
        ]),
      ]);
    }

    const renderInhalt = (): void => {
      const held = store.held();

      leeren(bestandListe);
      if (held.ausruestung.length === 0) {
        bestandListe.append(el('li', {}, [el('p', { class: 'leere-liste-hinweis' }, ['Noch nichts im Bestand.'])]));
      } else {
        bestandListe.append(...held.ausruestung.map((a) => baueBestandZeile(a.id, a.anzahl)));
      }

      let gesamtGewicht = 0;
      let gesamtWert = 0;
      if (zeilen !== null) {
        for (const eintrag of held.ausruestung) {
          const zeile = findeZeileNachName(zeilen, eintrag.id);
          if (zeile === undefined) continue;
          gesamtGewicht += feldKommaZahl(zeile, 'Gewicht') * eintrag.anzahl;
          gesamtWert += feldKommaZahl(zeile, 'Wert') * eintrag.anzahl;
        }
      }
      leeren(summenZeile);
      summenZeile.append(
        el('span', { class: 'zahl', 'data-testid': 'ausruestung-gesamtgewicht' }, [`${formatKomma(gesamtGewicht)} Stein`]),
        el('span', { class: 'zahl', 'data-testid': 'ausruestung-gesamtwert' }, [`${formatKomma(gesamtWert)} S`]),
      );

      leeren(geldZeile);
      const geldFelder: ReadonlyArray<readonly [keyof Held['geld'], string]> = [
        ['dukaten', 'D'], ['silbertaler', 'S'], ['heller', 'H'], ['kreuzer', 'K'],
      ];
      geldZeile.append(...geldFelder.map(([feld, kuerzel]) =>
        el('label', { class: 'geld-feld' }, [
          kuerzel,
          el('input', {
            type: 'number', inputmode: 'numeric', min: 0, class: 'stepper-feld zahl',
            'data-testid': `geld-${feld}`,
            value: held.geld[feld],
            onchange: (ev) => {
              const w = Number((ev.target as HTMLInputElement).value);
              if (Number.isFinite(w)) setzeGeld(feld, w);
            },
          }),
        ]),
      ));

      leeren(trefferListe);
      leeren(trefferHinweis);
      if (zeilen === null) {
        trefferHinweis.append('Ausrüstungsdaten laden …');
        return;
      }

      const suche = suchtext.trim().toLowerCase();
      if (suche === '') {
        trefferHinweis.append('Tippe oben, um in 3309 Gegenständen zu suchen.');
        return;
      }

      const passend = zeilen.filter((z) => {
        if (!feldStr(z, 'Name').toLowerCase().includes(suche)) return false;
        if (gruppenFilter === '') return true;
        return feldStrArr(z, 'Typ').includes(gruppenFilter);
      });

      if (passend.length === 0) {
        trefferHinweis.append('Nichts gefunden.');
        return;
      }

      trefferListe.append(...passend.slice(0, TREFFER_DECKEL).map(baueTrefferZeile));
      if (passend.length > TREFFER_DECKEL) {
        trefferHinweis.append(`${passend.length - TREFFER_DECKEL} weitere Treffer nicht angezeigt — Suche weiter eingrenzen.`);
      }
    };

    renderInhalt();
    const abbestellen = store.abonniere(renderInhalt);

    void ladeDatensatz('ausruestung').then((geladen) => {
      zeilen = geladen;
      const gruppen = new Set<string>();
      for (const z of geladen) for (const t of feldStrArr(z, 'Typ')) gruppen.add(t);
      gruppenAuswahl.append(...[...gruppen].sort().map((g) => el('option', { value: g }, [g])));
      renderInhalt();
    });

    return () => abbestellen();
  },
};
