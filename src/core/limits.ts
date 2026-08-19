/** Erschaffungsgrenzen nach DSA5. Quelle: Regel-Wiki (Spec §5.1–5.4, §5.7). */
import { erfahrungsgrad } from './experience.ts';
import type { Erfahrungsgrad } from './experience.ts';
import { EIGENSCHAFTEN } from './derived.ts';
import type { Eigenschaften, EigenschaftName, Limit, Problem, ProblemCode } from './types.ts';

export const MAX_VORTEIL_AP = 80 as const;
export const MAX_NACHTEIL_AP = 80 as const;
export const MAX_REST_AP = 10 as const;
export const MAX_ZAUBER_FW = 14 as const;
export const EIGENSCHAFT_MIN = 8 as const;

/** Startwerte der Erschaffung (Spec §5.3). Kampftechniken beginnen bei 6, nicht bei 0. */
export const EIGENSCHAFT_START = 8 as const;
export const KAMPFTECHNIK_START = 6 as const;
export const FERTIGKEIT_START = 0 as const;

const problem = (
  code: ProblemCode, feld: string | null, text: string, ist: number, erlaubt: number,
): Problem => ({ code, feld, text, ist, erlaubt });

const hoechste = (namen: readonly EigenschaftName[], e: Eigenschaften): number =>
  namen.reduce((max, n) => Math.max(max, e[n]), 0);

function gradOrThrow(grad: string): Erfahrungsgrad {
  const g = erfahrungsgrad(grad);
  if (!g) throw new Error(`unbekannter Erfahrungsgrad: ${grad}`);
  return g;
}

/**
 * Die niedrigere Schranke gewinnt; `grund` benennt die greifende.
 * Bei exaktem Gleichstand gewinnt der ERSTE Kandidat (strikt `<`, nicht `<=`), sodass
 * Gleichstände in der Aufrufreihenfolge der Kandidaten-Arrays entschieden werden — das
 * ist beabsichtigt (eigenschaftsbasierte Gründe sind für die UI griffiger) und darf bei
 * einem künftigen Refactor nicht stillschweigend umgedreht werden.
 */
function kleinere(kandidaten: readonly Limit[]): Limit {
  return kandidaten.reduce((best, c) => (c.wert < best.wert ? c : best));
}

export function maxFertigkeit(
  { probe, eigenschaften, grad, herausragend = 0 }:
  { probe: readonly EigenschaftName[]; eigenschaften: Eigenschaften; grad: string; herausragend?: number },
): Limit {
  const g = gradOrThrow(grad);
  return kleinere([
    { wert: hoechste(probe, eigenschaften) + 2 + herausragend, grund: 'eigenschaft' },
    { wert: g.maxFertigkeit, grund: 'erfahrungsgrad' },
  ]);
}

export function maxKampftechnik(
  { leiteigenschaften, eigenschaften, grad, herausragend = 0 }:
  { leiteigenschaften: readonly EigenschaftName[]; eigenschaften: Eigenschaften; grad: string; herausragend?: number },
): Limit {
  const g = gradOrThrow(grad);
  return kleinere([
    { wert: hoechste(leiteigenschaften, eigenschaften) + 2 + herausragend, grund: 'eigenschaft' },
    { wert: g.maxKampftechnik, grund: 'erfahrungsgrad' },
  ]);
}

export function maxZauber(
  { probe, eigenschaften, grad, merkmalskenntnis = false, herausragend = 0 }:
  { probe: readonly EigenschaftName[]; eigenschaften: Eigenschaften; grad: string;
    merkmalskenntnis?: boolean; herausragend?: number },
): Limit {
  const g = gradOrThrow(grad);
  const kandidaten: Limit[] = [
    { wert: hoechste(probe, eigenschaften) + 2 + herausragend, grund: 'eigenschaft' },
    { wert: g.maxFertigkeit, grund: 'erfahrungsgrad' },
  ];
  if (!merkmalskenntnis) kandidaten.push({ wert: MAX_ZAUBER_FW, grund: 'zauberobergrenze' });
  return kleinere(kandidaten);
}

export function pruefeVorNachteile(
  { vorteilAP, nachteilAP }: { vorteilAP: number; nachteilAP: number },
): Problem[] {
  const problems: Problem[] = [];
  if (vorteilAP > MAX_VORTEIL_AP) {
    problems.push(problem('vorteil-ap', 'Vorteile',
      `Höchstens ${MAX_VORTEIL_AP} AP dürfen in Vorteile investiert werden. ` +
      'Die automatisch durch die Spezies gewährten Vorteile zählen mit.',
      vorteilAP, MAX_VORTEIL_AP));
  }
  if (nachteilAP > MAX_NACHTEIL_AP) {
    problems.push(problem('nachteil-ap', 'Nachteile',
      `Höchstens ${MAX_NACHTEIL_AP} AP dürfen durch Nachteile gewonnen werden. ` +
      'Die automatisch durch die Spezies gewährten Nachteile zählen mit.',
      nachteilAP, MAX_NACHTEIL_AP));
  }
  return problems;
}

/**
 * Ruling R13: MUST be called with the **gekaufte** (purchased) attribute values, not
 * final ones. The Erfahrungsgrad caps (`maxEigenschaft`, `maxEigenschaftspunkte`) apply
 * to what was bought during creation; species modifiers are applied afterwards, and a
 * final sheet value may legitimately exceed the cap.
 *
 * Verified against a real Auelfin sheet on *Erfahren* (cap 14): she shows IN 15, because
 * Elfen grant IN +1. Purchased was IN 14 — exactly at the cap — so she is fully legal.
 * A caller that passes final values instead would reject her as a rule violation.
 *
 * The character model must keep purchased and final attribute values separate: display
 * the final value, but validate the purchased one.
 */
export function pruefeEigenschaften(
  { eigenschaften, grad }: { eigenschaften: Eigenschaften; grad: string },
): Problem[] {
  const g = gradOrThrow(grad);
  const problems: Problem[] = [];
  let summe = 0;

  // Iterate the canonical attribute list, not `Object.entries(eigenschaften)`: a
  // caller may pass a partial/corrupted object (e.g. recovered autosave state), and
  // `Object.entries` would silently visit only the keys that happen to be present —
  // missing attributes would be skipped entirely rather than reported, and the point
  // total would be understated instead of flagged as suspect.
  for (const name of EIGENSCHAFTEN) {
    const wert = eigenschaften[name];
    if (!Number.isFinite(wert)) {
      problems.push(problem('eigenschaft-fehlt', name,
        `${name} fehlt oder ist kein gültiger Wert.`, Number.NaN, EIGENSCHAFT_MIN));
      continue;
    }
    summe += wert;
    if (wert < EIGENSCHAFT_MIN) {
      problems.push(problem('eigenschaft-min', name,
        `${name} muss mindestens ${EIGENSCHAFT_MIN} betragen.`, wert, EIGENSCHAFT_MIN));
    }
    if (wert > g.maxEigenschaft) {
      problems.push(problem('eigenschaft-max', name,
        `${name} darf auf ${g.name} höchstens ${g.maxEigenschaft} betragen.`, wert, g.maxEigenschaft));
    }
  }

  if (summe > g.maxEigenschaftspunkte) {
    problems.push(problem('eigenschaftspunkte', null,
      `Die Summe aller Eigenschaften darf auf ${g.name} höchstens ${g.maxEigenschaftspunkte} betragen.`,
      summe, g.maxEigenschaftspunkte));
  }
  return problems;
}

export function pruefeRestAP(
  { budget, ausgegeben }: { budget: number; ausgegeben: number },
): Problem[] {
  const rest = budget - ausgegeben;
  if (rest < 0) {
    return [problem('ap-ueberzogen', null, 'Das AP-Budget ist überschritten.', ausgegeben, budget)];
  }
  if (rest > MAX_REST_AP) {
    return [problem('rest-ap', null,
      `Höchstens ${MAX_REST_AP} AP dürfen ungenutzt ins Spiel mitgenommen werden.`,
      rest, MAX_REST_AP)];
  }
  return [];
}
