/**
 * Kinds of civilisation: the temperament a species starts with.
 *
 * An archetype only shapes a new species' starting genome (and, for two of
 * them, what its lineage can build). Every trait still mutates as the lineage
 * spreads, and selection decides which kinds end up holding the universe. So
 * switching a kind on adds an option to nature rather than forcing an outcome;
 * switching it off asks what the universe looks like if no one starts that way.
 *
 * When several kinds are enabled, each new species picks one at random.
 */

import { AGGRESSION, CAUTION, EXPANSIONISM, INWARDNESS, RESTRAINT, SPEED, STEALTH, UNITY, type Genome } from './genome.ts';
import type { Rng } from './rng.ts';

export interface Archetype {
  label: string;
  blurb: string;
  /** Trait ranges at origin, by trait index; unlisted traits are uniform on [0, 1]. */
  traits: Record<number, [number, number]>;
  /** Highest tech tier the lineage can reach (index into TIERS). Default: all of them. */
  maxTier?: number;
  /** Releases berserker swarms when it gets the chance. */
  berserker?: boolean;
}

export const ARCHETYPES: Record<string, Archetype> = {
  mixed: {
    label: 'Mixed',
    blurb: 'Every trait random. The default, and the least assumption.',
    traits: {},
  },
  grabby: {
    label: 'Grabby expanders',
    blurb: 'Spread fast and far.',
    traits: { [EXPANSIONISM]: [0.8, 1], [SPEED]: [0.7, 1] },
  },
  homebody: {
    label: 'Homebodies',
    blurb: 'Never leave their home group.',
    traits: { [EXPANSIONISM]: [0, 0.2] },
  },
  peaceful: {
    label: 'Peaceful',
    blurb: 'Expand, but never attack.',
    traits: { [AGGRESSION]: [0, 0.1] },
  },
  communal: {
    label: 'Communal uniters',
    blurb: 'Ally with other communal lineages they meet: no wars between them, and they fight as one.',
    traits: { [UNITY]: [0.8, 1], [AGGRESSION]: [0, 0.4] },
  },
  zookeeper: {
    label: 'Zookeepers',
    blurb: 'Leave young civilisations alone and never fight other restrained ones.',
    traits: { [RESTRAINT]: [0.7, 1], [AGGRESSION]: [0, 0.3] },
  },
  hider: {
    label: 'Hiders',
    blurb: 'Hide their waste heat.',
    traits: { [STEALTH]: [0.85, 1], [CAUTION]: [0.5, 1] },
  },
  hunter: {
    label: 'Dark-forest hunters',
    blurb: 'Hide, watch, and strike whatever they see.',
    traits: { [AGGRESSION]: [0.8, 1], [STEALTH]: [0.6, 1] },
  },
  berserker: {
    label: 'Berserker builders',
    blurb: 'Release self-replicating killer probes that outlive them.',
    traits: { [AGGRESSION]: [0.7, 1] },
    berserker: true,
  },
  transcender: {
    label: 'Transcenders',
    blurb: 'Turn inward: compute and endure rather than expand.',
    traits: { [INWARDNESS]: [0.7, 1] },
  },
  plateau: {
    label: 'Tech plateau',
    blurb: 'Reach the stars but never Dyson swarms or weapons: slow, dim, harmless.',
    traits: {},
    maxTier: 0,
  },
};

/** Draw a starting genome for this archetype. Unlisted traits are uniform. */
export function archetypeGenome(a: Archetype, g: Genome, rng: Rng): Genome {
  for (const [i, [lo, hi]] of Object.entries(a.traits)) g[Number(i)] = lo + rng() * (hi - lo);
  return g;
}
