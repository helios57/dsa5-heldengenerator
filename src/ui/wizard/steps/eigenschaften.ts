/**
 * Schritt IV — Eigenschaften. Acht Steller auf `held.eigenschaftenGekauft` (GEKAUFTE Werte,
 * Ruling R13 — siehe character.ts/limits.ts). Jede Zeile zeigt den finalen Wert
 * (`eigenschaftenFinal`, inkl. sichtbarem Spezies-Modifikator), die laufenden AP-Kosten und,
 * wenn der Erfahrungsgrad-Deckel greift, eine Marginale statt eines stummen Disabled-Buttons.
 *
 * DOM-Muster dieses Schritts: jede Zeile wird EINMAL gebaut, `store.abonniere` löst danach
 * nur gezielte Aktualisierungen der Textknoten/Button-Zustände aus (kein Neubau der
 * Eingabe-Elemente) — Zahlen-Eingaben reagieren zusätzlich nur auf `change`, nicht `input`,
 * damit ein Tastendruck nie den Fokus verliert.
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { erzeugeMarginale, erzeugePulsWaechter } from '../../marginale.ts';
import { mitVorzeichen } from '../../format.ts';
import { feldStr, findeZeile } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import { eigenschaftenFinal } from '../../../core/character.ts';
import { EIGENSCHAFTEN } from '../../../core/derived.ts';
import { eigenschaftKosten, eigenschaftKostenGesamt } from '../../../core/costs.ts';
import { pruefeEigenschaften, EIGENSCHAFT_MIN } from '../../../core/limits.ts';
import { erfahrungsgrad } from '../../../core/experience.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { EigenschaftName, Problem } from '../../../core/types.ts';
import type { Schritt } from '../types.ts';

type ZeilenDaten = {
  readonly gekauft: number;
  readonly final: number;
  readonly modifikator: number;
  readonly kosten: number;
  readonly cap: number;
  readonly gradName: string;
  readonly problem: Problem | undefined;
  readonly langName: string | undefined;
};

type ZeileAPI = { readonly element: HTMLElement; readonly aktualisiere: (daten: ZeilenDaten) => void };

function baueZeile(
  name: EigenschaftName,
  setzeWert: (name: EigenschaftName, wert: number) => void,
  pulsWaechter: { istErstesErscheinen(schluessel: string): boolean },
): ZeileAPI {
  const langSpan = el('span', { class: 'eigenschaft-lang' });
  const finalSpan = el('span', { class: 'zahl', 'data-testid': `eigenschaft-${name}-final` });
  const modBadge = el('span', { class: 'eigenschaft-modifikator', 'data-testid': `eigenschaft-${name}-modifikator` });
  const kostenSpan = el('span', { class: 'eigenschaft-kosten zahl', 'data-testid': `eigenschaft-${name}-kosten` });
  const marginaleSlot = el('div', {});

  const eingabe = el('input', {
    class: 'stepper-feld zahl',
    type: 'number',
    inputmode: 'numeric',
    min: EIGENSCHAFT_MIN,
    'aria-label': `${name}, gekaufter Wert`,
    'data-testid': `eigenschaft-${name}-gekauft`,
    onchange: (ev) => {
      const wert = Number((ev.target as HTMLInputElement).value);
      if (Number.isFinite(wert)) setzeWert(name, Math.round(wert));
    },
  });

  const minusKnopf = el('button', {
    class: 'stepper-knopf', type: 'button', 'aria-label': `${name} verringern`,
    'data-testid': `eigenschaft-${name}-minus`,
    onclick: () => setzeWert(name, Number(eingabe.value) - 1),
  }, ['−']);

  const plusKnopf = el('button', {
    class: 'stepper-knopf', type: 'button', 'aria-label': `${name} erhöhen`,
    'data-testid': `eigenschaft-${name}-plus`,
    onclick: () => setzeWert(name, Number(eingabe.value) + 1),
  }, ['+']);

  const element = el('div', { class: 'eigenschaft-zeile', 'data-eigenschaft': name }, [
    el('div', { class: 'eigenschaft-kopf' }, [
      el('span', { class: 'eigenschaft-name' }, [name, langSpan]),
      el('span', { class: 'eigenschaft-final' }, [finalSpan, modBadge]),
    ]),
    el('div', { class: 'eigenschaft-steuerung' }, [minusKnopf, eingabe, plusKnopf, kostenSpan]),
    marginaleSlot,
  ]);

  const aktualisiere = (daten: ZeilenDaten): void => {
    langSpan.textContent = daten.langName ?? '';
    finalSpan.textContent = String(daten.final);
    modBadge.textContent = daten.modifikator === 0 ? '' : mitVorzeichen(daten.modifikator);
    kostenSpan.textContent = `${daten.kosten} AP`;
    eingabe.value = String(daten.gekauft);
    minusKnopf.toggleAttribute('disabled', daten.gekauft <= EIGENSCHAFT_MIN);
    plusKnopf.toggleAttribute('disabled', daten.gekauft >= daten.cap);

    leeren(marginaleSlot);
    if (daten.problem !== undefined) {
      const schluessel = `eig-${name}-${daten.problem.code}`;
      marginaleSlot.append(
        erzeugeMarginale(daten.problem.text, 'verletzung', { gepulst: pulsWaechter.istErstesErscheinen(schluessel) }),
      );
    } else if (daten.gekauft >= daten.cap) {
      marginaleSlot.append(erzeugeMarginale(`begrenzt durch Erfahrungsgrad ${daten.gradName} (max ${daten.cap})`, 'info'));
    }
  };

  return { element, aktualisiere };
}

export const schrittEigenschaften: Schritt = {
  id: 'eigenschaften',
  titel: 'Eigenschaften',

  istAbgeschlossen: (held) =>
    pruefeEigenschaften({ eigenschaften: held.eigenschaftenGekauft, grad: held.erfahrungsgrad }).length === 0,

  render(container, { store }) {
    const pulsWaechter = erzeugePulsWaechter();
    let speziesZeilen: ReadonlyArray<DatensatzZeile> | null = null;
    let langNamen: ReadonlyMap<string, string> | null = null;

    const setzeWert = (name: EigenschaftName, wert: number): void => {
      const begrenzt = Math.max(EIGENSCHAFT_MIN, wert);
      store.setze((held) => ({
        ...held,
        eigenschaftenGekauft: { ...held.eigenschaftenGekauft, [name]: begrenzt },
      }));
    };

    // Explizites Literal statt Object.fromEntries(): bleibt vollständig typsicher (jeder der
    // acht Schlüssel ist bekannt), ohne einen Cast auf Record<EigenschaftName, ZeileAPI> zu
    // brauchen. Die Reihenfolge der Anzeige kommt weiterhin einzig aus EIGENSCHAFTEN.
    const zeilen: Record<EigenschaftName, ZeileAPI> = {
      MU: baueZeile('MU', setzeWert, pulsWaechter),
      KL: baueZeile('KL', setzeWert, pulsWaechter),
      IN: baueZeile('IN', setzeWert, pulsWaechter),
      CH: baueZeile('CH', setzeWert, pulsWaechter),
      FF: baueZeile('FF', setzeWert, pulsWaechter),
      GE: baueZeile('GE', setzeWert, pulsWaechter),
      KO: baueZeile('KO', setzeWert, pulsWaechter),
      KK: baueZeile('KK', setzeWert, pulsWaechter),
    };

    const raster = el('div', { class: 'eigenschaften-raster' }, EIGENSCHAFTEN.map((name) => zeilen[name].element));
    const summenZeile = el('div', { class: 'eigenschaften-summe' });
    const summenMarginaleSlot = el('div', {});

    const abschnitt = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Eigenschaften']),
      el('p', { class: 'abschnitt-untertitel' }, [
        'Gekaufte Werte. Spezies-Modifikatoren erscheinen als sichtbarer Zuschlag auf den Endwert, ' +
        'zählen aber nicht gegen den Erfahrungsgrad-Deckel (Ruling R13).',
      ]),
      raster,
      summenZeile,
      summenMarginaleSlot,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    const aktualisiereAlles = (): void => {
      const held = store.held();
      const grad = erfahrungsgrad(held.erfahrungsgrad);
      if (grad === undefined) return;

      const speziesZeile = speziesZeilen !== null && held.spezies !== null
        ? findeZeile(speziesZeilen, 'ID', held.spezies)
        : undefined;
      const final = eigenschaftenFinal(held, speziesZeile?.['EW']);
      const probleme = pruefeEigenschaften({ eigenschaften: held.eigenschaftenGekauft, grad: held.erfahrungsgrad });

      for (const name of EIGENSCHAFTEN) {
        const gekauft = held.eigenschaftenGekauft[name];
        zeilen[name].aktualisiere({
          gekauft,
          final: final[name],
          modifikator: final[name] - gekauft,
          kosten: eigenschaftKosten(gekauft),
          cap: grad.maxEigenschaft,
          gradName: grad.name,
          problem: probleme.find((p) => p.feld === name),
          langName: langNamen?.get(name),
        });
      }

      const summe = EIGENSCHAFTEN.reduce((s, n) => s + held.eigenschaftenGekauft[n], 0);
      const kostenGesamt = eigenschaftKostenGesamt(EIGENSCHAFTEN.map((n) => held.eigenschaftenGekauft[n]));
      leeren(summenZeile);
      summenZeile.append(
        el('span', {}, [
          'Punkte gesamt: ',
          el('strong', { class: 'zahl', 'data-testid': 'eigenschaften-summe' }, [String(summe)]),
          ` / ${grad.maxEigenschaftspunkte}`,
        ]),
        el('span', {}, [
          'Kosten: ',
          el('strong', { class: 'zahl', 'data-testid': 'eigenschaften-kosten-gesamt' }, [String(kostenGesamt)]),
          ' AP',
        ]),
      );

      leeren(summenMarginaleSlot);
      const summenProblem = probleme.find((p) => p.code === 'eigenschaftspunkte');
      if (summenProblem !== undefined) {
        summenMarginaleSlot.append(erzeugeMarginale(
          summenProblem.text, 'verletzung',
          { gepulst: pulsWaechter.istErstesErscheinen('eigenschaftspunkte') },
        ));
      }
    };

    aktualisiereAlles();
    const abbestellen = store.abonniere(aktualisiereAlles);

    void ladeDatensatz('eigenschaften').then((zeilen2) => {
      langNamen = new Map(zeilen2.map((z) => [feldStr(z, 'Kurz'), feldStr(z, 'Lang')]));
      aktualisiereAlles();
    });
    void ladeDatensatz('spezies').then((zeilen2) => {
      speziesZeilen = zeilen2;
      aktualisiereAlles();
    });

    return () => abbestellen();
  },
};
