/** Abgeleitete Werte nach DSA5. Quelle: Regel-Wiki Schritt 12, Heldendokument (Spec §5.6). */
import type { Basiswerte, Eigenschaften, EigenschaftName, Grundwerte } from './types.ts';

export const EIGENSCHAFTEN: readonly EigenschaftName[] = Object.freeze([
  'MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK',
] as const);

export const SCHICKSALSPUNKTE_START = 3 as const;
export const ENERGIE_GRUNDWERT = 20 as const;

export const lebensenergie = (g: Grundwerte, e: Eigenschaften, mod = 0): number =>
  g.le + 2 * e.KO + mod;

export const seelenkraft = (g: Grundwerte, e: Eigenschaften, mod = 0): number =>
  Math.round(g.sk + (e.MU + e.KL + e.IN) / 6) + mod;

export const zaehigkeit = (g: Grundwerte, e: Eigenschaften, mod = 0): number =>
  Math.round(g.zk + (e.KO + e.KO + e.KK) / 6) + mod;

export const ausweichen = (e: Eigenschaften, mod = 0): number => Math.round(e.GE / 2) + mod;

export const initiative = (e: Eigenschaften, mod = 0): number =>
  Math.round((e.MU + e.GE) / 2) + mod;

export const geschwindigkeit = (g: Grundwerte, mod = 0): number => g.gs + mod;

export const astralenergie = (
  { leitwert, grundwert = ENERGIE_GRUNDWERT, mod = 0 }:
  { leitwert: number; grundwert?: number; mod?: number },
): number => grundwert + leitwert + mod;

export const karmaenergie = (
  { leitwert, grundwert = ENERGIE_GRUNDWERT, mod = 0 }:
  { leitwert: number; grundwert?: number; mod?: number },
): number => grundwert + leitwert + mod;

export function basiswerte(
  g: Grundwerte,
  e: Eigenschaften,
  mods: Partial<Record<keyof Basiswerte, number>> = {},
): Basiswerte {
  return {
    LE: lebensenergie(g, e, mods.LE ?? 0),
    SK: seelenkraft(g, e, mods.SK ?? 0),
    ZK: zaehigkeit(g, e, mods.ZK ?? 0),
    AW: ausweichen(e, mods.AW ?? 0),
    INI: initiative(e, mods.INI ?? 0),
    GS: geschwindigkeit(g, mods.GS ?? 0),
  };
}
