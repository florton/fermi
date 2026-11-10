/**
 * Every knob the simulation has. A run is a pure function of this object, so a
 * sweep is just a list of these.
 *
 * The defaults are not claims about the real universe. Several of them (the
 * hard-step rates above all) are unknown to many orders of magnitude, and the
 * point of the project is to ask which settings of them produce a sky that
 * looks like ours. They are chosen to give a run with enough going on to watch:
 * hundreds to a few thousand technological origins in the box. Where a number
 * has a measured or physical anchor (star lifetimes, survey limits), the
 * comment says where it comes from.
 */

export interface StarClass {
  name: string;
  /**
   * Typical mass, solar masses. Sets the main-sequence lifetime (about
   * 10 Gyr × M^−2.5), and with it how long a planet can stay habitable as the
   * star brightens (biology.ts).
   */
  mass: number;
  /** Fraction of habitable-zone rocky planets that orbit this kind of star (close to its share of stars). */
  frac: number;
  /**
   * How flare-active the star is, 0..1: young M dwarfs blast their planets with
   * flares and ultraviolet for billions of years. Sets how hard params.flareSurvival bites.
   */
  flare: number;
  /** Fraction of its habitable-zone planets close enough in to be tidally locked. */
  tidalLock: number;
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
  /**
   * Spread of metallicity between and within galaxies at one moment, dex. Stars
   * are born across this range around the cosmic mean, so even early on a few
   * are metal-rich enough for rocky planets, and even late a few are too poor.
   */
  metalSpread: number;
  /**
   * Chance, at today's mean metallicity, that a migrating giant planet wrecks
   * the inner system. Giant planets are commoner around metal-rich stars
   * (occurrence ∝ Z², Fischer & Valenti 2005), so this is the upper edge of
   * the galactic habitable zone (Lineweaver 2004).
   */
  giantRisk: number;
  starClasses: StarClass[];
  /**
   * Share of a star's main-sequence life that a planet at a fixed orbit stays
   * habitable as the star brightens. Earth: habitable from ~0.5 to ~6.5 Gyr of
   * the Sun's ~10, so ~0.6.
   */
  habitableShare: number;
  /**
   * Chance a habitable-zone planet of a fully flare-active star keeps its air and
   * water. Scaled per class by StarClass.flare. Unknown over orders of magnitude.
   */
  flareSurvival: number;
  /**
   * How habitable a tidally locked planet is, relative to one that spins. 1 means
   * locking doesn't matter; near 0 means a permanent day side and night side
   * rule out complex life. Unknown.
   */
  tidalLockHabitability: number;
  /** Fixed delay before the first step can start: crust cooling, bombardment, Gyr. */
  minDelay: number;
  /** The ladder from chemistry to radio telescopes. Every step must finish inside the habitable window. */
  hardSteps: HardStep[];
  /**
   * Rate of true sterilizations a planet faces today, per Gyr: radiation (a
   * very close gamma-ray burst or supernova) that kills everything, so the
   * planet's chance is over. Scales with the cosmic star formation rate, so it
   * was ~10× higher 10 Gyr ago. Far rarer than "lethal" bursts in the
   * literature, which are mass extinctions; plausibly 0.01–0.1/Gyr. 0 turns it off.
   */
  sterilizeRate: number;
  /**
   * Rate of complex-life wipes today, per Gyr: radiation that kills animals and
   * plants but not microbes. Only the steps after the first `microbialSteps`
   * are exposed. Piran & Jimenez (2014) put lethal bursts near Earth at ~1/Gyr,
   * but a lethal burst is a mass extinction, which Earth has survived five
   * times, so a complete wipe of complex life is rarer than that.
   */
  resetRate: number;
  /**
   * Long gamma-ray bursts come almost only from star formation below this
   * metallicity (as a fraction of today's mean), so radiation hazards follow
   * metal-poor star formation rather than all of it, and the young universe was
   * far more dangerous than its star formation rate alone says. 0 drops the bias.
   */
  grbMetalCut: number;
  /** How many of the first hard-step stages are microbial and survive a complex-life wipe. */
  microbialSteps: number;
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
  /** How much harder a node is to take than to hold: the defender's force is multiplied by this. */
  defenderAdvantage: number;
  /**
   * Distance over which force can be brought to bear, Gly. A fight is won by
   * energy: the holding's own, plus kin and allied holdings next door, each
   * discounted by e^(−distance/supportReach); an attacker's force is discounted
   * the same way over the distance it travels. So isolated outposts and attacks
   * far from home are weak.
   */
  supportReach: number;
  /**
   * How decisive an energy advantage is: an attacker with force A takes a node
   * defended by force D with chance A^w / (A^w + D^w). 1 is proportional odds;
   * larger is closer to "the stronger side always wins".
   */
  warExponent: number;
  /**
   * How fast settlement spreads through a galaxy group once the first galaxy is
   * reached, as a fraction of probe speed (probes stop, build and relaunch at
   * every galaxy on the way). A group is about as wide as the gap to the next one,
   * so filling it takes as long as a hop or longer.
   */
  fillSpeed: number;
  /** Chance a native civ is prevented from arising in a node someone else already holds. */
  preemption: number;
  /**
   * Luminosity distance, Gly, at which a present-day all-sky infrared survey
   * could pick out one galaxy whose whole starlight is turned into ~300 K waste
   * heat. WISE's 12 µm limit (~0.9 mJy) puts a Milky-Way-class galaxy (3×10¹⁰ L☉)
   * at ~6 Gly; telling it apart needs the galaxy's whole spectrum, as G-HAT did,
   * which works to about half that. Range scales as √(heat fraction × sensor gain).
   */
  detectRange: number;
  /**
   * Smallest fraction of a galaxy's starlight, as waste heat, that present-day
   * astronomy can tell apart from natural dust emission. G-HAT (WISE) and
   * Garrett (2015, the far-infrared–radio correlation) rule out more than ~10–50%
   * in nearby galaxies; below that, a civilisation's heat hides in the dust.
   */
  humanContrast: number;
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
  /** Mean time between milestones of the tech ladder, Gyr. Caution stretches it. */
  techStep: number;
  /**
   * The great filter ahead, as a fact of nature: the chance that each new
   * milestone of the ladder destroys a holding that reaches it (caution and
   * inwardness lower it). Applied per holding, not per lineage, because nothing
   * can stop an empire spread across galaxy groups all at once faster than light.
   */
  tierHazard: number;
  /**
   * Upper bound on the inwardness trait. 1 means turning inward (transcension) is
   * an available strategy and selection decides; 0 means it doesn't exist in nature.
   */
  inwardnessCap: number;
  /** Time to build a newly reached galaxy out to its technology's full conversion of starlight, Gyr. */
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
  /**
   * Reach of one strike, Gly: every holding of the target's lineage within this
   * distance of the impact is destroyed too. 0 hits one node. A fact about
   * weapons, swept to ask whether decisive strikes change what wins.
   */
  strikeRadius: number;
  /**
   * How much a lineage that loses holdings to strikes or berserkers learns to
   * hide: each loss raises the stealth its new colonies adopt by this much. A
   * learning knob, like skyResponse.
   */
  threatResponse: number;

  // ── Berserkers ───────────────────────────────────────────────────────────
  /**
   * Chance per scan that an aggressive, strike-capable lineage releases
   * self-replicating killer probes (at most once). 0 means the technology
   * doesn't exist. Released swarms outlive their makers.
   */
  berserkerChance: number;
  /** Swarm speed, fraction of c. */
  berserkerSpeed: number;
  /** Chance a swarm dies out at each node it reaches (wear, mutation, defences). */
  berserkerDecay: number;
  /** Swarms kill holdings showing at least this fraction of their starlight as waste heat. Dim and hidden ones are passed over. */
  berserkerSense: number;

  // ── Growth ───────────────────────────────────────────────────────────────
  /**
   * How much fast growth raises a holding's collapse rate: hazard × (1 + w·expansionism).
   * The sustainability hypothesis as a fact of nature; 0 means growth is free.
   */
  growthCollapse: number;
  /** Upper bound on the restraint trait; 0 removes the zoo/club option from nature. */
  restraintCap: number;
  /**
   * Kinds of civilisation a new species can start as (keys of ARCHETYPES in
   * archetypes.ts); each new species picks one at random. ['mixed'] is fully random traits.
   */
  archetypes: string[];
  /** Chance per scan that a berserker-building lineage releases its swarm (at most once). */
  berserkerBuildChance: number;
  /**
   * Chance a lineage reaching the top of the tech ladder discovers an instant,
   * unlimited-range channel. It is instant in the cosmic rest frame, the frame
   * the simulation's time coordinate already uses, so it can't send messages
   * into anyone's past. Holders sense each other anywhere and coordinate; nobody
   * without it can detect it. 0 means no such physics exists.
   */
  ftlChance: number;
  /**
   * 1 if the faster-than-light channel can carry energy as well as messages, so
   * holders can dump their waste heat through it and remove stealth's floor. Full
   * stealth then means truly invisible. 0 means the channel only carries messages.
   */
  ftlCloak: number;
  /**
   * Holdings in an observer's own galaxy group are seen from this far away, as a
   * fraction of the typical node spacing, instead of from zero distance. A group
   * is thousands of galaxies across, so "already here" doesn't mean "next door".
   */
  intraNodeSeeing: number;

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
  // Converged: present-day silence agrees within error at 4.5, 6 and 9 Gly, while
  // 3 Gly overstated it by ~15 points (one expanding empire could fill the whole
  // box and wrap onto itself). Resolution barely matters, so it's traded for volume.
  boxGly: 6,
  galaxyDensity: 0.02,
  clusterFrac: 0.6,
  tEnd: 40,
  kNeighbors: 10,

  habitablePerMsun: 0.1,
  metalHalf: 0.3,
  metalSpread: 0.3,
  giantRisk: 0.1,
  // Shares of stars by class from the solar neighbourhood (RECONS); M dwarfs split
  // at ~0.35 M☉, where they become fully convective and far more flare-active.
  starClasses: [
    { name: 'F', mass: 1.3, frac: 0.03, flare: 0, tidalLock: 0 },
    { name: 'G', mass: 1, frac: 0.07, flare: 0, tidalLock: 0 },
    { name: 'K', mass: 0.75, frac: 0.13, flare: 0.05, tidalLock: 0.1 },
    { name: 'early M', mass: 0.45, frac: 0.19, flare: 0.5, tidalLock: 1 },
    { name: 'late M', mass: 0.2, frac: 0.58, flare: 1, tidalLock: 1 },
  ],
  habitableShare: 0.6,
  flareSurvival: 0.02,
  tidalLockHabitability: 0.25,
  minDelay: 0.5,
  hardSteps: [
    { name: 'abiogenesis', log10Rate: 0 },
    { name: 'complex cells', log10Rate: -5 },
    { name: 'multicellular life', log10Rate: -5 },
    { name: 'intelligence', log10Rate: -5 },
    { name: 'technology', log10Rate: 0 },
  ],
  sterilizeRate: 0,
  resetRate: 0,
  grbMetalCut: 0.3,
  microbialSteps: 2,
  maxCivs: 100000,

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
  supportReach: 0.25,
  warExponent: 1,
  fillSpeed: 0.5,
  preemption: 1,
  detectRange: 3,
  humanContrast: 0.1,
  farField: 1,
  stealthFloor: 0.1,
  stealthCost: 1,

  techStep: 0.4,
  tierHazard: 0,
  inwardnessCap: 1,
  conversionTime: 0.05,

  scanInterval: 0.5,
  strikesPerScan: 2,
  strikeSpeed: 0.95,
  strikeKill: 0.8,
  strikeReveal: 0.5,
  sterileTime: 0.5,
  strikeRadius: 0,
  threatResponse: 0.3,

  berserkerChance: 0,
  berserkerSpeed: 0.2,
  berserkerDecay: 0.02,
  berserkerSense: 0.05,

  growthCollapse: 0,
  restraintCap: 1,
  archetypes: ['mixed'],
  berserkerBuildChance: 0.3,
  ftlChance: 0,
  ftlCloak: 0,
  intraNodeSeeing: 0.5,

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
    archetypes: [...(over.archetypes?.length ? over.archetypes : DEFAULTS.archetypes)],
  };
}
