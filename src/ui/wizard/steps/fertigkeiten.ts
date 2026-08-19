/**
 * Schritt VII — Fertigkeiten und Kampftechniken. 61 Talente, gruppiert nach `Gruppe` (Körper,
 * Gesellschaft, Natur, Wissen, Handwerk), und 22 Kampftechniken. Fertigkeiten starten bei 0,
 * Kampftechniken bei `KAMPFTECHNIK_START` (6) — beide werden über `fertigkeitWert`/
 * `kampftechnikWert` (character.ts) mit demselben Default-Fallback gelesen wie überall sonst
 * im Projekt.
 *
 * Der Deckel jeder Zeile kommt aus `maxFertigkeit`/`maxKampftechnik` (limits.ts), angewandt
 * auf die FINALEN Eigenschaften (`eigenschaftenFinal`, inkl. sichtbarem Spezies-Modifikator —
 * anders als bei den Eigenschaften selbst gibt es hier kein Ruling-R13-Problem: der Fertig-
 * keits-/Kampftechnik-Deckel hängt an den tatsächlich verfügbaren, finalen Werten). Die
 * Marginale benennt IMMER, WELCHER der beiden Kandidaten bindet — `grund === 'eigenschaft'`
 * nennt die höchste Probe-/Leiteigenschaft samt Wert (z. B. "KL 13"), `grund ===
 * 'erfahrungsgrad'` den Erfahrungsgrad-Namen; `begrenzungstext()` (marginale.ts) baut daraus
 * den Satz, diese Datei liefert nur den `eigenschaftHinweis`. Gespeicherte Werte werden beim
 * Setzen zusätzlich auf den jeweils aktuellen Deckel geklemmt (es gibt — anders als bei
 * Eigenschaften — keine eigene `pruefeFertigkeiten`/`pruefeKampftechniken`-Verstoßprüfung in
 * limits.ts, die einen Überschuss später einfangen würde).
 *
 * DOM-Muster wie eigenschaften.ts: jede Zeile wird einmal gebaut (erst nachdem Talente/
 * Kampftechniken/Spezies geladen sind), `store.abonniere` löst danach nur gezielte
 * Aktualisierungen der Textknoten/Button-Zustände aus; die Zahlen-Eingabe reagiert auf
 * `change`, nicht auf jeden Tastendruck, damit der Fokus beim Tippen erhalten bleibt.
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { erzeugeMarginale, begrenzungstext } from '../../marginale.ts';
import { feldStr, feldStrArr, findeZeile } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import { eigenschaftenFinal, fertigkeitWert, kampftechnikWert } from '../../../core/character.ts';
import { EIGENSCHAFTEN } from '../../../core/derived.ts';
import { fertigkeitKosten } from '../../../core/costs.ts';
import { maxFertigkeit, maxKampftechnik, FERTIGKEIT_START, KAMPFTECHNIK_START } from '../../../core/limits.ts';
import { erfahrungsgrad } from '../../../core/experience.ts';
import type { Erfahrungsgrad } from '../../../core/experience.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { Held } from '../../../core/character.ts';
import type { Eigenschaften, EigenschaftName, Limit } from '../../../core/types.ts';
import type { Schritt } from '../types.ts';

const GRUPPEN_REIHENFOLGE = ['Körper', 'Gesellschaft', 'Natur', 'Wissen', 'Handwerk'] as const;

const EIG_MENGE = new Set<string>(EIGENSCHAFTEN);

function alsEigenschaftNamen(werte: readonly string[]): EigenschaftName[] {
  return werte.filter((w): w is EigenschaftName => EIG_MENGE.has(w));
}

/** Höchste der benannten Eigenschaften samt Name — für die Marginale ("KL 13"), nicht nur
 *  der Zahlenwert wie im internen `hoechste()` von limits.ts. Bei Gleichstand gewinnt die
 *  erste Eigenschaft der Liste (dieselbe Reihenfolge, in der `Probe`/`Leit` sie nennen). */
function benannteHoechste(namen: readonly EigenschaftName[], eig: Eigenschaften): { name: EigenschaftName; wert: number } {
  let bester: { name: EigenschaftName; wert: number } | null = null;
  for (const name of namen) {
    const wert = eig[name];
    if (bester === null || wert > bester.wert) bester = { name, wert };
  }
  if (bester === null) throw new Error('benannteHoechste() benötigt mindestens eine Eigenschaft.');
  return bester;
}

/**
 * `maxFertigkeit`/`maxKampftechnik` (limits.ts) verlangen mindestens eine benannte
 * Eigenschaft und werfen sonst ("report, don't coerce"). Ein einzelnes Talent im Datensatz
 * (Tal60 „Mythos-Magie") trägt statt einer echten Probe den Platzhalter `["XX","XX","XX"]"`
 * — nach `alsEigenschaftNamen()` also eine leere Liste. Für genau diesen Fall bindet nur
 * noch der Erfahrungsgrad-Deckel; diese beiden Helfer kapseln den Sonderfall an EINER Stelle,
 * statt ihn an jeder Aufrufstelle erneut abzufangen.
 */
function fertigkeitLimit(probe: readonly EigenschaftName[], eigenschaften: Eigenschaften, gradId: string, grad: Erfahrungsgrad): Limit {
  if (probe.length === 0) return { wert: grad.maxFertigkeit, grund: 'erfahrungsgrad' };
  return maxFertigkeit({ probe, eigenschaften, grad: gradId });
}

function kampftechnikLimit(leit: readonly EigenschaftName[], eigenschaften: Eigenschaften, gradId: string, grad: Erfahrungsgrad): Limit {
  if (leit.length === 0) return { wert: grad.maxKampftechnik, grund: 'erfahrungsgrad' };
  return maxKampftechnik({ leiteigenschaften: leit, eigenschaften, grad: gradId });
}

type ZeilenDaten = {
  readonly wert: number;
  readonly kosten: number;
  readonly minWert: number;
  readonly capWert: number;
  readonly marginaleText: string | undefined;
};

type ZeileAPI = { readonly element: HTMLElement; readonly aktualisiere: (daten: ZeilenDaten) => void };

function baueSteuerZeile(
  testidPraefix: string, name: string, unterzeile: string, minWert: number, setzeWert: (wert: number) => void,
): ZeileAPI {
  const eingabe = el('input', {
    class: 'stepper-feld zahl', type: 'number', inputmode: 'numeric', min: minWert,
    'aria-label': `${name}, Wert`, 'data-testid': `${testidPraefix}-wert`,
    onchange: (ev) => {
      const wert = Number((ev.target as HTMLInputElement).value);
      if (Number.isFinite(wert)) setzeWert(Math.round(wert));
    },
  });

  const minusKnopf = el('button', {
    class: 'stepper-knopf', type: 'button', 'aria-label': `${name} verringern`,
    'data-testid': `${testidPraefix}-minus`,
    onclick: () => setzeWert(Number(eingabe.value) - 1),
  }, ['−']);

  const plusKnopf = el('button', {
    class: 'stepper-knopf', type: 'button', 'aria-label': `${name} erhöhen`,
    'data-testid': `${testidPraefix}-plus`,
    onclick: () => setzeWert(Number(eingabe.value) + 1),
  }, ['+']);

  const kostenSpan = el('span', { class: 'eigenschaft-kosten zahl', 'data-testid': `${testidPraefix}-kosten` });
  const marginaleSlot = el('div', {});

  const element = el('div', { class: 'eigenschaft-zeile', 'data-testid': `${testidPraefix}-zeile` }, [
    el('div', { class: 'eigenschaft-kopf' }, [
      el('span', { class: 'eigenschaft-name' }, [name, el('span', { class: 'eigenschaft-lang' }, [unterzeile])]),
    ]),
    el('div', { class: 'eigenschaft-steuerung' }, [minusKnopf, eingabe, plusKnopf, kostenSpan]),
    marginaleSlot,
  ]);

  const aktualisiere = (daten: ZeilenDaten): void => {
    eingabe.value = String(daten.wert);
    kostenSpan.textContent = `${daten.kosten} AP`;
    minusKnopf.toggleAttribute('disabled', daten.wert <= daten.minWert);
    plusKnopf.toggleAttribute('disabled', daten.wert >= daten.capWert);
    leeren(marginaleSlot);
    if (daten.marginaleText !== undefined) marginaleSlot.append(erzeugeMarginale(daten.marginaleText, 'info'));
  };

  return { element, aktualisiere };
}

export const schrittFertigkeiten: Schritt = {
  id: 'fertigkeiten',
  titel: 'Fertigkeiten und Kampftechniken',

  // Wie bei Vor-/Nachteilen: istAbgeschlossen() bekommt nur `held`, keine Datensätze — ohne
  // Talente/Kampftechniken lässt sich hier nichts prüfen, und DSA5 verlangt ohnehin keine
  // Mindestpunktzahl. "Abgeschlossen" heißt daher nur "betretbar".
  istAbgeschlossen: () => true,

  render(container, { store }) {
    let speziesZeilen: ReadonlyArray<DatensatzZeile> | null = null;

    const fertigkeitRegister = new Map<string, { row: ZeileAPI; talent: DatensatzZeile }>();
    const kampftechnikRegister = new Map<string, { row: ZeileAPI; kt: DatensatzZeile }>();

    const finalWerte = (held: Held): Eigenschaften => {
      const speziesZeile = speziesZeilen !== null && held.spezies !== null ? findeZeile(speziesZeilen, 'ID', held.spezies) : undefined;
      return eigenschaftenFinal(held, speziesZeile?.['EW']);
    };

    const setzeFertigkeit = (id: string, talent: DatensatzZeile, wert: number): void => {
      store.setze((h) => {
        const grad = erfahrungsgrad(h.erfahrungsgrad);
        if (grad === undefined) return h;
        const final = finalWerte(h);
        const probe = alsEigenschaftNamen(feldStrArr(talent, 'Probe'));
        const cap = fertigkeitLimit(probe, final, h.erfahrungsgrad, grad).wert;
        const begrenzt = Math.min(cap, Math.max(FERTIGKEIT_START, wert));
        return { ...h, fertigkeiten: { ...h.fertigkeiten, [id]: begrenzt } };
      });
    };

    const setzeKampftechnik = (name: string, kt: DatensatzZeile, wert: number): void => {
      store.setze((h) => {
        const grad = erfahrungsgrad(h.erfahrungsgrad);
        if (grad === undefined) return h;
        const final = finalWerte(h);
        const leit = alsEigenschaftNamen(feldStr(kt, 'Leit').split('/'));
        const cap = kampftechnikLimit(leit, final, h.erfahrungsgrad, grad).wert;
        const begrenzt = Math.min(cap, Math.max(KAMPFTECHNIK_START, wert));
        return { ...h, kampftechniken: { ...h.kampftechniken, [name]: begrenzt } };
      });
    };

    const fertigkeitenGruppenContainer = el('div', {});
    const fertigkeitenSummeZeile = el('div', { class: 'eigenschaften-summe' });
    const kampftechnikenContainer = el('div', {});
    const kampftechnikenSummeZeile = el('div', { class: 'eigenschaften-summe' });

    const abschnittFertigkeiten = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Fertigkeiten']),
      el('p', { class: 'abschnitt-untertitel' }, [
        'Beginnen bei 0. Der Deckel jeder Zeile ist die höchste Probe-Eigenschaft +2 oder der ' +
        'Erfahrungsgrad-Höchstwert — je nachdem, welcher zuerst greift.',
      ]),
      fertigkeitenGruppenContainer,
      fertigkeitenSummeZeile,
    ]);

    const abschnittKampftechniken = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Kampftechniken']),
      el('p', { class: 'abschnitt-untertitel' }, [
        `Beginnen bei ${KAMPFTECHNIK_START}. Derselbe Deckel-Mechanismus wie bei Fertigkeiten, ` +
        'nur mit der Leiteigenschaft der Kampftechnik.',
      ]),
      kampftechnikenContainer,
      kampftechnikenSummeZeile,
    ]);

    anhaengenGestaffelt(container, [abschnittFertigkeiten, abschnittKampftechniken]);

    const aktualisiereAlles = (): void => {
      if (fertigkeitRegister.size === 0 && kampftechnikRegister.size === 0) return;
      const held = store.held();
      const grad = erfahrungsgrad(held.erfahrungsgrad);
      if (grad === undefined) return;
      const final = finalWerte(held);

      let fertigkeitenKostenGesamt = 0;
      for (const [id, { row, talent }] of fertigkeitRegister) {
        const wert = fertigkeitWert(held, id);
        const probe = alsEigenschaftNamen(feldStrArr(talent, 'Probe'));
        const sf = feldStr(talent, 'SF');
        const limit = fertigkeitLimit(probe, final, held.erfahrungsgrad, grad);
        const hoechste = probe.length > 0 ? benannteHoechste(probe, final) : null;
        const kosten = fertigkeitKosten(wert, sf, { aktivieren: feldStr(talent, 'Aktivieren') === 'ja' });
        fertigkeitenKostenGesamt += kosten;
        row.aktualisiere({
          wert, kosten, minWert: FERTIGKEIT_START, capWert: limit.wert,
          marginaleText: wert >= limit.wert
            ? begrenzungstext(limit, grad, hoechste !== null ? `${hoechste.name} ${hoechste.wert}` : undefined)
            : undefined,
        });
      }

      let kampftechnikenKostenGesamt = 0;
      for (const [name, { row, kt }] of kampftechnikRegister) {
        const wert = kampftechnikWert(held, name);
        const leit = alsEigenschaftNamen(feldStr(kt, 'Leit').split('/'));
        const sf = feldStr(kt, 'SF');
        const limit = kampftechnikLimit(leit, final, held.erfahrungsgrad, grad);
        const hoechste = leit.length > 0 ? benannteHoechste(leit, final) : null;
        const kosten = fertigkeitKosten(wert, sf) - fertigkeitKosten(KAMPFTECHNIK_START, sf);
        kampftechnikenKostenGesamt += kosten;
        row.aktualisiere({
          wert, kosten, minWert: KAMPFTECHNIK_START, capWert: limit.wert,
          marginaleText: wert >= limit.wert
            ? begrenzungstext(limit, grad, hoechste !== null ? `${hoechste.name} ${hoechste.wert}` : undefined)
            : undefined,
        });
      }

      leeren(fertigkeitenSummeZeile);
      fertigkeitenSummeZeile.append(el('span', {}, [
        'Kosten: ',
        el('strong', { class: 'zahl', 'data-testid': 'fertigkeiten-kosten-gesamt' }, [String(fertigkeitenKostenGesamt)]),
        ' AP',
      ]));

      leeren(kampftechnikenSummeZeile);
      kampftechnikenSummeZeile.append(el('span', {}, [
        'Kosten: ',
        el('strong', { class: 'zahl', 'data-testid': 'kampftechniken-kosten-gesamt' }, [String(kampftechnikenKostenGesamt)]),
        ' AP',
      ]));
    };

    const abbestellen = store.abonniere(aktualisiereAlles);

    void Promise.all([
      ladeDatensatz('talente'), ladeDatensatz('kampftechniken'), ladeDatensatz('spezies'),
    ]).then(([talente, kampftechniken, spezies]) => {
      speziesZeilen = spezies;

      leeren(fertigkeitenGruppenContainer);
      for (const gruppe of GRUPPEN_REIHENFOLGE) {
        const zeilenDerGruppe = talente.filter((z) => feldStr(z, 'Gruppe') === gruppe);
        if (zeilenDerGruppe.length === 0) continue;
        const raster = el('div', { class: 'eigenschaften-raster' });
        for (const talentZeile of zeilenDerGruppe) {
          const id = feldStr(talentZeile, 'ID');
          const name = feldStr(talentZeile, 'Name');
          const probeText = feldStrArr(talentZeile, 'Probe').join('/');
          const sfText = feldStr(talentZeile, 'SF');
          const row = baueSteuerZeile(
            `fertigkeit-${id}`, name, `Probe ${probeText} · SF ${sfText}`, FERTIGKEIT_START,
            (wert) => setzeFertigkeit(id, talentZeile, wert),
          );
          raster.append(row.element);
          fertigkeitRegister.set(id, { row, talent: talentZeile });
        }
        fertigkeitenGruppenContainer.append(el('h3', { class: 'unterabschnitt-titel' }, [gruppe]), raster);
      }

      leeren(kampftechnikenContainer);
      const ktRaster = el('div', { class: 'eigenschaften-raster' });
      for (const ktZeile of kampftechniken) {
        const name = feldStr(ktZeile, 'Name');
        const leitText = feldStr(ktZeile, 'Leit');
        const sfText = feldStr(ktZeile, 'SF');
        const row = baueSteuerZeile(
          `kampftechnik-${name}`, name, `Leiteigenschaft ${leitText} · SF ${sfText}`, KAMPFTECHNIK_START,
          (wert) => setzeKampftechnik(name, ktZeile, wert),
        );
        ktRaster.append(row.element);
        kampftechnikRegister.set(name, { row, kt: ktZeile });
      }
      kampftechnikenContainer.append(ktRaster);

      aktualisiereAlles();
    });

    return () => abbestellen();
  },
};
