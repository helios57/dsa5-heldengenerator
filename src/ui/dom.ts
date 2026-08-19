/**
 * Kleinstmögliche DOM-Hilfsschicht. Kein Framework, kein virtuelles DOM — nur ein
 * Hyperscript-artiger Baukasten über den Web-Standard-APIs, damit Bauteile lesbar bleiben
 * ohne `innerHTML`-Strings zusammenzukleben.
 */

type EventHandler = (ev: Event) => void;

export type Attribute = Readonly<Record<string, string | number | boolean | EventHandler | undefined>>;
export type Kind = Node | string | number | null | undefined | false;

function istEventName(schluessel: string): boolean {
  return schluessel.startsWith('on') && schluessel.length > 2;
}

/** Erzeugt ein Element, setzt Attribute/Listener aus `attrs` und hängt `kinder` an. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attribute = {},
  kinder: readonly Kind[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [schluessel, wert] of Object.entries(attrs)) {
    if (wert === undefined) continue;
    if (istEventName(schluessel) && typeof wert === 'function') {
      element.addEventListener(schluessel.slice(2).toLowerCase(), wert as EventListener);
      continue;
    }
    if (schluessel === 'class') {
      element.className = String(wert);
      continue;
    }
    // Echte HTML-Boolean-Attribute (disabled, checked, …) drücken sich über bloße
    // Anwesenheit aus. `aria-*`-Attribute sind KEINE solchen — sie erwarten die
    // Zeichenketten "true"/"false" (z. B. aria-pressed) und müssen daher immer über den
    // generischen Zweig unten laufen, sonst würde `aria-pressed: true` als `aria-pressed=""`
    // statt `aria-pressed="true"` landen.
    if (typeof wert === 'boolean' && !schluessel.startsWith('aria-')) {
      if (wert) element.setAttribute(schluessel, '');
      else element.removeAttribute(schluessel);
      continue;
    }
    element.setAttribute(schluessel, String(wert));
  }
  anhaengen(element, kinder);
  return element;
}

export function anhaengen(ziel: HTMLElement, kinder: readonly Kind[]): void {
  for (const kind of kinder) {
    if (kind === null || kind === undefined || kind === false) continue;
    ziel.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  }
}

export function leeren(ziel: HTMLElement): void {
  ziel.replaceChildren();
}

/**
 * Hängt `kinder` an `ziel` und markiert jedes Kind für die gestaffelte Enthüllung
 * (`.reveal` in layout.css, ~40 ms Versatz). Für den Schritt-Einstieg gedacht — ruft jeder
 * Schritt einmal beim Aufbau seiner obersten Abschnitte auf.
 */
export function anhaengenGestaffelt(ziel: HTMLElement, kinder: readonly HTMLElement[]): void {
  kinder.forEach((kind, index) => {
    kind.style.setProperty('--reveal-index', String(index));
    kind.classList.add('reveal');
    ziel.append(kind);
  });
}
