/**
 * Schritt II — Spezies. Durchsuchbare Liste aller 47 Spezies mit AP-Kosten, Eigenschafts-
 * Modifikatoren und Basiswerten. Eine verschachtelte `EW`-Wahlgruppe (z. B. „KL −2 ODER
 * KK −2") wird als echtes Entweder/Oder gerendert — die Auswahl schreibt `speziesAbzug`.
 * Automatisch gewährte Vor-/Nachteile erscheinen als Regelkarten mit ihrem echten `Regel`-Text.
 *
 * DOM-Muster: Suchfeld ist ein stabiles Element (nie neu gebaut, sonst geht der Fokus bei
 * jedem Tastendruck verloren); nur der Listen-/Detail-Container darunter wird bei jeder
 * Store- oder Sucheingabe-Änderung neu gezeichnet (Klick-Interaktionen, kein Tippen).
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { erzeugeRegelKarte, erzeugeRegelKartenGruppe } from '../../ruleCard.ts';
import { mitVorzeichen } from '../../format.ts';
import { feldStr, feldNum, feldStrPaare, findeZeile } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { EigenschaftName } from '../../../core/types.ts';
import type { Schritt } from '../types.ts';

const EIG_ID_ZU_NAME: Readonly<Record<string, EigenschaftName>> = Object.freeze({
  Eig1: 'MU', Eig2: 'KL', Eig3: 'IN', Eig4: 'CH', Eig5: 'FF', Eig6: 'GE', Eig7: 'KO', Eig8: 'KK',
});

type EwEintrag = { readonly name: EigenschaftName; readonly delta: number };
type EwAnalyse = { readonly fest: readonly EwEintrag[]; readonly wahl: readonly EwEintrag[] | null };

function istEwPaar(wert: unknown): wert is readonly [string, number] {
  return Array.isArray(wert) && wert.length === 2 && typeof wert[0] === 'string' && typeof wert[1] === 'number';
}

/** Zerlegt `spezies.EW` in feste Modifikatoren und (höchstens) eine Wahlgruppe. Rein für
 *  die Anzeige/Bedienung dieses Schritts — die tatsächliche Wertermittlung bleibt
 *  `speziesModifikatoren` in character.ts vorbehalten. */
function analysiereEW(ew: unknown): EwAnalyse {
  const fest: EwEintrag[] = [];
  let wahl: EwEintrag[] | null = null;
  if (!Array.isArray(ew)) return { fest, wahl };
  const eintraege: readonly unknown[] = ew;
  for (const eintrag of eintraege) {
    if (istEwPaar(eintrag)) {
      const name = EIG_ID_ZU_NAME[eintrag[0]];
      if (name !== undefined) fest.push({ name, delta: eintrag[1] });
      continue;
    }
    if (!Array.isArray(eintrag)) continue;
    const optionen: readonly unknown[] = eintrag;
    const ausgewertet: EwEintrag[] = [];
    for (const option of optionen) {
      if (!istEwPaar(option)) continue;
      const name = EIG_ID_ZU_NAME[option[0]];
      if (name !== undefined) ausgewertet.push({ name, delta: option[1] });
    }
    if (ausgewertet.length > 0) wahl = ausgewertet;
  }
  return { fest, wahl };
}

function formatiereEwEintrag(eintrag: EwEintrag): string {
  return `${eintrag.name} ${mitVorzeichen(eintrag.delta)}`;
}

function beschreibeModifikatoren(analyse: EwAnalyse): string {
  const teile = analyse.fest.map(formatiereEwEintrag);
  if (analyse.wahl !== null) teile.push(analyse.wahl.map(formatiereEwEintrag).join(' oder '));
  return teile.length > 0 ? teile.join(' · ') : 'keine Eigenschafts-Modifikatoren';
}

export const schrittSpezies: Schritt = {
  id: 'spezies',
  titel: 'Spezies',

  // Eine unaufgelöste EW-Wahlgruppe lässt sich hier nicht prüfen (istAbgeschlossen bekommt
  // nur `held`, nicht den geladenen Spezies-Datensatz) — "abgeschlossen" heißt daher nur
  // "eine Spezies ist gewählt", nicht zwingend "alle ihre Wahlpflichten sind aufgelöst".
  istAbgeschlossen: (held) => held.spezies !== null,

  render(container, { store }) {
    let suchtext = '';
    let speziesZeilen: ReadonlyArray<DatensatzZeile> | null = null;
    let vorteilZeilen: ReadonlyArray<DatensatzZeile> | null = null;
    let nachteilZeilen: ReadonlyArray<DatensatzZeile> | null = null;

    const suchfeldId = 'spezies-suche';
    const suchfeld = el('input', {
      id: suchfeldId, class: 'suchfeld', type: 'search', 'data-testid': 'spezies-suche',
      placeholder: 'Spezies suchen …',
      oninput: (ev) => {
        suchtext = (ev.target as HTMLInputElement).value;
        renderInhalt();
      },
    });

    const inhalt = el('div', {});
    const abschnitt = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Spezies']),
      el('p', { class: 'abschnitt-untertitel' }, [
        'Bestimmt AP-Kosten, Eigenschafts-Modifikatoren und die möglichen Kulturen.',
      ]),
      el('label', { class: 'sr-only', for: suchfeldId }, ['Spezies suchen']),
      suchfeld,
      inhalt,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    const waehleSpezies = (id: string): void => {
      store.setze((h) => (
        h.spezies === id ? h : { ...h, spezies: id, speziesAbzug: null, kultur: null }
      ));
    };

    const waehleAbzug = (name: EigenschaftName): void => {
      store.setze((h) => ({ ...h, speziesAbzug: name }));
    };

    const renderInhalt = (): void => {
      leeren(inhalt);
      if (speziesZeilen === null) {
        inhalt.append(el('p', { class: 'leere-liste-hinweis' }, ['Spezies-Datensatz lädt …']));
        return;
      }

      const held = store.held();
      const suche = suchtext.trim().toLowerCase();
      const gefiltert = speziesZeilen.filter((zeile) => {
        if (suche === '') return true;
        const name = feldStr(zeile, 'Name divers').toLowerCase();
        const namePlural = feldStr(zeile, 'Name Plural').toLowerCase();
        return name.includes(suche) || namePlural.includes(suche);
      });

      const zeilenElemente = gefiltert.map((zeile) => {
        const id = feldStr(zeile, 'ID');
        const gewaehlt = held.spezies === id;
        const analyse = analysiereEW(zeile['EW']);
        return el('li', {}, [
          el('button', {
            type: 'button',
            class: `auswahl-zeile${gewaehlt ? ' auswahl-zeile--gewaehlt' : ''}`,
            'data-testid': `spezies-${id}`,
            'aria-pressed': gewaehlt,
            onclick: () => waehleSpezies(id),
          }, [
            el('span', { class: 'auswahl-zeile__name' }, [feldStr(zeile, 'Name divers')]),
            el('span', { class: 'auswahl-zeile__ap zahl' }, [`${mitVorzeichen(feldNum(zeile, 'AP'))} AP`]),
            el('span', { class: 'auswahl-zeile__mods' }, [beschreibeModifikatoren(analyse)]),
          ]),
        ]);
      });

      inhalt.append(el('ul', { class: 'auswahl-liste', 'data-testid': 'spezies-liste' },
        zeilenElemente.length > 0
          ? zeilenElemente
          : [el('li', {}, [el('p', { class: 'leere-liste-hinweis' }, ['Keine Spezies gefunden.'])])],
      ));

      if (held.spezies === null) return;
      const gewaehlteZeile = findeZeile(speziesZeilen, 'ID', held.spezies);
      if (gewaehlteZeile === undefined) return;

      const analyse = analysiereEW(gewaehlteZeile['EW']);
      if (analyse.wahl !== null) {
        const wahl = analyse.wahl;
        inhalt.append(el('div', { class: 'ewwahl', 'data-testid': 'spezies-ewwahl' }, [
          el('span', { class: 'ewwahl__hinweis' }, ['Eigenschafts-Abzug wählen (Pflicht):']),
          ...wahl.map((option) => {
            const radioId = `spezies-abzug-${option.name}`;
            return el('label', { for: radioId }, [
              el('input', {
                type: 'radio', name: 'spezies-abzug', id: radioId, value: option.name,
                checked: held.speziesAbzug === option.name,
                'data-testid': `spezies-abzug-${option.name}`,
                onchange: () => waehleAbzug(option.name),
              }),
              ` ${formatiereEwEintrag(option)}`,
            ]);
          }),
        ]));
      }

      if (vorteilZeilen !== null && nachteilZeilen !== null) {
        const karten = [
          ...feldStrPaare(gewaehlteZeile, 'Vorteil').map(([id]) => {
            const eintrag = findeZeile(vorteilZeilen ?? [], 'ID', id);
            return eintrag === undefined ? null : erzeugeRegelKarte(feldStr(eintrag, 'Name divers'), feldStr(eintrag, 'Regel'));
          }),
          ...feldStrPaare(gewaehlteZeile, 'Nachteil').map(([id]) => {
            const eintrag = findeZeile(nachteilZeilen ?? [], 'ID', id);
            return eintrag === undefined ? null : erzeugeRegelKarte(feldStr(eintrag, 'Name divers'), feldStr(eintrag, 'Regel'));
          }),
        ].filter((karte): karte is HTMLElement => karte !== null);

        if (karten.length > 0) {
          inhalt.append(
            el('h3', { class: 'unterabschnitt-titel' }, ['Automatisch gewährt']),
            erzeugeRegelKartenGruppe(karten),
          );
        }
      }
    };

    renderInhalt();
    const abbestellen = store.abonniere(renderInhalt);

    void Promise.all([
      ladeDatensatz('spezies'), ladeDatensatz('vorteile'), ladeDatensatz('nachteile'),
    ]).then(([spezies, vorteile, nachteile]) => {
      speziesZeilen = spezies;
      vorteilZeilen = vorteile;
      nachteilZeilen = nachteile;
      renderInhalt();
    });

    return () => abbestellen();
  },
};
