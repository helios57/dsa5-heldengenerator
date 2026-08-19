/**
 * Schritt VIII — Sonderfertigkeiten. Vier Datensätze (`sf_allgemein` 612, `sf_kampf` 357,
 * `sf_magisch` 881, `sf_karmal` 477) — durchsuchbar, nach Datensatz gruppiert, jede Zeile mit
 * Kosten und ihrem echten `Regel`-Text (`erzeugeRegelKarte`). Magisch/Karmal erscheinen nur,
 * wenn der Held eine passende Tradition trägt (`held.traditionMagisch`/`traditionKarmal` —
 * gesetzt in Schritt IX).
 *
 * Kein Datensatz hier trägt ein eigenes `ID`-Feld (anders als Vorteile/Nachteile/Zauber) — die
 * Kennung für `held.sonderfertigkeiten[].id` ist daher `"<datensatz>:<Name divers>"`
 * (z. B. `"sf_kampf:Finte I"`), lokal für diesen Schritt vergeben; das hält die vier Datensätze
 * eindeutig auseinander, ohne den generierten Daten ein Feld anzudichten, das sie nicht haben.
 *
 * AP-Hinweis: `apkonto.ts` weist den Posten "Sonderfertigkeiten" bewusst mit 0 AP aus (siehe
 * Kommentar dort) — die Verdrahtung ins AP-Konto ist nicht Teil dieses Plans und `src/core/`
 * bleibt unangetastet. Die hier gezeigte Kostensumme ist daher rein informativ; ein Hinweis
 * macht das explizit, statt eine falsche Konsistenz mit dem AP-Band vorzutäuschen.
 *
 * DOM-Muster: das Suchfeld ist stabil (nie neu gebaut). Um nie Tausende Zeilen auf einmal zu
 * bauen, werden pro Gruppe nur Suchtreffer gerendert (leere Suche zeigt nur bereits gewählte
 * Sonderfertigkeiten) — zusätzlich pro Gruppe auf 80 Treffer gedeckelt, mit Hinweis statt
 * stillem Abschneiden.
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { erzeugeRegelKarte } from '../../ruleCard.ts';
import { feldStr } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import type { DatensatzName, DatensatzZeile } from '../../../data/loader.ts';
import type { Held, GewaehlteEigenheit } from '../../../core/character.ts';
import type { Schritt } from '../types.ts';

const TREFFER_DECKEL = 80;

type GruppenDef = {
  readonly datensatz: DatensatzName;
  readonly titel: string;
  readonly braucht?: (held: Held) => boolean;
};

const GRUPPEN: readonly GruppenDef[] = [
  { datensatz: 'sf_allgemein', titel: 'Allgemein' },
  { datensatz: 'sf_kampf', titel: 'Kampf' },
  { datensatz: 'sf_magisch', titel: 'Magisch', braucht: (h) => h.traditionMagisch !== null },
  { datensatz: 'sf_karmal', titel: 'Karmal', braucht: (h) => h.traditionKarmal !== null },
];

/** `"10"`, `10`, oder `"4/16"` (mehrstufig) -> Kosten je Stufe, mindestens ein Eintrag. */
function kostenStufen(zeile: DatensatzZeile): readonly number[] {
  const wert = zeile['BasisKosten'];
  if (typeof wert === 'number') return [wert];
  if (typeof wert === 'string') {
    const teile = wert.split('/').map(Number).filter((n) => Number.isFinite(n));
    if (teile.length > 0) return teile;
  }
  return [0];
}

function kostenVon(zeile: DatensatzZeile, gewaehlt: GewaehlteEigenheit | undefined): number {
  const stufen = kostenStufen(zeile);
  const index = Math.min(Math.max((gewaehlt?.stufe ?? 1) - 1, 0), stufen.length - 1);
  return stufen[index] ?? 0;
}

function macheId(datensatz: DatensatzName, zeile: DatensatzZeile): string {
  return `${datensatz}:${feldStr(zeile, 'Name divers')}`;
}

function findeZeileFuerId(
  geladen: ReadonlyMap<DatensatzName, ReadonlyArray<DatensatzZeile>>, id: string,
): DatensatzZeile | undefined {
  for (const def of GRUPPEN) {
    const zeilen = geladen.get(def.datensatz);
    if (zeilen === undefined) continue;
    const treffer = zeilen.find((z) => macheId(def.datensatz, z) === id);
    if (treffer !== undefined) return treffer;
  }
  return undefined;
}

export const schrittSonderfertigkeiten: Schritt = {
  id: 'sonderfertigkeiten',
  titel: 'Sonderfertigkeiten',

  // Keine Sonderfertigkeit ist Pflicht — der Schritt gilt immer als abgeschlossen.
  istAbgeschlossen: () => true,

  render(container, { store }) {
    let suchtext = '';
    const geladen = new Map<DatensatzName, ReadonlyArray<DatensatzZeile>>();

    const suchfeldId = 'sf-suche';
    const suchfeld = el('input', {
      id: suchfeldId, class: 'suchfeld', type: 'search', 'data-testid': 'sf-suche',
      placeholder: 'Sonderfertigkeit suchen …',
      oninput: (ev) => {
        suchtext = (ev.target as HTMLInputElement).value;
        renderInhalt();
      },
    });

    const inhalt = el('div', {});
    const summenZeile = el('p', { class: 'sf-summe zahl', 'data-testid': 'sf-summe' });
    const abschnitt = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Sonderfertigkeiten']),
      el('p', { class: 'abschnitt-untertitel' }, [
        'Allgemeine und Kampf-Sonderfertigkeiten stehen allen offen; Magisch und Karmal ' +
        'erscheinen erst, sobald in Schritt IX eine Tradition gewählt wurde.',
      ]),
      el('label', { class: 'sr-only', for: suchfeldId }, ['Sonderfertigkeit suchen']),
      suchfeld,
      inhalt,
      summenZeile,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    const schalte = (id: string): void => {
      store.setze((h) => {
        const vorhanden = h.sonderfertigkeiten.some((e) => e.id === id);
        return {
          ...h,
          sonderfertigkeiten: vorhanden
            ? h.sonderfertigkeiten.filter((e) => e.id !== id)
            : [...h.sonderfertigkeiten, { id }],
        };
      });
    };

    const setzeStufe = (id: string, stufe: number): void => {
      store.setze((h) => ({
        ...h,
        sonderfertigkeiten: h.sonderfertigkeiten.map((e) => (e.id === id ? { ...e, stufe } : e)),
      }));
    };

    function baueZeile(datensatz: DatensatzName, zeile: DatensatzZeile, gewaehlt: GewaehlteEigenheit | undefined): HTMLElement {
      const id = macheId(datensatz, zeile);
      const name = feldStr(zeile, 'Name divers');
      const stufen = kostenStufen(zeile);
      const istGewaehlt = gewaehlt !== undefined;

      const stufenAuswahl = stufen.length > 1
        ? el('select', {
          class: 'sf-stufe', 'aria-label': `Stufe von ${name}`,
          'data-testid': `sf-stufe-${id}`,
          disabled: !istGewaehlt,
          onchange: (ev) => setzeStufe(id, Number((ev.target as HTMLSelectElement).value)),
        }, stufen.map((kosten, i) =>
          el('option', { value: i + 1, selected: (gewaehlt?.stufe ?? 1) === i + 1 }, [`Stufe ${i + 1} (${kosten} AP)`]),
        ))
        : null;

      return el('li', { class: 'sf-zeile' }, [
        el('div', { class: 'sf-zeile__kopf' }, [
          el('button', {
            type: 'button',
            class: `auswahl-zeile${istGewaehlt ? ' auswahl-zeile--gewaehlt' : ''}`,
            'aria-pressed': istGewaehlt,
            'data-testid': `sf-${id}`,
            onclick: () => schalte(id),
          }, [
            el('span', { class: 'auswahl-zeile__name' }, [name]),
            el('span', { class: 'auswahl-zeile__ap zahl' }, [`${kostenVon(zeile, gewaehlt)} AP`]),
          ]),
          stufenAuswahl,
        ]),
        el('details', { class: 'sf-details' }, [
          el('summary', {}, ['Regel ansehen']),
          erzeugeRegelKarte(name, feldStr(zeile, 'Regel')),
        ]),
      ]);
    }

    function baueGruppe(def: GruppenDef, held: Held): HTMLElement | null {
      const zeilen = geladen.get(def.datensatz);
      if (zeilen === undefined) return null;
      if (def.braucht !== undefined && !def.braucht(held)) return null;

      const suche = suchtext.trim().toLowerCase();
      const gewaehlteIds = new Set(held.sonderfertigkeiten.map((e) => e.id));

      const passend = zeilen.filter((zeile) => {
        const id = macheId(def.datensatz, zeile);
        if (suche === '') return gewaehlteIds.has(id);
        return feldStr(zeile, 'Name divers').toLowerCase().includes(suche);
      });

      if (passend.length === 0) return null;

      const gedeckelt = passend.slice(0, TREFFER_DECKEL);
      const zeilenElemente = gedeckelt.map((zeile) => {
        const id = macheId(def.datensatz, zeile);
        return baueZeile(def.datensatz, zeile, held.sonderfertigkeiten.find((e) => e.id === id));
      });

      return el('div', { class: 'sf-gruppe' }, [
        el('h3', { class: 'unterabschnitt-titel' }, [`${def.titel} (${passend.length})`]),
        el('ul', { class: 'sf-liste', 'data-testid': `sf-gruppe-${def.datensatz}` }, zeilenElemente),
        passend.length > TREFFER_DECKEL
          ? el('p', { class: 'leere-liste-hinweis' }, [
            `${passend.length - TREFFER_DECKEL} weitere Treffer nicht angezeigt — Suche weiter eingrenzen.`,
          ])
          : null,
      ]);
    }

    const renderInhalt = (): void => {
      leeren(inhalt);
      const held = store.held();
      const gruppen = GRUPPEN.map((def) => baueGruppe(def, held)).filter((g): g is HTMLElement => g !== null);

      if (gruppen.length === 0) {
        inhalt.append(el('p', { class: 'leere-liste-hinweis' }, [
          suchtext.trim() === ''
            ? 'Noch keine Sonderfertigkeiten gewählt — tippe oben, um zu suchen.'
            : 'Keine Sonderfertigkeit gefunden.',
        ]));
      } else {
        inhalt.append(...gruppen);
      }

      const gesamtKosten = held.sonderfertigkeiten.reduce((summe, gewaehlt) => {
        const zeile = findeZeileFuerId(geladen, gewaehlt.id);
        return summe + (zeile !== undefined ? kostenVon(zeile, gewaehlt) : 0);
      }, 0);

      leeren(summenZeile);
      summenZeile.append(
        `${held.sonderfertigkeiten.length} gewählt · ${gesamtKosten} AP `,
        el('span', { class: 'sf-summe__hinweis' }, [
          '(noch nicht im AP-Konto oben enthalten — bitte beim Restbudget selbst einplanen)',
        ]),
      );
    };

    renderInhalt();
    const abbestellen = store.abonniere(renderInhalt);

    void Promise.all(GRUPPEN.map((def) => ladeDatensatz(def.datensatz).then((zeilen) => {
      geladen.set(def.datensatz, zeilen);
      renderInhalt();
    })));

    return () => abbestellen();
  },
};
