/**
 * Schritt IX — Magie und Karma.
 *
 * Der Schritt-Vertrag erlaubt keine bedingte Ein-/Ausblendung in der Schritt-Leiste (die Länge
 * und Reihenfolge von `SCHRITTE` ist fix, siehe wizard/index.ts) — "nur sichtbar, wenn
 * `held.traditionMagisch`/`traditionKarmal` gesetzt ist" gilt daher für den INHALT dieses
 * Schritts, nicht für seinen Platz in der Leiste: Ohne gewählte Tradition zeigt der Schritt
 * einen Tradition-Wähler (alle 62 Traditionen, DSA5 kennt keine Bindung an eine bestimmte
 * Profession — die Vorteile "Zauberer"/"Geweihter" sind die eigentliche Voraussetzung, siehe
 * die "Voraussetzungen"-Zeilen in sf_magisch/sf_karmal). Erst NACHDEM eine Tradition gewählt
 * wurde (welche exakt `held.traditionMagisch`/`traditionKarmal` setzt), erscheint die Zauber-
 * bzw. Liturgie-Auswahl darunter — das ist die hier gemeinte Bedingung.
 *
 * Zwei praktisch identische Hälften (Magie/Zauber, Karma/Liturgien) — eine gemeinsame
 * `baueTraditionsAbschnitt()` mit einer kleinen Konfiguration hält beide DRY, statt ~150
 * Zeilen zu duplizieren.
 *
 * Erschaffungsgrenzen (Spec, Ruling siehe limits.ts):
 *   - Anzahl gekaufter Sprüche: `grad.zauberAnzahl` (8–20 je Erfahrungsgrad).
 *   - Davon aus FREMDER Tradition (Traditionen-Feld enthält NICHT das gewählte `Kurz`):
 *     `grad.fremdzauber` (0–6).
 *   - Der FW-Deckel je Spruch ist NICHT dieselbe Zahl — er kommt aus `maxZauber()`
 *     (`{ wert, grund }`); `grund === 'zauberobergrenze'` ist die allgemeine 14er-Decke,
 *     aufhebbar durch die Sonderfertigkeit Merkmalskenntnis (`sf_magisch`, hier per Präfix-
 *     Konvention aus Schritt VIII erkannt: `held.sonderfertigkeiten` enthält eine ID, die mit
 *     `sf_magisch:Merkmalskenntnis` beginnt).
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { erzeugeMarginale, begrenzungstext, erzeugePulsWaechter } from '../../marginale.ts';
import { feldStr, feldNum, feldStrArr, findeZeile } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import { eigenschaftenFinal } from '../../../core/character.ts';
import { EIGENSCHAFTEN, astralenergie, karmaenergie } from '../../../core/derived.ts';
import { maxZauber } from '../../../core/limits.ts';
import { fertigkeitKosten, energieKosten } from '../../../core/costs.ts';
import { erfahrungsgrad } from '../../../core/experience.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { Held } from '../../../core/character.ts';
import type { EigenschaftName, Eigenschaften } from '../../../core/types.ts';
import type { Store } from '../../../state/store.ts';
import type { Schritt } from '../types.ts';

const EIGENSCHAFT_NAMEN: ReadonlySet<string> = new Set(EIGENSCHAFTEN);
const istEigenschaftName = (wert: string): wert is EigenschaftName => EIGENSCHAFT_NAMEN.has(wert);

const TREFFER_DECKEL = 60;

type TraditionsZeile = {
  readonly name: string;
  readonly kurz: string;
  readonly leit: EigenschaftName | null;
  readonly faktor: number;
};

function liesTradition(zeile: DatensatzZeile): TraditionsZeile {
  const leit = feldStr(zeile, 'Leit');
  return {
    name: feldStr(zeile, 'Name'),
    kurz: feldStr(zeile, 'Kurz'),
    leit: istEigenschaftName(leit) ? leit : null,
    faktor: feldNum(zeile, 'Faktor'),
  };
}

type SpruchZeile = {
  readonly id: string;
  readonly name: string;
  readonly probe: readonly EigenschaftName[];
  readonly sf: string;
  readonly traditionen: readonly string[];
};

function liesSpruch(zeile: DatensatzZeile): SpruchZeile {
  const probe = feldStrArr(zeile, 'Probe').filter(istEigenschaftName);
  return {
    id: feldStr(zeile, 'ID'),
    name: feldStr(zeile, 'Name'),
    probe,
    sf: feldStr(zeile, 'SF'),
    traditionen: feldStrArr(zeile, 'Traditionen'),
  };
}

type TraditionsKonfiguration = {
  readonly id: 'magisch' | 'karmal';
  readonly titel: string;
  readonly artEinzahl: string;
  readonly artMehrzahl: string;
  readonly datensatzName: 'zauber' | 'liturgien';
  readonly heldTraditionFeld: 'traditionMagisch' | 'traditionKarmal';
  readonly heldEintraegeFeld: 'zauber' | 'liturgien';
  readonly energieLabel: 'AE' | 'KE';
  readonly energieKaufFeld: 'ae' | 'ke';
  readonly berechneEnergie: (leitwert: number) => number;
  readonly sfMerkmalskenntnisPraefix: string;
};

const KONFIGURATION_MAGIE: TraditionsKonfiguration = {
  id: 'magisch',
  titel: 'Zaubertradition',
  artEinzahl: 'Zauber',
  artMehrzahl: 'Zauber',
  datensatzName: 'zauber',
  heldTraditionFeld: 'traditionMagisch',
  heldEintraegeFeld: 'zauber',
  energieLabel: 'AE',
  energieKaufFeld: 'ae',
  berechneEnergie: (leitwert) => astralenergie({ leitwert }),
  sfMerkmalskenntnisPraefix: 'sf_magisch:Merkmalskenntnis',
};

const KONFIGURATION_KARMA: TraditionsKonfiguration = {
  id: 'karmal',
  titel: 'Karmatradition',
  artEinzahl: 'Liturgie',
  artMehrzahl: 'Liturgien',
  datensatzName: 'liturgien',
  heldTraditionFeld: 'traditionKarmal',
  heldEintraegeFeld: 'liturgien',
  energieLabel: 'KE',
  energieKaufFeld: 'ke',
  berechneEnergie: (leitwert) => karmaenergie({ leitwert }),
  sfMerkmalskenntnisPraefix: 'sf_karmal:Merkmalskenntnis',
};

type TraditionsAbschnittAPI = { readonly element: HTMLElement; readonly abbestellen: () => void };

function baueTraditionsAbschnitt(cfg: TraditionsKonfiguration, store: Store): TraditionsAbschnittAPI {
  let suchtext = '';
  let traditionsZeilen: ReadonlyArray<DatensatzZeile> | null = null;
  let spruchZeilen: ReadonlyArray<DatensatzZeile> | null = null;
  let speziesZeilen: ReadonlyArray<DatensatzZeile> | null = null;
  const pulsWaechter = erzeugePulsWaechter();

  const inhalt = el('div', {});
  const abschnitt = el('section', { class: 'abschnitt', 'data-testid': `abschnitt-${cfg.id}` }, [
    el('h2', { class: 'abschnitt-titel' }, [cfg.titel]),
    inhalt,
  ]);

  const waehleTradition = (kurz: string | null): void => {
    store.setze((h) => ({ ...h, [cfg.heldTraditionFeld]: kurz }));
  };

  const setzeSpruchWert = (id: string, wert: number, deckel: number): void => {
    const begrenzt = Math.max(0, Math.min(deckel, wert));
    store.setze((h) => {
      const eintraege = { ...h[cfg.heldEintraegeFeld] };
      if (begrenzt <= 0) delete eintraege[id];
      else eintraege[id] = begrenzt;
      return { ...h, [cfg.heldEintraegeFeld]: eintraege };
    });
  };

  const setzeEnergieKauf = (punkte: number): void => {
    const begrenzt = Math.max(0, punkte);
    store.setze((h) => ({ ...h, energienKauf: { ...h.energienKauf, [cfg.energieKaufFeld]: begrenzt } }));
  };

  function baueTraditionsWaehler(): HTMLElement {
    if (traditionsZeilen === null) {
      return el('p', { class: 'leere-liste-hinweis' }, ['Traditionen laden …']);
    }
    const zeilenElemente = traditionsZeilen.map((zeile) => {
      const t = liesTradition(zeile);
      return el('li', {}, [
        el('button', {
          type: 'button', class: 'auswahl-zeile', 'data-testid': `${cfg.id}-tradition-${t.kurz}`,
          onclick: () => waehleTradition(t.kurz),
        }, [
          el('span', { class: 'auswahl-zeile__name' }, [t.name]),
          el('span', { class: 'auswahl-zeile__mods' }, [
            `Leit ${t.leit ?? '?'} · Faktor ${t.faktor}`,
          ]),
        ]),
      ]);
    });
    return el('div', {}, [
      el('p', { class: 'abschnitt-untertitel' }, [
        `Keine ${cfg.titel} gewählt. DSA5 bindet Zauberkunde/Karmakunde an die Vorteile ` +
        '„Zauberer“/„Geweihter“, nicht an eine bestimmte Profession — die Wahl ist frei.',
      ]),
      el('ul', { class: 'auswahl-liste', 'data-testid': `${cfg.id}-tradition-liste` }, zeilenElemente),
    ]);
  }

  function baueSpruchZeile(
    spruch: SpruchZeile, wert: number, held: Held, final: Eigenschaften, grad: ReturnType<typeof erfahrungsgrad>,
    eigeneTradition: string,
  ): HTMLElement {
    if (grad === undefined) return el('div', {});
    const merkmalskenntnis = held.sonderfertigkeiten.some((e) => e.id.startsWith(cfg.sfMerkmalskenntnisPraefix));
    const deckel = maxZauber({ probe: spruch.probe, eigenschaften: final, grad: grad.id, merkmalskenntnis });
    const istFremd = !spruch.traditionen.includes(eigeneTradition);
    const kosten = fertigkeitKosten(wert, spruch.sf, { aktivieren: wert > 0 });

    const eingabe = el('input', {
      class: 'stepper-feld zahl', type: 'number', inputmode: 'numeric', min: 0, max: deckel.wert,
      'aria-label': `${spruch.name}, Fertigkeitswert`,
      'data-testid': `${cfg.id}-spruch-${spruch.id}-fw`,
      onchange: (ev) => {
        const w = Number((ev.target as HTMLInputElement).value);
        if (Number.isFinite(w)) setzeSpruchWert(spruch.id, Math.round(w), deckel.wert);
      },
    });
    const minus = el('button', {
      class: 'stepper-knopf', type: 'button', 'aria-label': `${spruch.name} verringern`,
      onclick: () => setzeSpruchWert(spruch.id, wert - 1, deckel.wert),
    }, ['−']);
    const plus = el('button', {
      class: 'stepper-knopf', type: 'button', 'aria-label': `${spruch.name} erhöhen`,
      disabled: wert >= deckel.wert,
      onclick: () => setzeSpruchWert(spruch.id, wert + 1, deckel.wert),
    }, ['+']);

    return el('li', { class: 'spruch-zeile', 'data-testid': `${cfg.id}-spruch-${spruch.id}` }, [
      el('div', { class: 'spruch-zeile__kopf' }, [
        el('span', { class: 'auswahl-zeile__name' }, [
          spruch.name,
          istFremd ? el('span', { class: 'mod-tag' }, ['fremd']) : null,
        ]),
        el('span', { class: 'spruch-zeile__probe' }, [spruch.probe.join('/')]),
        minus, eingabe, plus,
        el('span', { class: 'eigenschaft-kosten zahl' }, [`${kosten} AP`]),
      ]),
      wert >= deckel.wert
        ? el('p', { class: 'marginale marginale--info' }, [begrenzungstext(deckel, grad)])
        : null,
    ]);
  }

  function berechneAnzahlen(held: Held): { gesamt: number; fremd: number } {
    const eigeneTradition = held[cfg.heldTraditionFeld] ?? '';
    let gesamt = 0;
    let fremd = 0;
    for (const [id, wert] of Object.entries(held[cfg.heldEintraegeFeld])) {
      if (wert <= 0) continue;
      gesamt += 1;
      const zeile = spruchZeilen?.find((z) => feldStr(z, 'ID') === id);
      if (zeile !== undefined && !feldStrArr(zeile, 'Traditionen').includes(eigeneTradition)) fremd += 1;
    }
    return { gesamt, fremd };
  }

  function baueSprueche(traditionKurz: string): HTMLElement {
    if (spruchZeilen === null) return el('p', { class: 'leere-liste-hinweis' }, [`${cfg.artMehrzahl} laden …`]);

    const held = store.held();
    const grad = erfahrungsgrad(held.erfahrungsgrad);
    const speziesZeile = speziesZeilen !== null && held.spezies !== null
      ? findeZeile(speziesZeilen, 'ID', held.spezies) : undefined;
    const final = eigenschaftenFinal(held, speziesZeile?.['EW']);

    const suche = suchtext.trim().toLowerCase();
    const eintraege = held[cfg.heldEintraegeFeld];
    const passend = spruchZeilen.filter((z) => {
      const name = feldStr(z, 'Name');
      const gekauft = (eintraege[feldStr(z, 'ID')] ?? 0) > 0;
      if (suche === '') return gekauft;
      return name.toLowerCase().includes(suche);
    });
    const gedeckelt = passend.slice(0, TREFFER_DECKEL);

    const zeilenElemente = gedeckelt.map((z) => {
      const spruch = liesSpruch(z);
      const wert = eintraege[spruch.id] ?? 0;
      return baueSpruchZeile(spruch, wert, held, final, grad, traditionKurz);
    });

    const { gesamt, fremd } = berechneAnzahlen(held);
    const anzahlProblem = grad !== undefined && gesamt > grad.zauberAnzahl;
    const fremdProblem = grad !== undefined && fremd > grad.fremdzauber;

    const suchfeldId = `${cfg.id}-spruch-suche`;
    return el('div', {}, [
      el('label', { class: 'sr-only', for: suchfeldId }, [`${cfg.artMehrzahl} suchen`]),
      el('input', {
        id: suchfeldId, class: 'suchfeld', type: 'search', 'data-testid': suchfeldId,
        placeholder: `${cfg.artMehrzahl} suchen …`,
        value: suchtext,
        oninput: (ev) => {
          suchtext = (ev.target as HTMLInputElement).value;
          renderAlles();
        },
      }),
      el('ul', { class: 'spruch-liste', 'data-testid': `${cfg.id}-spruch-liste` }, zeilenElemente.length > 0
        ? zeilenElemente
        : [el('li', {}, [el('p', { class: 'leere-liste-hinweis' }, [
          suche === '' ? `Noch keine ${cfg.artMehrzahl} gewählt — tippe oben, um zu suchen.` : 'Nichts gefunden.',
        ])])]),
      passend.length > TREFFER_DECKEL
        ? el('p', { class: 'leere-liste-hinweis' }, [
          `${passend.length - TREFFER_DECKEL} weitere Treffer nicht angezeigt — Suche weiter eingrenzen.`,
        ])
        : null,
      el('div', { class: 'sf-summe' }, [
        el('span', { class: 'zahl' }, [`${gesamt} / ${grad?.zauberAnzahl ?? '?'} ${cfg.artMehrzahl}`]),
        el('span', { class: 'zahl' }, [`davon fremd: ${fremd} / ${grad?.fremdzauber ?? '?'}`]),
      ]),
      anzahlProblem && grad !== undefined
        ? erzeugeMarginale(
          `Höchstens ${grad.zauberAnzahl} ${cfg.artMehrzahl} für Erfahrungsgrad ${grad.name}.`,
          'verletzung', { gepulst: pulsWaechter.istErstesErscheinen(`${cfg.id}-anzahl`) },
        )
        : null,
      fremdProblem && grad !== undefined
        ? erzeugeMarginale(
          `Höchstens ${grad.fremdzauber} fremde ${cfg.artMehrzahl} für Erfahrungsgrad ${grad.name}.`,
          'verletzung', { gepulst: pulsWaechter.istErstesErscheinen(`${cfg.id}-fremd`) },
        )
        : null,
    ]);
  }

  function baueEnergieKarte(traditionKurz: string): HTMLElement {
    const held = store.held();
    const speziesZeile = speziesZeilen !== null && held.spezies !== null
      ? findeZeile(speziesZeilen, 'ID', held.spezies) : undefined;
    const final = eigenschaftenFinal(held, speziesZeile?.['EW']);
    const traditionsZeile = traditionsZeilen?.find((z) => feldStr(z, 'Kurz') === traditionKurz);
    const t = traditionsZeile !== undefined ? liesTradition(traditionsZeile) : null;
    const leit = t?.leit ?? null;
    const leitwert = leit !== null ? final[leit] : 0;
    const basis = cfg.berechneEnergie(leitwert);
    const gekauft = held.energienKauf[cfg.energieKaufFeld];

    return el('div', { class: 'energie-karte' }, [
      el('div', { class: 'basiswerte-eintrag' }, [
        el('dt', {}, [cfg.energieLabel]),
        el('dd', { class: 'zahl', 'data-testid': `${cfg.id}-energie` }, [String(basis + gekauft)]),
      ]),
      el('p', { class: 'abschnitt-untertitel' }, [
        `Grundwert 20 + Leiteigenschaft ${t?.leit ?? '?'} (${leitwert}) = ${basis}. ` +
        `Zusätzlich gekauft: ${gekauft} (${energieKosten(gekauft)} AP).`,
      ]),
      el('div', { class: 'eigenschaft-steuerung' }, [
        el('button', {
          class: 'stepper-knopf', type: 'button', 'aria-label': `${cfg.energieLabel} verringern`,
          onclick: () => setzeEnergieKauf(gekauft - 1),
        }, ['−']),
        el('input', {
          class: 'stepper-feld zahl', type: 'number', inputmode: 'numeric', min: 0,
          'aria-label': `${cfg.energieLabel}, zusätzlich gekauft`,
          'data-testid': `${cfg.id}-energie-kauf`,
          onchange: (ev) => {
            const w = Number((ev.target as HTMLInputElement).value);
            if (Number.isFinite(w)) setzeEnergieKauf(Math.round(w));
          },
        }),
        el('button', {
          class: 'stepper-knopf', type: 'button', 'aria-label': `${cfg.energieLabel} erhöhen`,
          onclick: () => setzeEnergieKauf(gekauft + 1),
        }, ['+']),
      ]),
    ]);
  }

  function renderAlles(): void {
    leeren(inhalt);
    const held = store.held();
    const traditionKurz = held[cfg.heldTraditionFeld];

    if (traditionKurz === null) {
      inhalt.append(baueTraditionsWaehler());
      return;
    }

    const traditionsZeile = traditionsZeilen?.find((z) => feldStr(z, 'Kurz') === traditionKurz);
    const anzeigeName = traditionsZeile !== undefined ? liesTradition(traditionsZeile).name : traditionKurz;

    inhalt.append(
      el('div', { class: 'tradition-karte' }, [
        el('span', { class: 'auswahl-zeile__name' }, [anzeigeName]),
        el('button', {
          type: 'button', class: 'schritt-knopf', 'data-testid': `${cfg.id}-tradition-aendern`,
          onclick: () => waehleTradition(null),
        }, ['andere Tradition wählen']),
      ]),
      baueEnergieKarte(traditionKurz),
      el('h3', { class: 'unterabschnitt-titel' }, [cfg.artMehrzahl]),
      baueSprueche(traditionKurz),
    );
  }

  renderAlles();
  const abbestellen = store.abonniere(renderAlles);

  void ladeDatensatz('traditionen').then((z) => { traditionsZeilen = z; renderAlles(); });
  void ladeDatensatz(cfg.datensatzName).then((z) => { spruchZeilen = z; renderAlles(); });
  void ladeDatensatz('spezies').then((z) => { speziesZeilen = z; renderAlles(); });

  return { element: abschnitt, abbestellen };
}

export const schrittMagieKarma: Schritt = {
  id: 'magie-karma',
  titel: 'Magie und Karma',

  istAbgeschlossen: (held) => {
    if (held.traditionMagisch === null && held.traditionKarmal === null) return true;
    const grad = erfahrungsgrad(held.erfahrungsgrad);
    if (grad === undefined) return false;
    const zaehle = (eintraege: Record<string, number>): number =>
      Object.values(eintraege).filter((w) => w > 0).length;
    if (held.traditionMagisch !== null && zaehle(held.zauber) > grad.zauberAnzahl) return false;
    if (held.traditionKarmal !== null && zaehle(held.liturgien) > grad.zauberAnzahl) return false;
    return true;
  },

  render(container, { store }) {
    const magie = baueTraditionsAbschnitt(KONFIGURATION_MAGIE, store);
    const karma = baueTraditionsAbschnitt(KONFIGURATION_KARMA, store);

    anhaengenGestaffelt(container, [magie.element, karma.element]);

    return () => {
      magie.abbestellen();
      karma.abbestellen();
    };
  },
};
