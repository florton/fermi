/**
 * Named bundles of nature-facts, one per Fermi explanation, so a sweep can put
 * them side by side. None of them forces an outcome: each changes what the
 * universe is like (how dangerous technology is, whether berserker probes are
 * buildable, whether fast growth is sustainable), and the optional strategies —
 * stealth, inwardness, restraint — stay available in every scenario so that
 * selection, not the scenario, decides whether anyone uses them.
 *
 * `noOptions` is the control: the classic expand-or-stay-home model with every
 * optional strategy and learned response removed.
 */

import type { SimParams } from './params.ts';

export const SCENARIOS: Record<string, Partial<SimParams>> = {
  baseline: {},
  noOptions: { inwardnessCap: 0, restraintCap: 0, threatResponse: 0, skyResponse: 0 },
  filterAhead: { tierHazard: 0.5 },
  sterilization: { sterilizeRate: 1 },
  darkForest: { strikeRadius: 0.3, strikesPerScan: 20, scanInterval: 0.2, stealthCost: 0.5, stealthFloor: 0.01 },
  berserkers: { berserkerChance: 0.3, stealthFloor: 0.01 },
  sustainability: { growthCollapse: 3 },
  // Rare in nature, but common enough here to see what it does.
  telepathy: { ftlChance: 0.3 },
};

export function scenario(name: string): Partial<SimParams> {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`unknown scenario "${name}"; known: ${Object.keys(SCENARIOS).join(', ')}`);
  return s;
}
