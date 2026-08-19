/**
 * Regelkarte — wiederverwendbares Pergament-Element, das den `Regel`-Text aus den
 * Datensätzen (app/data/vorteile.json, nachteile.json, sf_*.json — jedes Datensatz-Objekt
 * mit einem `Regel`-Feld) lesbar macht. Bewusst als eigene "Leseoberfläche" gestaltet: warmes
 * Pergament statt der dunklen Kanzlei-Fläche, siehe .regelkarte in components.css.
 */
import { el } from './dom.ts';

export function erzeugeRegelKarte(titel: string, regelText: string): HTMLElement {
  return el('article', { class: 'regelkarte' }, [
    el('h3', { class: 'regelkarte__titel' }, [titel]),
    el('p', { class: 'regelkarte__text' }, [regelText]),
  ]);
}

/** Mehrere Regelkarten untereinander, z. B. für automatisch gewährte Vor-/Nachteile. */
export function erzeugeRegelKartenGruppe(karten: readonly HTMLElement[]): HTMLElement {
  return el('div', { class: 'regelkarten-gruppe' }, karten);
}
