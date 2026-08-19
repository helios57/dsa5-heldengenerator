export type EigenschaftName = 'MU' | 'KL' | 'IN' | 'CH' | 'FF' | 'GE' | 'KO' | 'KK';
export type Eigenschaften = Readonly<Record<EigenschaftName, number>>;
export type Spalte = 'A' | 'B' | 'C' | 'D';

export type Grundwerte = {
  readonly le: number; readonly sk: number; readonly zk: number; readonly gs: number;
};

export type Basiswerte = {
  readonly LE: number; readonly SK: number; readonly ZK: number;
  readonly AW: number; readonly INI: number; readonly GS: number;
};

export type LimitGrund = 'eigenschaft' | 'erfahrungsgrad' | 'zauberobergrenze';
export type Limit = { readonly wert: number; readonly grund: LimitGrund };

export type ProblemCode =
  | 'vorteil-ap' | 'nachteil-ap'
  | 'eigenschaft-min' | 'eigenschaft-max' | 'eigenschaftspunkte' | 'eigenschaft-fehlt'
  | 'rest-ap' | 'ap-ueberzogen';

export type Problem = {
  readonly code: ProblemCode;
  readonly feld: string | null;
  readonly text: string;
  readonly ist: number;
  readonly erlaubt: number;
};
