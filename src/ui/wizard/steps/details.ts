/**
 * Schritt XI — Details. Freitextfelder für alles, was der Bogen unter "Persönliche Daten"
 * kennt (`held.meta`) — Alter, Größe und Gewicht sind explizit FREI wählbar (DSA5 erlaubt das
 * ausdrücklich), bekommen hier aber einen gewürfelten Vorschlag aus der Spezies-Zeile als
 * Hilfe: `spezies.Alter` trägt sieben Einträge (einer je Erfahrungsgrad, Basis + Würfel),
 * `Größe`/`Gewicht` je einen Eintrag (Basis + Würfel). Gewicht hängt zusätzlich von der
 * (gewürfelten oder eingetragenen) Größe ab — daher braucht "Gewicht würfeln" eine gültige
 * Zahl im Größe-Feld.
 *
 * DOM-Muster: jedes Textfeld wird EINMAL gebaut (stabile Elemente, `onchange` statt `oninput`,
 * wie in konzept.ts) — nur die Würfel-Vorschläge werden bei Bedarf neu gezeichnet.
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { feldStr, findeZeile } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import { ERFAHRUNGSGRADE } from '../../../core/experience.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { Held } from '../../../core/character.ts';
import type { Store } from '../../../state/store.ts';
import type { Schritt } from '../types.ts';

const FELDER: ReadonlyArray<{ readonly feld: keyof Held['meta']; readonly label: string }> = [
  { feld: 'name', label: 'Name' },
  { feld: 'familie', label: 'Familie' },
  { feld: 'geburtsort', label: 'Geburtsort' },
  { feld: 'geburtsdatum', label: 'Geburtsdatum' },
  { feld: 'geschlecht', label: 'Geschlecht' },
  { feld: 'titel', label: 'Titel' },
  { feld: 'sozialstatus', label: 'Sozialstatus' },
  { feld: 'haarfarbe', label: 'Haarfarbe' },
  { feld: 'augenfarbe', label: 'Augenfarbe' },
];

function wuerfeln(anzahl: number, seiten: number): number {
  let summe = 0;
  for (let i = 0; i < anzahl; i += 1) summe += 1 + Math.floor(Math.random() * seiten);
  return summe;
}

/** `["12", ["1", "3"]]` -> Basis 12 + 1W3. Zweites Element ist immer [Anzahl, Seiten]. */
function wuerfleEinfach(eintrag: unknown): number | null {
  if (!Array.isArray(eintrag) || eintrag.length !== 2) return null;
  const [basisRoh, wuerfelRoh] = eintrag as unknown as readonly [unknown, unknown];
  const basis = Number(basisRoh);
  if (!Array.isArray(wuerfelRoh) || wuerfelRoh.length !== 2) return null;
  const [anzahlRoh, seitenRoh] = wuerfelRoh as unknown as readonly [unknown, unknown];
  const anzahl = Number(anzahlRoh);
  const seiten = Number(seitenRoh);
  if (![basis, anzahl, seiten].every(Number.isFinite)) return null;
  return basis + wuerfeln(anzahl, seiten);
}

/**
 * `["-100", ["#", "2", "6"]]` -> Basis -100 + die aktuelle Größe (cm) + 2W6. Das erste Element
 * der Würfel-Angabe ist bei `Gewicht` immer ein nicht-numerisches Platzhalterzeichen (`#`/`-`/
 * `+`, je nach Spezies) — es steht für "addiere die Größe", nicht für eine weitere Würfelzahl;
 * die drei- statt zweielementige Form unterscheidet `Gewicht` strukturell von `Alter`/`Größe`.
 */
function wuerfleGewicht(eintrag: unknown, groesseCm: number): number | null {
  if (!Array.isArray(eintrag) || eintrag.length !== 2) return null;
  const [basisRoh, wuerfelRoh] = eintrag as unknown as readonly [unknown, unknown];
  const basis = Number(basisRoh);
  if (!Array.isArray(wuerfelRoh) || wuerfelRoh.length !== 3) return null;
  const [, anzahlRoh, seitenRoh] = wuerfelRoh as unknown as readonly [unknown, unknown, unknown];
  const anzahl = Number(anzahlRoh);
  const seiten = Number(seitenRoh);
  if (![basis, anzahl, seiten].every(Number.isFinite)) return null;
  return basis + groesseCm + wuerfeln(anzahl, seiten);
}

function baueTextfeld(
  feld: keyof Held['meta'], label: string, anfangswert: string, setze: (wert: string) => void,
): HTMLElement {
  const feldId = `details-${feld}`;
  return el('div', { class: 'details-feld' }, [
    el('label', { class: 'feld-label', for: feldId }, [label]),
    el('input', {
      id: feldId, type: 'text', class: 'suchfeld', 'data-testid': feldId,
      value: anfangswert,
      onchange: (ev) => setze((ev.target as HTMLInputElement).value),
    }),
  ]);
}

function baueVorschlagsfeld(
  feld: 'alter' | 'groesse' | 'gewicht', label: string, held: Held, store: Store,
  vorschlagen: () => number | null,
): HTMLElement {
  const feldId = `details-${feld}`;
  const setze = (wert: string): void => {
    store.setze((h) => ({ ...h, meta: { ...h.meta, [feld]: wert } }));
  };
  const vorschlagSlot = el('span', { class: 'details-vorschlag', 'data-testid': `details-${feld}-vorschlag` });

  const eingabe = el('input', {
    id: feldId, type: 'text', class: 'suchfeld', 'data-testid': feldId,
    value: held.meta[feld],
    onchange: (ev) => setze((ev.target as HTMLInputElement).value),
  });

  const wuerfelKnopf = el('button', {
    type: 'button', class: 'stepper-knopf details-wuerfeln', 'data-testid': `details-${feld}-wuerfeln`,
    'aria-label': `${label} würfeln`,
    onclick: () => {
      const ergebnis = vorschlagen();
      leeren(vorschlagSlot);
      if (ergebnis === null) {
        vorschlagSlot.append('kein Vorschlag möglich');
        return;
      }
      vorschlagSlot.append(
        `Vorschlag: ${ergebnis} `,
        el('button', {
          type: 'button', class: 'schritt-knopf', 'data-testid': `details-${feld}-uebernehmen`,
          onclick: () => { eingabe.value = String(ergebnis); setze(String(ergebnis)); },
        }, ['übernehmen']),
      );
    },
  }, ['🎲']);

  return el('div', { class: 'details-feld' }, [
    el('label', { class: 'feld-label', for: feldId }, [label]),
    el('div', { class: 'eigenschaft-steuerung' }, [eingabe, wuerfelKnopf]),
    vorschlagSlot,
  ]);
}

export const schrittDetails: Schritt = {
  id: 'details',
  titel: 'Details',

  istAbgeschlossen: (held) => held.meta.name.trim().length > 0,

  render(container, { store }) {
    let speziesZeilen: ReadonlyArray<DatensatzZeile> | null = null;

    const held = store.held();

    const setzeMeta = (feld: keyof Held['meta']) => (wert: string): void => {
      store.setze((h) => ({ ...h, meta: { ...h.meta, [feld]: wert } }));
    };

    const grundFelder = FELDER.map(({ feld, label }) =>
      baueTextfeld(feld, label, held.meta[feld], setzeMeta(feld)));

    const vorschlagSlot = el('div', { class: 'details-raster' });

    const renderVorschlaege = (): void => {
      leeren(vorschlagSlot);
      const aktuell = store.held();
      const speziesZeile = speziesZeilen !== null && aktuell.spezies !== null
        ? findeZeile(speziesZeilen, 'ID', aktuell.spezies) : undefined;
      const gradIndex = ERFAHRUNGSGRADE.findIndex((g) => g.id === aktuell.erfahrungsgrad);

      const alterEintrag = speziesZeile !== undefined && Array.isArray(speziesZeile['Alter']) && gradIndex >= 0
        ? (speziesZeile['Alter'] as unknown[])[gradIndex]
        : undefined;
      const groesseEintrag = speziesZeile?.['Größe'];
      const gewichtEintrag = speziesZeile?.['Gewicht'];

      vorschlagSlot.append(
        baueVorschlagsfeld('alter', 'Alter', aktuell, store, () =>
          alterEintrag !== undefined ? wuerfleEinfach(alterEintrag) : null),
        baueVorschlagsfeld('groesse', 'Größe (cm)', aktuell, store, () =>
          groesseEintrag !== undefined ? wuerfleEinfach(groesseEintrag) : null),
        baueVorschlagsfeld('gewicht', 'Gewicht (kg)', aktuell, store, () => {
          const groesseCm = Number(aktuell.meta.groesse);
          if (gewichtEintrag === undefined || !Number.isFinite(groesseCm)) return null;
          return wuerfleGewicht(gewichtEintrag, groesseCm);
        }),
      );

      if (speziesZeile === undefined) {
        vorschlagSlot.append(el('p', { class: 'leere-liste-hinweis' }, [
          'Ohne gewählte Spezies (Schritt II) gibt es keinen gewürfelten Vorschlag — freie Eingabe bleibt möglich.',
        ]));
      }
    };

    const charakteristikaFeld = el('div', { class: 'details-feld details-feld--breit' }, [
      el('label', { class: 'feld-label', for: 'details-charakteristika' }, ['Charakteristika']),
      el('textarea', {
        id: 'details-charakteristika', class: 'konzept-text', 'data-testid': 'details-charakteristika',
        onchange: (ev) => setzeMeta('charakteristika')((ev.target as HTMLTextAreaElement).value),
      }, [held.meta.charakteristika]),
    ]);
    const notizenFeld = el('div', { class: 'details-feld details-feld--breit' }, [
      el('label', { class: 'feld-label', for: 'details-sonstiges' }, ['Anmerkungen']),
      el('textarea', {
        id: 'details-sonstiges', class: 'konzept-text', 'data-testid': 'details-sonstiges',
        onchange: (ev) => setzeMeta('sonstiges')((ev.target as HTMLTextAreaElement).value),
      }, [held.meta.sonstiges]),
    ]);

    const abschnitt = el('section', { class: 'abschnitt abschnitt--breit' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Details']),
      el('p', { class: 'abschnitt-untertitel' }, [
        'Persönliche Daten. Alter, Größe und Gewicht dürfen frei gewählt werden — der Würfel-' +
        'Vorschlag ist nur eine Hilfe.',
      ]),
      el('div', { class: 'details-raster' }, grundFelder),
      vorschlagSlot,
      charakteristikaFeld,
      notizenFeld,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    renderVorschlaege();

    void ladeDatensatz('spezies').then((zeilen) => {
      speziesZeilen = zeilen;
      renderVorschlaege();
    });

    return () => {};
  },
};
