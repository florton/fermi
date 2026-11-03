/**
 * Every knob the simulation has. A run is a pure function of this object, so a
 * sweep is just a list of these.
 *
 * The defaults are not claims about the real universe. Several of them (the
 * hard-step rates above all) are unknown to many orders of magnitude, and the
 * point of the project is to ask which settings of them produce a sky that
 * looks like ours. They are chosen to give a run with enough going on to watch:
 * hundreds to a few thousand technological origins in the box.
 */

export interface StarClass {
  name: string;
  /** Fraction of habitable-zone rocky planets that orbit this kind of star. */
  frac: number;
  /** How long the planet stays habitable, Gyr. Life has this long to finish every hard step. */
  window: number;
  /** Extra multiplier on habitability (flares, tidal locking for M dwarfs). */
  weight: number;
}

export interface HardStep {
  name: string;
  /** log10 of the rate per Gyr at which this step happens on a planet where the previous one has. */
  log10Rate: number;
}

export interface SimParams {
  seed: number;

  // ── Universe ─────────────────────────────────────────────────────────────
  /** Number of nodes. Each node is a galaxy group, not a single galaxy; see universe.ts. */
  nodes: number;
  /** Side of the periodic comoving box, Gly. */
  boxGly: number;
  /** Galaxies per comoving Mpc³ that matter (roughly Milky-Way-class and up). */
  galaxyDensity: number;
  /** Fraction of nodes placed in clusters rather than the field. */
  clusterFrac: number;
  /** Simulation stops here, Gyr after the Big Bang. The universe is 13.8 now. */
  tEnd: number;
  /** Neighbours a colonised node launches probes toward. */
  kNeighbors: number;

  // ── Biology ──────────────────────────────────────────────────────────────
  /** Habitable-zone rocky planets per solar mass of stars formed. */
  habitablePerMsun: number;
  /**
   * Metallicity at which rocky-planet formation is half its present-day value,
   * as a fraction of today's mean. The early universe had almost no elements
   * heavier than helium to build planets from.
   */
  metalHalf: number;
  starClasses: StarClass[];
  /** Fixed delay before the first step can start: crust cooling, bombardment, Gyr. */
  minDelay: number;
  /** The ladder from chemistry to radio telescopes. Every step must finish inside the habitable window. */
  hardSteps: HardStep[];
  /** Safety cap on technological origins sampled in one run. */
  maxCivs: number;

  // ── Civilisations ────────────────────────────────────────────────────────
  /** Chance a technological civ with caution 0.5 survives its own adolescence. */
  filterSurvival: number;
  /** Time from first technology to the ability to launch interstellar probes, Gyr. */
  techToSpacefaring: number;
  /** Civs with expansionism below this stay home. */
  expansionThreshold: number;
  /** Probe speed range, fraction of c, spanned by the speed trait. */
  speedMin: number;
  speedMax: number;
  /** Mean delay before a newly settled node launches onward, Gyr. */
  launchDelay: number;
  /** Base rate at which a settled node's polity collapses, per Gyr. */
  collapseRate: number;
  /** Std. dev. of genome mutation per colonisation. */
  mutationSigma: number;
  /** Genome distance beyond which two polities of one lineage stop treating each other as kin. */
  kinThreshold: number;
  /**
   * Mean extra preparation before launching at a node someone else holds, Gyr. War is
   * expensive; without this a conquest immediately spawns the next one and
   * frontiers churn every few Myr.
   */
  siegeDelay: number;
  /** How much harder a node is to take than to hold: the defender's power is multiplied by this. */
  defenderAdvantage: number;
  /** Chance a native civ is prevented from arising in a node someone else already holds. */
  preemption: number;
  /**
   * Distance at which a fully converted, unhidden, average-mass node is detectable
   * by a present-day-human-class sensor, Gly. Scales as √luminosity, and is
   * stretched by (1+z) for light from the past.
   */
  detectRange: number;
  /**
   * 1 to estimate what observers see beyond half the box from the box's own
   * luminosity census (assuming the box is a fair sample), 0 to see only inside it.
   */
  farField: number;
  /** Fraction of waste heat still visible at full stealth. 0.1 = stealth can dim 10×, not hide. */
  stealthFloor: number;
  /**
   * How much stealth costs: it weakens a polity in a fight and slows its launches.
   * 1 is the default trade-off, 0 makes hiding free.
   */
  stealthCost: number;

  // ── Technology ───────────────────────────────────────────────────────────
  /** Mean time between rungs of the tech ladder, Gyr. Caution stretches it. */
  techStep: number;
  /** Time to build a newly held node out to its tier's full conversion, Gyr. */
  conversionTime: number;

  // ── Dark forest ──────────────────────────────────────────────────────────
  /** How often a strike-capable lineage looks for targets, Gyr. */
  scanInterval: number;
  /** Most targets one scan strikes. */
  strikesPerScan: number;
  /** Relativistic strike speed, fraction of c. */
  strikeSpeed: number;
  /** Chance a strike destroys the polity it reaches. */
  strikeKill: number;
  /** Chance the victim's lineage traces a strike back and can retaliate. */
  strikeReveal: number;
  /** A struck node can't be resettled for this long, Gyr. */
  sterileTime: number;
  /** Weight of a lineage's size in conflict: power × (1 + w·log₁₀ nodes held). */
  lineageStrength: number;

  // ── Origins ──────────────────────────────────────────────────────────────
  /**
   * How much seeing others at first light pushes a young civ toward stealth
   * and caution. A hypothesis knob, not a finding: 0 makes traits independent of the sky.
   */
  skyResponse: number;
  /**
   * How much a resource-rich home (heavy node) pushes toward expansionism.
   * Also a hypothesis knob.
   */
  homeRichness: number;

  // ── Output ───────────────────────────────────────────────────────────────
  /** Interval between time-series samples, Gyr. */
  sampleEvery: number;
  /** Cap on chronicle entries. */
  maxChronicle: number;
  /** Safety stop: a run that processes more events than this ends early and is flagged truncated. */
  maxEvents: number;
}

export const DEFAULTS: SimParams = {
  seed: 1,

  nodes: 30000,
  boxGly: 3,
  galaxyDensity: 0.02,
  clusterFrac: 0.6,
  tEnd: 40,
  kNeighbors: 10,

  habitablePerMsun: 0.1,
  metalHalf: 0.3,
  starClasses: [
    { name: 'G', frac: 0.07, window: 5, weight: 1 },
    { name: 'K', frac: 0.13, window: 15, weight: 1 },
    { name: 'M', frac: 0.75, window: 50, weight: 0.01 },
  ],
  minDelay: 0.5,
  hardSteps: [
    { name: 'abiogenesis', log10Rate: 0 },
    { name: 'complex cells', log10Rate: -5 },
    { name: 'multicellular life', log10Rate: -5 },
    { name: 'intelligence', log10Rate: -5 },
    { name: 'technology', log10Rate: 0 },
  ],
  maxCivs: 20000,

  filterSurvival: 0.5,
  techToSpacefaring: 0.001,
  expansionThreshold: 0.4,
  speedMin: 0.01,
  speedMax: 0.9,
  launchDelay: 0.05,
  collapseRate: 0.05,
  mutationSigma: 0.04,
  kinThreshold: 0.3,
  siegeDelay: 2,
  defenderAdvantage: 3,
  preemption: 1,
  detectRange: 1.5,
  farField: 1,
  stealthFloor: 0.1,
  stealthCost: 1,

  techStep: 0.4,
  conversionTime: 0.2,

  scanInterval: 0.5,
  strikesPerScan: 2,
  strikeSpeed: 0.95,
  strikeKill: 0.8,
  strikeReveal: 0.5,
  sterileTime: 0.5,
  lineageStrength: 1,

  skyResponse: 0.3,
  homeRichness: 0.15,

  sampleEvery: 0.25,
  maxChronicle: 400,
  maxEvents: 20_000_000,
};

/**
 * Set the rate of every *hard* step (default rate below 1 per Gyr) at once. The
 * single most consequential unknown, so the sweep and the viewer expose it as one knob.
 */
export function withHardStepRate(over: Partial<SimParams>, log10Rate: number): Partial<SimParams> {
  return {
    ...over,
    hardSteps: DEFAULTS.hardSteps.map((s) => (s.log10Rate < 0 ? { ...s, log10Rate } : { ...s })),
  };
}

/** Deep-merge overrides onto the defaults. Arrays are replaced, not merged. */
export function withDefaults(over: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULTS,
    ...over,
    starClasses: (over.starClasses ?? DEFAULTS.starClasses).map((c) => ({ ...c })),
    hardSteps: (over.hardSteps ?? DEFAULTS.hardSteps).map((s) => ({ ...s })),
  };
}
