/**
 * Schritt I — Konzept & Erfahrungsgrad. Freitext-Konzept (in `held.notizen`, da der
 * Heldenbogen kein eigenes "Konzept"-Feld kennt) und die Wahl des Erfahrungsgrads aus einer
 * Tabelle aller sieben Grade mit AP und Deckeln. Standard: Erfahren (EG2, siehe `leererHeld`).
 *
 * Die Grad-Wahl braucht keine Store-Abo-getriebene Neuzeichnung: ein natives Radio zeigt
 * seinen Auswahlzustand selbst an, sobald `checked` beim Aufbau korrekt gesetzt ist.
 */
import { el, anhaengenGestaffelt } from '../../dom.ts';
import { ERFAHRUNGSGRADE } from '../../../core/experience.ts';
import type { Schritt } from '../types.ts';

function baueKonzeptAbschnitt(setzeKonzept: (text: string) => void, anfangswert: string): HTMLElement {
  const feldId = 'konzept-text';
  return el('section', { class: 'abschnitt' }, [
    el('h2', { class: 'abschnitt-titel' }, ['Konzept']),
    el('p', { class: 'abschnitt-untertitel' }, [
      'Ein, zwei Sätze zur Idee des Helden — wer er ist, bevor die Zahlen dazukommen.',
    ]),
    el('label', { class: 'feld-label', for: feldId }, ['Konzept']),
    el('textarea', {
      id: feldId, class: 'konzept-text', 'data-testid': 'konzept-text',
      placeholder: 'z. B. verarmter Adelssohn auf der Suche nach dem Namen seines Vaters …',
      onchange: (ev) => setzeKonzept((ev.target as HTMLTextAreaElement).value),
    }, [anfangswert]),
  ]);
}

function baueGradAbschnitt(waehleGrad: (id: string) => void, aktuellesGrad: string): HTMLElement {
  const zeilen = ERFAHRUNGSGRADE.map((grad) => {
    const radioId = `grad-${grad.id}`;
    return el('tr', { class: `grad-zeile${grad.id === aktuellesGrad ? ' grad-zeile--gewaehlt' : ''}`, 'data-testid': `grad-${grad.id}` }, [
      el('td', {}, [
        el('input', {
          type: 'radio', name: 'erfahrungsgrad', id: radioId, value: grad.id,
          checked: grad.id === aktuellesGrad,
          onchange: () => waehleGrad(grad.id),
        }),
      ]),
      el('td', {}, [el('label', { for: radioId }, [grad.name])]),
      el('td', { class: 'zahl', 'data-testid': `grad-${grad.id}-ap` }, [String(grad.ap)]),
      el('td', { class: 'zahl', 'data-testid': `grad-${grad.id}-max-eigenschaft` }, [String(grad.maxEigenschaft)]),
      el('td', { class: 'zahl' }, [String(grad.maxEigenschaftspunkte)]),
      el('td', { class: 'zahl' }, [String(grad.maxFertigkeit)]),
      el('td', { class: 'zahl' }, [String(grad.maxKampftechnik)]),
    ]);
  });

  return el('section', { class: 'abschnitt' }, [
    el('h2', { class: 'abschnitt-titel' }, ['Erfahrungsgrad']),
    el('p', { class: 'abschnitt-untertitel' }, [
      'Bestimmt das AP-Budget und alle Erschaffungsdeckel. Änderbar, solange noch erschaffen wird.',
    ]),
    el('table', { class: 'grad-tabelle' }, [
      el('caption', {}, ['Alle sieben Erfahrungsgrade nach DSA5']),
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['']),
          el('th', {}, ['Grad']),
          el('th', { class: 'zahl' }, ['AP']),
          el('th', { class: 'zahl' }, ['Max. Eigensch.']),
          el('th', { class: 'zahl' }, ['Punkte gesamt']),
          el('th', { class: 'zahl' }, ['Max. Fertigk.']),
          el('th', { class: 'zahl' }, ['Max. Kampftechnik']),
        ]),
      ]),
      el('tbody', {}, zeilen),
    ]),
  ]);
}

export const schrittKonzept: Schritt = {
  id: 'konzept',
  titel: 'Konzept & Erfahrungsgrad',

  istAbgeschlossen: (held) => held.notizen.trim().length > 0,

  render(container, { store }) {
    const held = store.held();

    const setzeKonzept = (text: string): void => {
      store.setze((h) => ({ ...h, notizen: text }));
    };
    const waehleGrad = (id: string): void => {
      store.setze((h) => ({ ...h, erfahrungsgrad: id }));
    };

    anhaengenGestaffelt(container, [
      baueKonzeptAbschnitt(setzeKonzept, held.notizen),
      baueGradAbschnitt(waehleGrad, held.erfahrungsgrad),
    ]);

    return () => {};
  },
};
