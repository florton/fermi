/**
 * What a universe is made of, in two lists, plus named presets that set both.
 *
 * CONDITIONS are facts of nature: how dangerous radiation is, whether new
 * technology is risky, whether weapons can be decisive, whether
 * faster-than-light physics exists. ARCHETYPES (archetypes.ts) are the kinds of
 * civilisation a species can start as. Neither forces an outcome: conditions
 * change the world, and kinds only set starting temperaments that then mutate
 * and compete.
 */

import { ARCHETYPES } from './archetypes.ts';
import { withHardStepRate, type SimParams } from './params.ts';

export interface Condition {
  label: string;
  blurb: string;
  params: Partial<SimParams>;
}

export const CONDITIONS: Record<string, Condition> = {
  sterilization: {
    label: 'Sterilizing radiation',
    blurb: 'Very close gamma-ray bursts or supernovae that kill everything (0.03 per Gyr today, ~10× more in the past).',
    params: { sterilizeRate: 0.03 },
  },
  complexWipes: {
    label: 'Complex-life wipes',
    blurb: 'Radiation that kills animals and plants but not microbes (0.3 per Gyr today).',
    params: { resetRate: 0.3 },
  },
  filterAhead: {
    label: 'Dangerous technology',
    blurb: 'Each new tech tier destroys some holdings that reach it (the great filter ahead).',
    params: { tierHazard: 0.5 },
  },
  growthLimits: {
    label: 'Growth is unsustainable',
    blurb: 'Fast expansion makes holdings collapse more often.',
    params: { growthCollapse: 3 },
  },
  decisiveWeapons: {
    label: 'Decisive weapons',
    blurb: 'Strikes are frequent, destroy nearby holdings too, and stealth can hide almost everything.',
    params: { strikeRadius: 0.3, strikesPerScan: 20, scanInterval: 0.2, stealthCost: 0.5, stealthFloor: 0.01 },
  },
  ftl: {
    label: 'Faster-than-light channel',
    blurb: 'A rare discovery at the top of the tech ladder: instant contact between holders.',
    params: { ftlChance: 0.3 },
  },
  ftlCloak: {
    label: 'Channel can carry heat',
    blurb: 'Channel holders can dump waste heat through it and become truly invisible. Needs the channel.',
    params: { ftlChance: 0.3, ftlCloak: 1 },
  },
};

export interface Preset {
  conditions: string[];
  archetypes: string[];
  /** Anything else the preset needs, like commoner life to offset sterilization. */
  extra?: Partial<SimParams>;
}

export const SCENARIOS: Record<string, Preset> = {
  baseline: { conditions: [], archetypes: ['mixed'] },
  // The control: the classic expand-or-stay-home model, with every optional strategy and learned response removed.
  noOptions: { conditions: [], archetypes: ['mixed'], extra: { inwardnessCap: 0, restraintCap: 0, threatResponse: 0, skyResponse: 0 } },
  filterAhead: { conditions: ['filterAhead'], archetypes: ['mixed'] },
  sterilization: { conditions: ['sterilization', 'complexWipes'], archetypes: ['mixed'], extra: withHardStepRate({}, -5.2) },
  darkForest: { conditions: ['decisiveWeapons'], archetypes: ['mixed'] },
  berserkers: { conditions: [], archetypes: ['mixed', 'berserker'], extra: { stealthFloor: 0.01 } },
  sustainability: { conditions: ['growthLimits'], archetypes: ['mixed'] },
  telepathy: { conditions: ['ftl'], archetypes: ['mixed'] },
  cloakedChannel: { conditions: ['ftl', 'ftlCloak'], archetypes: ['mixed'] },
  peacefulGalaxy: { conditions: [], archetypes: ['peaceful', 'communal', 'zookeeper', 'homebody'] },
  everyKind: { conditions: [], archetypes: Object.keys(ARCHETYPES) },
  // Every condition and every kind at once. Radiation removes most origins, so life is commoner to leave something to watch.
  everything: { conditions: Object.keys(CONDITIONS), archetypes: Object.keys(ARCHETYPES), extra: withHardStepRate({}, -4.8) },
};

/** Parameters for a set of conditions and kinds. */
export function universeParams(conditions: string[], archetypes: string[]): Partial<SimParams> {
  const out: Partial<SimParams> = {};
  for (const c of conditions) {
    if (!CONDITIONS[c]) throw new Error(`unknown condition "${c}"; known: ${Object.keys(CONDITIONS).join(', ')}`);
    Object.assign(out, CONDITIONS[c].params);
  }
  out.archetypes = archetypes.length ? archetypes : ['mixed'];
  return out;
}

export function scenario(name: string): Partial<SimParams> {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`unknown scenario "${name}"; known: ${Object.keys(SCENARIOS).join(', ')}`);
  return { ...universeParams(s.conditions, s.archetypes), ...s.extra };
}
