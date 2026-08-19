/**
 * Erfahrungsgrade nach DSA5.
 * Quelle: Regel-Wiki, Heldenerschaffung Schritt 2 (wortgetreue Tabelle).
 * AP zusätzlich gegen ErfahrungsgradGetInfo aus dem Heldendokument geprüft.
 * Die Grenzen gelten ausschließlich während der Erschaffung.
 */
export type Erfahrungsgrad = {
  readonly id: string;
  readonly name: string;
  readonly ap: number;
  readonly maxEigenschaft: number;
  readonly maxFertigkeit: number;
  readonly maxKampftechnik: number;
  readonly maxEigenschaftspunkte: number;
  readonly zauberAnzahl: number;
  readonly fremdzauber: number;
};

export const ERFAHRUNGSGRADE: readonly Erfahrungsgrad[] = Object.freeze([
  { id: 'EG0', name: 'Unerfahren', ap: 900, maxEigenschaft: 12, maxFertigkeit: 10, maxKampftechnik: 8, maxEigenschaftspunkte: 95, zauberAnzahl: 8, fremdzauber: 0 },
  { id: 'EG1', name: 'Durchschnittlich', ap: 1000, maxEigenschaft: 13, maxFertigkeit: 10, maxKampftechnik: 10, maxEigenschaftspunkte: 98, zauberAnzahl: 10, fremdzauber: 1 },
  { id: 'EG2', name: 'Erfahren', ap: 1100, maxEigenschaft: 14, maxFertigkeit: 10, maxKampftechnik: 12, maxEigenschaftspunkte: 100, zauberAnzahl: 12, fremdzauber: 2 },
  { id: 'EG3', name: 'Kompetent', ap: 1200, maxEigenschaft: 15, maxFertigkeit: 13, maxKampftechnik: 14, maxEigenschaftspunkte: 102, zauberAnzahl: 14, fremdzauber: 3 },
  { id: 'EG4', name: 'Meisterlich', ap: 1400, maxEigenschaft: 16, maxFertigkeit: 16, maxKampftechnik: 16, maxEigenschaftspunkte: 105, zauberAnzahl: 16, fremdzauber: 4 },
  { id: 'EG5', name: 'Brillant', ap: 1700, maxEigenschaft: 17, maxFertigkeit: 19, maxKampftechnik: 18, maxEigenschaftspunkte: 109, zauberAnzahl: 18, fremdzauber: 5 },
  { id: 'EG6', name: 'Legendär', ap: 2100, maxEigenschaft: 18, maxFertigkeit: 20, maxKampftechnik: 20, maxEigenschaftspunkte: 114, zauberAnzahl: 20, fremdzauber: 6 },
].map((g) => Object.freeze(g)));

export function erfahrungsgrad(idOrName: string): Erfahrungsgrad | undefined {
  const needle = idOrName.trim().toLowerCase();
  return ERFAHRUNGSGRADE.find(
    (g) => g.id.toLowerCase() === needle || g.name.toLowerCase() === needle,
  );
}
