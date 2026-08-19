import { test, expect } from '@playwright/test';
import {
  spaltenFaktor, eigenschaftKosten, eigenschaftKostenGesamt, fertigkeitKosten, energieKosten,
} from '../../src/core/costs.ts';

test('column factors A-D', () => {
  expect([spaltenFaktor('A'), spaltenFaktor('B'), spaltenFaktor('C'), spaltenFaktor('D')])
    .toEqual([1, 2, 3, 4]);
  expect(spaltenFaktor('b')).toBe(2);
  expect(() => spaltenFaktor('Z')).toThrow();
});

test('attribute costs follow the official curve', () => {
  expect(eigenschaftKosten(8)).toBe(0);
  expect(eigenschaftKosten(7)).toBe(0);
  expect(eigenschaftKosten(9)).toBe(15);
  expect(eigenschaftKosten(13)).toBe(75);
  expect(eigenschaftKosten(14)).toBe(90);
  expect(eigenschaftKosten(15)).toBe(120);
  expect(eigenschaftKosten(16)).toBe(165);
  expect(eigenschaftKosten(18)).toBe(300);
});

test('eight attributes at 8 cost nothing', () => {
  expect(eigenschaftKostenGesamt([8, 8, 8, 8, 8, 8, 8, 8])).toBe(0);
});

test('a realistic Erfahren spread', () => {
  expect(eigenschaftKostenGesamt([14, 13, 12, 11, 10, 10, 9, 8])).toBe(345);
});

test('skill costs are linear to 11, then accelerate', () => {
  expect(fertigkeitKosten(0, 'B')).toBe(0);
  expect(fertigkeitKosten(1, 'A')).toBe(1);
  expect(fertigkeitKosten(10, 'B')).toBe(20);
  expect(fertigkeitKosten(11, 'B')).toBe(22);
  expect(fertigkeitKosten(12, 'B')).toBe(24);
  expect(fertigkeitKosten(13, 'B')).toBe(28);
  expect(fertigkeitKosten(14, 'D')).toBe(68);
});

test('activation adds one column factor', () => {
  expect(fertigkeitKosten(0, 'C', { aktivieren: true })).toBe(3);
  expect(fertigkeitKosten(5, 'C', { aktivieren: true })).toBe(18);
  expect(fertigkeitKosten(5, 'C')).toBe(15);
});

test('energy costs', () => {
  expect(energieKosten(0)).toBe(0);
  expect(energieKosten(1)).toBe(4);
  expect(energieKosten(11)).toBe(44);
  expect(energieKosten(12)).toBe(48);
  expect(energieKosten(13)).toBe(56);
});

// --- report, don't coerce: a non-finite input is corrupt caller state, not free AP ---

test('a non-finite attribute value is reported, not silently costed as 0 AP', () => {
  expect(() => eigenschaftKosten(Number.NaN)).toThrow();
  expect(() => eigenschaftKosten(Number.POSITIVE_INFINITY)).toThrow();
  // and it must propagate through the array reducer, not get lost in the sum
  expect(() => eigenschaftKostenGesamt([12, Number.NaN, 10])).toThrow();
});

test('a non-finite skill value is reported, not silently costed as 0 AP', () => {
  expect(() => fertigkeitKosten(Number.NaN, 'B')).toThrow();
  expect(() => fertigkeitKosten(Number.NEGATIVE_INFINITY, 'B')).toThrow();
});

test('a non-finite energy point value is reported, not silently costed as 0 AP', () => {
  expect(() => energieKosten(Number.NaN)).toThrow();
  expect(() => energieKosten(Number.POSITIVE_INFINITY)).toThrow();
});
