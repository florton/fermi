/**
 * What a civilisation is, for the purposes of this simulation: eight numbers in
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
 *                          (scaled by params.stealthCost)
 *   caution       benefit: survives its technological adolescence more often
 *                 cost:    slower to become spacefaring, slower to launch
 *   inwardness    transcension as a strategy rather than a destiny: invest in
 *                 computation and stability instead of territory
 *                 benefit: holdings collapse less, survive tech-tier hazards more
 *                          often, and run cooler (computation done efficiently
 *                          sheds less detectable waste heat)
 *                 cost:    launches much more slowly and fights worse
 *                 Whether it spreads is up to selection; params.inwardnessCap = 0
 *                 removes the option.
 *   restraint     the zoo hypothesis and the galactic club as a strategy: above
 *                 0.5, a holding leaves young civilisations alone (doesn't settle,
 *                 preempt or destroy them) and never fights another restrained holding
 *                 benefit: restrained lineages don't fight each other
 *                 cost:    forgoes every node with a young civilisation in it, and
 *                          lets future competitors grow up
 *                 params.restraintCap = 0 removes the option.
 *   unity         above 0.5, two lineages that meet and are both communal form an
 *                 alliance
 *                 benefit: allies never fight each other and count their combined
 *                          size in any war
 *                 cost:    never settle or take an ally's holdings, so they give
 *                          up room to grow
 *
 * A genome is copied with mutation every time a node is settled, so a lineage
 * that spans thousands of nodes is a population, and selection acts on it.
 */

import { normal, type Rng } from './rng.ts';

export const TRAITS = ['expansionism', 'speed', 'aggression', 'stealth', 'caution', 'inwardness', 'restraint', 'unity'] as const;
export type Trait = (typeof TRAITS)[number];
export const EXPANSIONISM = 0;
export const SPEED = 1;
export const AGGRESSION = 2;
export const STEALTH = 3;
export const CAUTION = 4;
export const INWARDNESS = 5;
export const RESTRAINT = 6;
export const UNITY = 7;
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

/** Strength in a contested node. `stealthCost` scales how much hiding weakens it (1 = default, 0 = free). */
export function power(g: Genome, stealthCost: number): number {
  return (1 - 0.6 * stealthCost * g[STEALTH]) * (1 - 0.4 * g[INWARDNESS]) * (0.5 + g[AGGRESSION]);
}

/**
 * Fraction of a settled node's waste heat that shows. `floor` is what still
 * leaks out at full stealth — thermodynamics says heat has to go somewhere, and
 * how well it can be hidden (radiated cold, beamed away, dumped into the
 * microwave background) is an open question, so it's a parameter. Inward
 * civilisations run cooler on top of that, never below the floor.
 */
export function visibility(g: Genome, floor: number): number {
  return Math.max(floor, (1 - (1 - floor) * g[STEALTH]) * (1 - 0.8 * g[INWARDNESS]));
}

/** Multiplier on hazards a holding faces (collapse, tech-tier catastrophe) from turning inward. */
export function inwardShelter(g: Genome): number {
  return 1 - 0.6 * g[INWARDNESS];
}
