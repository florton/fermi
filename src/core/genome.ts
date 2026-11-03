/**
 * What a civilisation is, for the purposes of this simulation: five numbers in
 * [0, 1], each with a benefit and a cost, so that no setting wins everywhere.
 *
 *   expansionism  benefit: spreads at all, and launches sooner
 *                 cost:    nothing directly — its cost is exposure
 *   speed         benefit: faster probes, reaches more before the horizon closes
 *                 cost:    each launch takes longer to prepare
 *   aggression    benefit: takes settled nodes instead of bouncing off them
 *                 cost:    polities collapse faster; provokes retaliation
 *   stealth       benefit: less visible, less often attacked
 *                 cost:    hides its own energy use, so weaker in a fight and slower to launch
 *   caution       benefit: survives its technological adolescence more often
 *                 cost:    slower to become spacefaring, slower to launch
 *
 * A genome is copied with mutation every time a node is settled, so a lineage
 * that spans thousands of nodes is a population, and selection acts on it.
 */

import { normal, type Rng } from './rng.ts';

export const TRAITS = ['expansionism', 'speed', 'aggression', 'stealth', 'caution'] as const;
export type Trait = (typeof TRAITS)[number];
export const EXPANSIONISM = 0;
export const SPEED = 1;
export const AGGRESSION = 2;
export const STEALTH = 3;
export const CAUTION = 4;
export const N_TRAITS = TRAITS.length;

export type Genome = Float32Array;

export function randomGenome(rng: Rng): Genome {
  const g = new Float32Array(N_TRAITS);
  for (let i = 0; i < N_TRAITS; i++) g[i] = rng();
  return g;
}

export function mutate(g: Genome, sigma: number, rng: Rng): Genome {
  const out = new Float32Array(N_TRAITS);
  for (let i = 0; i < N_TRAITS; i++) out[i] = Math.min(1, Math.max(0, g[i] + sigma * normal(rng)));
  return out;
}

/** Euclidean distance scaled so the corners of the unit cube are 1 apart. */
export function genomeDistance(a: Genome, b: Genome): number {
  let s = 0;
  for (let i = 0; i < N_TRAITS; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / N_TRAITS);
}

/** Strength in a contested node. */
export function power(g: Genome): number {
  return (1 - 0.6 * g[STEALTH]) * (0.5 + g[AGGRESSION]);
}

/** Fraction of a settled node's waste heat that shows. */
export function visibility(g: Genome): number {
  return 1 - 0.9 * g[STEALTH];
}
