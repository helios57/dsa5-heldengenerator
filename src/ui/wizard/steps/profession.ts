/**
 * Schritt V — Profession. 952 Professionen sind als Rohliste unbrauchbar — Suche und Filter
 * (Typ, Werk, AP-Kosten) laufen daher IMMER auf dem bereits geladenen Array, bevor überhaupt
 * ein DOM-Knoten gebaut wird; gebaut wird zusätzlich nur eine Seite (siehe `SEITE_GROESSE`),
 * ein "weitere anzeigen"-Knopf lädt in 40er-Schritten nach.
 *
 * Eine Wahl setzt `held.profession` (der Schlüssel ist `Name divers` — Professionen haben
 * weder `ID` noch ein gender-neutrales `Name`-Feld, siehe data/loader.ts) und wendet SOFORT
 * das Talent- und Kampftechnik-Paket auf `held.fertigkeiten`/`held.kampftechniken` an, sowie
 * — falls die Profession eine `Tradition` in `SFMagie`/`SFKarma` trägt — `traditionMagisch`/
 * `traditionKarmal`. Zauber, Liturgien und Sonderfertigkeiten werden nur als Vorschau gezeigt:
 * ihre Zuteilung (mit Punktevergabe, Voraussetzungsprüfung etc.) ist Sache der späteren
 * Schritte. Ein erneuter Klick auf die bereits gewählte Profession ist ein No-op (verhindert,
 * dass spätere Handanpassungen in Schritt VII beim bloßen Wiederanschauen verworfen werden).
 *
 * Kampftechnik-Paketwerte sind ZUSCHLÄGE auf den Startwert 6 (nicht der Endwert selbst) — im
 * Rohdatensatz z. B. Achazschamane -> Kampftechnik ["Hiebwaffen", 5] bedeutet Hiebwaffen 6+5=11.
 * Talent-Paketwerte sind dagegen bereits Endwerte (Fertigkeiten starten bei 0).
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { feldStr, feldStrArr, feldStrPaare, feldNamenWerte, summeGesamt } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import { KAMPFTECHNIK_START } from '../../../core/limits.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { Schritt } from '../types.ts';

const SEITE_GROESSE = 40;

type ProfessionZeile = {
  readonly zeile: DatensatzZeile;
  readonly name: string;
  readonly nameSuche: string;
  readonly typ: string;
  readonly werke: readonly string[];
  readonly apGesamt: number;
  readonly slugId: string;
};

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

type PaketEintrag = { readonly name: string; readonly hinweis: string };

/**
 * Liest ein Paket-Feld unabhängig von seiner Form: flache Name/Wert-Folgen (Talent,
 * Kampftechnik, Zauber, Liturgie), flache reine Namenslisten (SFKampf) und Paare aus
 * Name + Zusatz (SFAllgemein, SFMagie, SFKarma, Sprache) landen alle in derselben Form. Rein
 * für die Anzeige gedacht (die tatsächliche Übernahme ins `held` nutzt für Talent/Kampftechnik
 * weiterhin `feldNamenWerte`, das strikt numerische Werte verlangt).
 */
function paketEintraege(zeile: DatensatzZeile, feld: string): readonly PaketEintrag[] {
  const wert = zeile[feld];
  if (!Array.isArray(wert)) return [];
  const ergebnis: PaketEintrag[] = [];
  let i = 0;
  while (i < wert.length) {
    const eintrag: unknown = wert[i];
    if (typeof eintrag === 'string') {
      const naechster: unknown = wert[i + 1];
      if (typeof naechster === 'number') {
        ergebnis.push({ name: eintrag, hinweis: `+${naechster}` });
        i += 2;
        continue;
      }
      ergebnis.push({ name: eintrag, hinweis: '' });
      i += 1;
      continue;
    }
    if (Array.isArray(eintrag) && eintrag.length === 2 && typeof eintrag[0] === 'string') {
      const zweite: unknown = eintrag[1];
      ergebnis.push({ name: eintrag[0], hinweis: typeof zweite === 'string' && zweite !== '' ? zweite : '' });
    }
    i += 1;
  }
  return ergebnis;
}

/** Sucht den `["Tradition", "<Name>"]`-Eintrag in SFMagie/SFKarma, falls vorhanden. */
function traditionAus(zeile: DatensatzZeile, feld: 'SFMagie' | 'SFKarma'): string | null {
  for (const [name, wert] of feldStrPaare(zeile, feld)) {
    if (name === 'Tradition' && wert !== '') return wert;
  }
  return null;
}

type Paket = {
  readonly fertigkeiten: Record<string, number>;
  readonly kampftechniken: Record<string, number>;
  readonly traditionMagisch: string | null;
  readonly traditionKarmal: string | null;
};

function wendePaketAn(zeile: DatensatzZeile, talenteIdNachName: ReadonlyMap<string, string>): Paket {
  const fertigkeiten: Record<string, number> = {};
  for (const { name, wert } of feldNamenWerte(zeile, 'Talent')) {
    const id = talenteIdNachName.get(name);
    if (id !== undefined) fertigkeiten[id] = wert;
  }
  const kampftechniken: Record<string, number> = {};
  for (const { name, wert } of feldNamenWerte(zeile, 'Kampftechnik')) {
    kampftechniken[name] = KAMPFTECHNIK_START + wert;
  }
  return {
    fertigkeiten,
    kampftechniken,
    traditionMagisch: traditionAus(zeile, 'SFMagie'),
    traditionKarmal: traditionAus(zeile, 'SFKarma'),
  };
}

function bauePaketAbschnitt(titel: string, eintraege: readonly PaketEintrag[]): HTMLElement | null {
  if (eintraege.length === 0) return null;
  return el('details', { class: 'kultur-details' }, [
    el('summary', {}, [`${titel} (${eintraege.length})`]),
    el(
      'ul',
      { class: 'paket-liste' },
      eintraege.map((e) => el('li', {}, [el('span', {}, [e.name]), e.hinweis === '' ? null : el('span', { class: 'zahl' }, [e.hinweis])])),
    ),
  ]);
}

function bauePaketVorschau(zeile: DatensatzZeile): HTMLElement {
  const abschnitte = [
    bauePaketAbschnitt('Talente', paketEintraege(zeile, 'Talent')),
    bauePaketAbschnitt('Kampftechniken', paketEintraege(zeile, 'Kampftechnik')),
    bauePaketAbschnitt('Zauber', paketEintraege(zeile, 'Zauber')),
    bauePaketAbschnitt('Liturgien', paketEintraege(zeile, 'Liturgie')),
    bauePaketAbschnitt('Allgemeine Sonderfertigkeiten', paketEintraege(zeile, 'SFAllgemein')),
    bauePaketAbschnitt('Kampf-Sonderfertigkeiten', paketEintraege(zeile, 'SFKampf')),
    bauePaketAbschnitt('Magische Sonderfertigkeiten', paketEintraege(zeile, 'SFMagie')),
    bauePaketAbschnitt('Karmale Sonderfertigkeiten', paketEintraege(zeile, 'SFKarma')),
    bauePaketAbschnitt('Sprachen & Schriften', paketEintraege(zeile, 'Sprache')),
  ].filter((abschnitt): abschnitt is HTMLElement => abschnitt !== null);
  return el('div', { class: 'profession-paket', 'data-testid': 'profession-paket' }, [
    ...abschnitte,
    abschnitte.length === 0 ? el('p', { class: 'leere-liste-hinweis' }, ['Kein Paket hinterlegt.']) : null,
  ]);
}

export const schrittProfession: Schritt = {
  id: 'profession',
  titel: 'Profession',

  istAbgeschlossen: (held) => held.profession !== null,

  render(container, { store }) {
    let professionZeilen: readonly ProfessionZeile[] | null = null;
    let talenteIdNachName: ReadonlyMap<string, string> | null = null;

    let suchtext = '';
    let typFilter = '';
    let werkFilter = '';
    let apMin: number | null = null;
    let apMax: number | null = null;
    let sichtbarAnzahl = SEITE_GROESSE;

    const zuruecksetzenUndNeuZeichnen = (): void => {
      sichtbarAnzahl = SEITE_GROESSE;
      renderInhalt();
    };

    const suchfeld = el('input', {
      class: 'suchfeld', type: 'search', 'data-testid': 'profession-suche',
      placeholder: 'Profession suchen …',
      oninput: (ev) => {
        suchtext = (ev.target as HTMLInputElement).value;
        zuruecksetzenUndNeuZeichnen();
      },
    });

    const typSelect = el('select', {
      'data-testid': 'profession-typ', 'aria-label': 'Nach Typ filtern',
      onchange: (ev) => {
        typFilter = (ev.target as HTMLSelectElement).value;
        zuruecksetzenUndNeuZeichnen();
      },
    }, [el('option', { value: '' }, ['Alle Typen'])]);

    const werkSelect = el('select', {
      'data-testid': 'profession-werk', 'aria-label': 'Nach Werk filtern',
      onchange: (ev) => {
        werkFilter = (ev.target as HTMLSelectElement).value;
        zuruecksetzenUndNeuZeichnen();
      },
    }, [el('option', { value: '' }, ['Alle Werke'])]);

    const parseZahlOderNull = (text: string): number | null => {
      if (text.trim() === '') return null;
      const zahl = Number(text);
      return Number.isFinite(zahl) ? zahl : null;
    };

    const apMinFeld = el('input', {
      type: 'number', inputmode: 'numeric', class: 'stepper-feld', placeholder: 'min',
      'data-testid': 'profession-ap-min', 'aria-label': 'AP-Kosten mindestens',
      oninput: (ev) => { apMin = parseZahlOderNull((ev.target as HTMLInputElement).value); zuruecksetzenUndNeuZeichnen(); },
    });
    const apMaxFeld = el('input', {
      type: 'number', inputmode: 'numeric', class: 'stepper-feld', placeholder: 'max',
      'data-testid': 'profession-ap-max', 'aria-label': 'AP-Kosten höchstens',
      oninput: (ev) => { apMax = parseZahlOderNull((ev.target as HTMLInputElement).value); zuruecksetzenUndNeuZeichnen(); },
    });

    const filterzeile = el('div', { class: 'filterzeile' }, [
      el('div', { class: 'filterzeile__feld filterzeile__feld--wachsend' }, [
        el('label', { class: 'sr-only', for: 'profession-suche' }, ['Profession suchen']),
        suchfeld,
      ]),
      el('div', { class: 'filterzeile__feld' }, [typSelect]),
      el('div', { class: 'filterzeile__feld' }, [werkSelect]),
      el('div', { class: 'filterzeile__feld filterzeile__feld--ap' }, [
        el('span', { class: 'filterzeile__label' }, ['AP']),
        apMinFeld,
        el('span', {}, ['–']),
        apMaxFeld,
      ]),
    ]);

    const anzahlAnzeige = el('p', { class: 'ergebnis-anzahl', 'data-testid': 'profession-anzahl' });
    const inhalt = el('div', {});

    const abschnitt = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Profession']),
      el('p', { class: 'abschnitt-untertitel' }, [
        'Bestimmt AP-Kosten und das mitgebrachte Fertigkeits- und Kampftechnik-Paket. Zauber, ' +
        'Liturgien und Sonderfertigkeiten der Profession werden hier nur angezeigt — ihre ' +
        'Vergabe folgt in späteren Schritten.',
      ]),
      filterzeile,
      anzahlAnzeige,
      inhalt,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    const waehleProfession = (p: ProfessionZeile): void => {
      const talente = talenteIdNachName;
      if (talente === null) return;
      store.setze((h) => {
        if (h.profession === p.name) return h;
        const paket = wendePaketAn(p.zeile, talente);
        return {
          ...h,
          profession: p.name,
          fertigkeiten: paket.fertigkeiten,
          kampftechniken: paket.kampftechniken,
          traditionMagisch: paket.traditionMagisch,
          traditionKarmal: paket.traditionKarmal,
        };
      });
    };

    function passtFilter(p: ProfessionZeile): boolean {
      if (suchtext.trim() !== '' && !p.nameSuche.includes(suchtext.trim().toLowerCase())) return false;
      if (typFilter !== '' && p.typ !== typFilter) return false;
      if (werkFilter !== '' && !p.werke.includes(werkFilter)) return false;
      if (apMin !== null && p.apGesamt < apMin) return false;
      if (apMax !== null && p.apGesamt > apMax) return false;
      return true;
    }

    function renderInhalt(): void {
      leeren(inhalt);
      if (professionZeilen === null) {
        anzahlAnzeige.textContent = '';
        inhalt.append(el('p', { class: 'leere-liste-hinweis' }, ['Professionen laden …']));
        return;
      }

      const held = store.held();
      const gefiltert = professionZeilen.filter(passtFilter);
      anzahlAnzeige.textContent = `${gefiltert.length} von ${professionZeilen.length} Professionen`;

      const sichtbare = gefiltert.slice(0, sichtbarAnzahl);
      const zeilenElemente = sichtbare.map((p) => {
        const gewaehlt = held.profession === p.name;
        return el('li', {}, [
          el('button', {
            type: 'button',
            class: `auswahl-zeile${gewaehlt ? ' auswahl-zeile--gewaehlt' : ''}`,
            'data-testid': `profession-${p.slugId}`,
            'aria-pressed': gewaehlt,
            onclick: () => waehleProfession(p),
          }, [
            el('span', { class: 'auswahl-zeile__name' }, [p.name]),
            el('span', { class: 'auswahl-zeile__ap zahl' }, [`${p.apGesamt} AP`]),
            el('span', { class: 'auswahl-zeile__mods' }, [`${p.typ} · ${p.werke.join(', ')}`]),
          ]),
          gewaehlt ? bauePaketVorschau(p.zeile) : null,
        ]);
      });

      inhalt.append(el('ul', { class: 'auswahl-liste', 'data-testid': 'profession-liste' },
        zeilenElemente.length > 0
          ? zeilenElemente
          : [el('li', {}, [el('p', { class: 'leere-liste-hinweis' }, ['Keine Profession gefunden.'])])],
      ));

      if (gefiltert.length > sichtbare.length) {
        inhalt.append(el('button', {
          type: 'button', class: 'mehr-knopf', 'data-testid': 'profession-mehr',
          onclick: () => { sichtbarAnzahl += SEITE_GROESSE; renderInhalt(); },
        }, [`Weitere anzeigen (noch ${gefiltert.length - sichtbare.length})`]));
      }
    }

    renderInhalt();
    const abbestellen = store.abonniere(renderInhalt);

    void Promise.all([ladeDatensatz('professionen'), ladeDatensatz('talente')]).then(([professionen, talente]) => {
      talenteIdNachName = new Map(talente.map((z) => [feldStr(z, 'Name'), feldStr(z, 'ID')]));

      professionZeilen = professionen.map((zeile) => {
        const name = feldStr(zeile, 'Name divers');
        const nameM = feldStr(zeile, 'Name männlich');
        const nameW = feldStr(zeile, 'Name weiblich');
        return {
          zeile,
          name,
          nameSuche: `${name} ${nameM} ${nameW}`.toLowerCase(),
          typ: feldStr(zeile, 'Typ'),
          werke: feldStrArr(zeile, 'Werke'),
          apGesamt: summeGesamt(feldStr(zeile, 'Gesamt')),
          slugId: slug(name),
        };
      });

      const typOptionen = [...new Set(professionZeilen.map((p) => p.typ))].filter((t) => t !== '').sort((a, b) => a.localeCompare(b, 'de'));
      for (const typ of typOptionen) typSelect.append(el('option', { value: typ }, [typ]));

      const werkOptionen = [...new Set(professionZeilen.flatMap((p) => p.werke))].sort((a, b) => a.localeCompare(b, 'de'));
      for (const werk of werkOptionen) werkSelect.append(el('option', { value: werk }, [werk]));

      renderInhalt();
    });

    return () => abbestellen();
  },
};
