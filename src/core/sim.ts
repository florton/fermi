/**
 * The run: technological species arise on the schedule biology.ts drew for them,
 * look at the sky, survive or don't, and the ones that expand settle node after
 * node, climbing the tech ladder and carrying a mutating genome with them, until
 * the run ends or the expansion of the universe puts everything else out of reach.
 *
 * Vocabulary:
 *   civ      one technological origin — a species and the lineage it founds
 *   polity   one lineage's hold on one node, from settlement to collapse or conquest
 *   observer a civ at the moment it becomes technological, looking at its past light cone
 *   strike   a relativistic kinetic weapon fired at a node someone could see
 *
 * A polity's hold on a group grows: settlement spreads galaxy by galaxy from
 * where it first arrived, so a young holding has little power, can't yet have
 * reached every native species in the group, and is easy to overrun. Power
 * (mass × share settled × starlight harnessed) is what wins wars.
 *
 * Seeing has consequences. A lineage with strike capability periodically looks
 * at its own sky and, if aggressive, fires at what it finds; a strike can be
 * traced back. That is the dark-forest hypothesis made into a mechanism, so
 * whether hiding pays is something the run decides rather than something assumed.
 *
 * The experiment is still the observers. Each one records which lineages it can
 * see inside the box, and — beyond half the box, where the box can't be
 * simulated directly — how many it would expect to see if the rest of the
 * universe looks like this sample. "Silent" means it saw nobody either way.
 * A silent species that survives looks again with better telescopes, which
 * separates "nobody there" from "nobody we could yet tell from dust".
 */

import { ARCHETYPES, archetypeGenome } from './archetypes.ts';
import { buildStepTable, habitableWindow, makeLife, sampleOrigins } from './biology.ts';
import { makeCosmology, type Cosmology } from './cosmology.ts';
import {
  AGGRESSION,
  CAUTION,
  EXPANSIONISM,
  INWARDNESS,
  N_TRAITS,
  RESTRAINT,
  UNITY,
  SPEED,
  STEALTH,
  genomeDistance,
  inwardShelter,
  mutate,
  power,
  randomGenome,
  visibility,
  type Genome,
} from './genome.ts';
import { EventQueue, type Event } from './heap.ts';
import { lineageName } from './names.ts';
import type { SimParams } from './params.ts';
import { exponential, mulberry32 } from './rng.ts';
import {
  STRIKE_TIER,
  TIERS,
  canSee,
  filled,
  heatFraction,
  homeSensor,
  humanSensor,
  lineageSensor,
  maturity,
  maxSight,
  speedFactor,
  tierAt,
  type Sensor,
} from './tech.ts';
import { makeUniverse, type Universe } from './universe.ts';

export const FATES = ['pending', 'preempted', 'filtered', 'quiet', 'expanding', 'destroyed', 'engulfed'] as const;
export type Fate = (typeof FATES)[number];

export interface Civ {
  id: number;
  name: string;
  node: number;
  tForm: number;
  tTech: number;
  starClass: number;
  genome: Genome;
  fate: Fate;
  tFate: number;
  /** Set if the civ got to look at the sky (not preempted). */
  saw: {
    /** Distinct lineages seen inside half the box. */
    lineages: number;
    nearest: number;
    /** Expected number of visible nodes beyond half the box, from the census. */
    farExpected: number;
    /** Whether that expectation came up as a sighting. */
    far: boolean;
    /** Someone else already held this civ's own galaxy group when it looked up. */
    hostHere: boolean;
  } | null;
  /**
   * When it first saw anyone: tTech if at first light, later if its improving
   * telescopes found someone on a later look, NaN if never.
   */
  firstSeen: number;
  /** When it last looked at the sky. Species that see an empty sky look again 10 Myr, 100 Myr and 1 Gyr later, if they live. */
  lastLook: number;
  /** When the lineage found the faster-than-light channel; Infinity if never. */
  ftl: number;
  /** The kind of civilisation it started as (a key of ARCHETYPES). */
  archetype: string;
  /** The alliance it ended in, as the id of its founding lineage; its own id if it never allied. */
  alliance: number;
  /** When a foreign lineage first settled this civ's home node, if ever. */
  tEngulfed: number;
  /** Most nodes the lineage held at once. */
  peak: number;
  /** When the lineage reached each tier of the tech ladder. Empty unless it expanded. */
  tierTimes: number[];
}

export interface ChronicleEntry {
  t: number;
  kind: 'origin' | 'filter' | 'expand' | 'contact' | 'war' | 'extinct' | 'milestone' | 'zoo' | 'epoch' | 'tech' | 'strike';
  text: string;
  /** The lineage the entry is about, or -1. */
  who: number;
}

export interface Sample {
  t: number;
  /** Fraction of nodes held by some polity. */
  settled: number;
  lineagesAlive: number;
  quietAlive: number;
  /** Mean genome over living polities, NaN when there are none. */
  meanGenome: number[];
  /** Observers so far, and how many of them saw nothing. */
  observers: number;
  silent: number;
  /** Strikes fired so far. */
  strikes: number;
}

export interface Polities {
  node: Int32Array;
  lineage: Int32Array;
  parent: Int32Array;
  born: Float32Array;
  died: Float32Array;
  /** When settlement of the group effectively began (earlier than `born` if it took over a filled one), and how long filling it takes. */
  fillStart: Float32Array;
  fillTime: Float32Array;
  /** N_TRAITS per polity. */
  genome: Float32Array;
}

export interface Strikes {
  from: Int32Array;
  to: Int32Array;
  lineage: Int32Array;
  /** Lineage the strike was aimed at. */
  victim: Int32Array;
  launched: Float32Array;
  arrived: Float32Array;
  /** 1 if it destroyed what it was aimed at. */
  hit: Uint8Array;
}

export interface Tally {
  launches: number;
  settlements: number;
  conquests: number;
  repelled: number;
  collapses: number;
  strikes: number;
  strikeKills: number;
  retaliations: number;
  /** Holdings destroyed by the tech-tier hazard. */
  tierLosses: number;
  /** Berserker swarms released, and holdings they destroyed. */
  swarms: number;
  berserkerKills: number;
  /** Lineages that found the faster-than-light channel, and strikes they sent to enforce club rules. */
  ftlLineages: number;
  punishments: number;
  /** Times two communal lineages joined forces. */
  alliances: number;
  /** Later looks at the sky by species that first saw nobody. */
  relooks: number;
}

export interface SimResult {
  params: SimParams;
  universe: { nodes: number; boxGly: number; galaxiesPerNode: number; scaleToObservable: number };
  cosmology: { age: number; eventHorizonNow: number; Dinf: number };
  expectedOrigins: number;
  saturated: boolean;
  civs: Civ[];
  polities: Polities;
  strikes: Strikes;
  series: Sample[];
  chronicle: ChronicleEntry[];
  positions: { x: Float32Array; y: Float32Array; z: Float32Array; mass: Float32Array };
  runtimeMs: number;
  events: number;
  /** Hit params.maxEvents and stopped early. */
  truncated: boolean;
  tally: Tally;
}

const EMERGE = 0;
const SPACEFARING = 1;
const ARRIVE = 2;
const COLLAPSE = 3;
const SAMPLE = 4;
const EPOCH = 5;
const TIER = 6;
const SCAN = 7;
const STRIKE = 8;
const BERSERK = 9;
/** A spreading holding reaches the home of a species living quietly inside its group. */
const ENCOUNTER = 10;
/** A species that saw an empty sky looks again with better telescopes. */
const RELOOK = 11;

/** Gyr after first light at which a species that saw nobody looks again. */
const RELOOK_AFTER = [0.01, 0.1, 1];

// Census of waste-heat fractions for the far field, log-spaced from 10⁻⁴ to 1.
const CENSUS_PER_DECADE = 16;
const CENSUS_LOG_MIN = -4;
const CENSUS_BINS = -CENSUS_LOG_MIN * CENSUS_PER_DECADE + 1;
const censusBin = (f: number) => Math.max(0, Math.min(CENSUS_BINS - 1, Math.floor(CENSUS_PER_DECADE * (Math.log10(f) - CENSUS_LOG_MIN))));

/** A run in progress, advanced a slice at a time. */
export interface SimRun {
  /** Simulate until the wall clock passes `deadline` (performance.now() ms) or the run ends; true once it has ended. */
  advance(deadline: number): boolean;
  /** Simulated time reached: the history up to here is final. */
  readonly time: number;
  readonly done: boolean;
  /** The run so far, as fresh arrays. */
  result(): SimResult;
}

/** `onProgress` is called now and then with the fraction of simulated time done, 0..1. */
export function runSim(p: SimParams, onProgress?: (fraction: number) => void): SimResult {
  const run = startSim(p, onProgress);
  run.advance(Infinity);
  return run.result();
}

export function startSim(p: SimParams, onProgress?: (fraction: number) => void): SimRun {
  const started = performance.now();
  const rng = mulberry32(p.seed);
  const cosmo: Cosmology = makeCosmology();
  const uni: Universe = makeUniverse(p);
  const life = makeLife(p, cosmo);
  const maxWindow = Math.max(...p.starClasses.map((c) => habitableWindow(p, c)));
  const table = buildStepTable(p, Math.min(maxWindow, p.tEnd) + 1);
  const sample = sampleOrigins(p, life, uni, table, rng);
  const halfBox = uni.L / 2;
  const boxVolume = uni.L ** 3;
  /** Radius of a sphere as big as one group's share of the box, comoving Gly: how far settlement spreads to fill it. */
  const groupRadius = Math.cbrt((3 * boxVolume) / (4 * Math.PI * uni.n));

  // Optional strategies can't exceed what nature allows; everything else spans [0, 1].
  const capped = (g: Genome) => {
    if (g[INWARDNESS] > p.inwardnessCap) g[INWARDNESS] = p.inwardnessCap;
    if (g[RESTRAINT] > p.restraintCap) g[RESTRAINT] = p.restraintCap;
    return g;
  };
  // Each new species starts as one of the enabled kinds.
  for (const a of p.archetypes) if (!ARCHETYPES[a]) throw new Error(`unknown archetype "${a}"; known: ${Object.keys(ARCHETYPES).join(', ')}`);
  const origin = () => {
    const archetype = p.archetypes[Math.floor(rng() * p.archetypes.length)];
    return { archetype, genome: capped(archetypeGenome(ARCHETYPES[archetype], randomGenome(rng), rng)) };
  };
  const civs: Civ[] = sample.origins.map((o, id) => ({
    id,
    name: lineageName(id),
    node: o.node,
    tForm: o.tForm,
    tTech: o.tTech,
    starClass: o.starClass,
    ...origin(),
    fate: 'pending',
    tFate: NaN,
    saw: null,
    tEngulfed: NaN,
    peak: 0,
    tierTimes: [],
    firstSeen: NaN,
    lastLook: NaN,
    ftl: Infinity,
    alliance: id,
  }));
  const civsAt = new Map<number, number[]>();
  for (const c of civs) {
    const list = civsAt.get(c.node);
    if (list) list.push(c.id);
    else civsAt.set(c.node, [c.id]);
  }

  // Polity storage, grown as plain arrays and packed at the end.
  const pNode: number[] = [];
  const pLineage: number[] = [];
  const pParent: number[] = [];
  const pBorn: number[] = [];
  const pDied: number[] = [];
  const pFillStart: number[] = [];
  const pFillTime: number[] = [];
  const pGenome: Genome[] = [];
  const pVis: number[] = [];
  // Each node's polities as a linked list, newest first, and the nodes that have ever had one.
  const pPrevAtNode: number[] = [];
  const nodeHead = new Int32Array(uni.n).fill(-1);
  const everSettled: number[] = [];
  // Living polities per lineage, as swap-remove arrays so a random member is O(1).
  const members: number[][] = civs.map(() => []);
  const memberPos: number[] = [];
  // A polity launches toward a given target at most once. Without this, every
  // conquest re-launches at every neighbour and wars cascade without bound.
  const launched = new Set<number>();
  const sterileUntil = new Float32Array(uni.n);
  // What each lineage has learned to fear: the stealth its new colonies adopt after losses.
  const fear = new Float32Array(civs.length);
  // Berserker swarms: who made each, which nodes each has already passed through.
  const swarmMaker: number[] = [];
  const swarmSeen = new Set<number>();
  const released = new Uint8Array(civs.length);
  const ftlLineages: number[] = [];

  const sFrom: number[] = [];
  const sTo: number[] = [];
  const sLineage: number[] = [];
  const sTarget: number[] = [];
  const sVictim: number[] = [];
  const sLaunched: number[] = [];
  const sArrived: number[] = [];
  const sHit: number[] = [];
  const sRetaliation: boolean[] = [];

  const owner = new Int32Array(uni.n).fill(-1);
  const residents = new Map<number, number[]>();
  let settledCount = 0;
  let lineagesAlive = 0;
  let quietAlive = 0;
  let observers = 0;
  let silent = 0;
  const census: Float32Array[] = [];
  let brightestBin = -1;

  const series: Sample[] = [];
  const chronicle: ChronicleEntry[] = [];
  const kindCount = new Map<string, number>();
  const log = (t: number, kind: ChronicleEntry['kind'], text: string, cap = Infinity, who = -1) => {
    const n = kindCount.get(kind) ?? 0;
    if (n >= cap || chronicle.length >= p.maxChronicle) return;
    kindCount.set(kind, n + 1);
    chronicle.push({ t, kind, text, who });
  };
  const contacts = new Set<number>();
  const tally: Tally = {
    launches: 0,
    settlements: 0,
    conquests: 0,
    repelled: 0,
    collapses: 0,
    strikes: 0,
    strikeKills: 0,
    retaliations: 0,
    tierLosses: 0,
    swarms: 0,
    berserkerKills: 0,
    ftlLineages: 0,
    punishments: 0,
    alliances: 0,
    relooks: 0,
  };

  const q = new EventQueue();
  for (const c of civs) q.push(c.tTech, EMERGE, c.id);
  for (let i = 0; i * p.sampleEvery <= p.tEnd; i++) q.push(i * p.sampleEvery, SAMPLE);
  if (cosmo.age < p.tEnd) q.push(cosmo.age, EPOCH);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const tierOf = (lineage: number, t: number) => tierAt(civs[lineage].tierTimes, t);
  const restrained = (g: Genome) => g[RESTRAINT] >= 0.5;
  /** A young civilisation is living at this node: one that has looked up and not been destroyed. */
  const youngCivAt = (node: number) =>
    civsAt.get(node)?.some((cid) => {
      const f = civs[cid].fate;
      return f === 'pending' || f === 'quiet' || f === 'engulfed';
    }) ?? false;
  /** A lineage lost holdings to an attack it couldn't answer; its colonies will hide more. */
  const afflict = (lineage: number) => {
    fear[lineage] = Math.min(1, fear[lineage] + p.threatResponse);
  };
  /** Continuous technological maturity of a lineage at t; see tech.ts. */
  const matOf = (lineage: number, t: number) => maturity(civs[lineage].tierTimes, t);
  /** Launch speed of polity k's probes at t, fraction of c. */
  const speedOf = (k: number, t: number) =>
    (p.speedMin + (p.speedMax - p.speedMin) * pGenome[k][SPEED]) * speedFactor(Math.max(0, matOf(pLineage[k], t)));
  const gammaMinus1 = (v: number) => 1 / Math.sqrt(1 - v * v) - 1;
  const gammaMax = gammaMinus1(p.speedMax);
  // Alliances of communal lineages, as a union-find over lineage ids.
  const allyParent = Int32Array.from(civs, (_, i) => i);
  const allyOf = (l: number): number => {
    while (allyParent[l] !== l) l = allyParent[l] = allyParent[allyParent[l]];
    return l;
  };
  const allied = (la: number, lb: number) => la !== lb && allyOf(la) === allyOf(lb);
  const unite = (la: number, lb: number) => {
    const ra = allyOf(la);
    const rb = allyOf(lb);
    if (ra !== rb) allyParent[rb] = ra;
  };

  const isKin = (a: number, b: number) =>
    (pLineage[a] === pLineage[b] && genomeDistance(pGenome[a], pGenome[b]) < p.kinThreshold) || allied(pLineage[a], pLineage[b]);

  /** Share of polity k's group settled at t. */
  const fillOf = (k: number, t: number) => filled(t - pFillStart[k], pFillTime[k]);
  /** Power polity k harnesses at t, in fully harnessed average groups: mass × share settled × conversion. */
  const energyOf = (k: number, t: number) =>
    uni.mass[pNode[k]] * fillOf(k, t) * heatFraction(matOf(pLineage[k], t), t - pBorn[k], p.conversionTime, 1);
  /**
   * Force polity k can bring to bear at its own group at t: its own power plus
   * that of kin and allied holdings next door, each discounted by distance, all
   * weakened by hiding and turning inward.
   */
  const forceOf = (k: number, t: number) => {
    let e = energyOf(k, t);
    const node = pNode[k];
    for (const j of uni.neighbors(node)) {
      const o = owner[j];
      if (o < 0 || o === k || !isKin(k, o)) continue;
      e += energyOf(o, t) * Math.exp(-uni.dist(node, j) / p.supportReach);
    }
    return e * power(pGenome[k], p.stealthCost);
  };

  /** Share of a settled galaxy's starlight that polity k shows as waste heat at time te. */
  const heatAt = (k: number, te: number) => {
    // With a cloaking channel, a holder can push its waste heat out of normal space:
    // stealth then has no floor, and full stealth is true invisibility.
    const cloaked = p.ftlCloak > 0 && civs[pLineage[k]].ftl <= te;
    const vis = cloaked ? visibility(pGenome[k], 0) : pVis[k];
    return heatFraction(matOf(pLineage[k], te), te - pBorn[k], p.conversionTime, vis);
  };
  const sensorOf = (l: number, t: number): Sensor => lineageSensor(p, civs[l].tTech, civs[l].tierTimes, t);
  /** Who held `node` at time te, or -1. */
  const holderAt = (node: number, te: number) => {
    for (let k = nodeHead[node]; k >= 0; k = pPrevAtNode[k]) {
      if (pBorn[k] > te) continue;
      return te < pDied[k] ? k : -1;
    }
    return -1;
  };

  const launch = (from: number, target: number, t: number, notBefore = t) => {
    const key = from * uni.n + target;
    if (launched.has(key)) return;
    launched.add(key);
    const g = pGenome[from];
    const held = owner[target] >= 0 && !isKin(from, owner[target]);
    // Only the aggressive bother sending anything at a held node; a peaceful probe would just turn back.
    if (held && rng() >= g[AGGRESSION]) return;
    // Faster probes take longer to build: shielding against dust and fuel for
    // braking both grow with γ − 1, cheap at a few percent of light speed and
    // steep near it. Probes at speedMax cost three times as long as slow ones.
    const v = speedOf(from, t);
    const meanDelay =
      (p.launchDelay *
        (1 + g[CAUTION]) *
        (1 + p.stealthCost * g[STEALTH]) *
        (1 + (2 * gammaMinus1(v)) / gammaMax) *
        (1 + 3 * g[INWARDNESS])) /
      (0.2 + g[EXPANSIONISM]);
    const tl = Math.max(t, notBefore) + exponential(rng, 1 / meanDelay) + (held ? exponential(rng, 1 / p.siegeDelay) : 0);
    const ta = cosmo.coast(tl, uni.dist(pNode[from], target), speedOf(from, tl));
    if (ta < p.tEnd) {
      q.push(ta, ARRIVE, from, target);
      tally.launches++;
    }
  };

  /** `alreadyFilled` is the share of the group a predecessor had settled, which a conqueror takes over. */
  const acquire = (node: number, lineage: number, genome: Genome, parent: number, t: number, alreadyFilled = 0) => {
    if (genome[STEALTH] < fear[lineage]) genome[STEALTH] = fear[lineage];
    const id = pNode.length;
    pNode.push(node);
    pLineage.push(lineage);
    pParent.push(parent);
    pBorn.push(t);
    pDied.push(Infinity);
    // Settlement spreads from the first galaxy reached across the group at a
    // fraction of probe speed; the group was physically smaller in the past.
    const v = Math.max(1e-3, (p.speedMin + (p.speedMax - p.speedMin) * genome[SPEED]) * speedFactor(Math.max(0, matOf(lineage, t))));
    const fillTime = (cosmo.a(t) * groupRadius) / (p.fillSpeed * v);
    pFillTime.push(fillTime);
    pFillStart.push(t - fillTime * Math.cbrt(Math.min(1, alreadyFilled)));
    pGenome.push(genome);
    pVis.push(visibility(genome, p.stealthFloor));
    if (nodeHead[node] === -1) everSettled.push(node);
    pPrevAtNode.push(nodeHead[node]);
    nodeHead[node] = id;
    owner[node] = id;
    settledCount++;
    const m = members[lineage];
    if (m.length === 0) lineagesAlive++;
    memberPos[id] = m.length;
    m.push(id);
    const civ = civs[lineage];
    if (m.length > civ.peak) {
      civ.peak = m.length;
      if (civ.peak === 10 || civ.peak === 100 || civ.peak === 1000 || civ.peak === 10000)
        log(t, 'milestone', `The ${civ.name} hold ${civ.peak} galaxy groups.`, Infinity, lineage);
    }

    const here = civsAt.get(node);
    if (here) for (const cid of here) if (cid !== lineage && Number.isNaN(civs[cid].tEngulfed)) civs[cid].tEngulfed = t;

    const g = genome;
    const hazard =
      p.collapseRate * (0.5 + g[AGGRESSION]) * (1.5 - g[CAUTION]) * inwardShelter(g) * (1 + p.growthCollapse * g[EXPANSIONISM]);
    const tc = t + exponential(rng, hazard);
    if (tc < p.tEnd) q.push(tc, COLLAPSE, id);

    for (const j of uni.neighbors(node)) {
      const o = owner[j];
      if (o >= 0 && isKin(id, o)) continue;
      launch(id, j, t, sterileUntil[j]);
    }

    // Anyone living here quietly will find themselves inside someone's
    // territory when the spreading settlement reaches their galaxy.
    const res = residents.get(node);
    if (res) {
      for (const cid of res) {
        if (cid === lineage) continue;
        const reached = pFillStart[id] + fillTime * Math.cbrt(rng());
        q.push(Math.max(t, reached), ENCOUNTER, id, cid);
      }
    }
    return id;
  };

  /** Polity k's settlement reaches the home of species c, who stayed in their own group. */
  const encounter = (k: number, cid: number, t: number) => {
    if (pDied[k] !== Infinity) return;
    const node = pNode[k];
    const res = residents.get(node);
    const at = res ? res.indexOf(cid) : -1;
    if (at < 0) return;
    const c = civs[cid];
    const g = pGenome[k];
    const name = civs[pLineage[k]].name;
    if (!restrained(g) && rng() < g[AGGRESSION] * (1 - 0.8 * c.genome[STEALTH])) {
      c.fate = 'destroyed';
      c.tFate = t;
      res!.splice(at, 1);
      quietAlive--;
      log(t, 'war', `The ${name} reach the ${c.name}' home and wipe them out.`, 40, pLineage[k]);
    } else {
      log(t, 'zoo', `The ${name} find the ${c.name} and leave them be.`, 30, pLineage[k]);
    }
  };

  const kill = (id: number, t: number) => {
    pDied[id] = t;
    const node = pNode[id];
    owner[node] = -1;
    settledCount--;
    const lineage = pLineage[id];
    const m = members[lineage];
    const last = m.pop()!;
    if (last !== id) {
      m[memberPos[id]] = last;
      memberPos[last] = memberPos[id];
    }
    if (m.length === 0) {
      lineagesAlive--;
      const c = civs[lineage];
      if (c.peak >= 5) log(t, 'extinct', `The last of the ${c.name} falls. At their height they held ${c.peak} groups.`, 80, lineage);
    }
    // The vacancy is an opportunity for whoever is next door, once it can be lived in.
    for (const j of uni.neighbors(node)) {
      const o = owner[j];
      if (o >= 0) launch(o, node, t, sterileUntil[node]);
    }
  };

  const meet = (la: number, lb: number, t: number) => {
    const key = Math.min(la, lb) * 1_000_003 + Math.max(la, lb);
    if (contacts.has(key)) return;
    contacts.add(key);
    log(t, 'contact', `First contact: the ${civs[la].name} and the ${civs[lb].name}.`, 80, la);
  };

  const fireStrike = (from: number, targetPolity: number, t: number, retaliation: boolean): boolean => {
    const to = pNode[targetPolity];
    const ta = cosmo.coast(t, uni.dist(pNode[from], to), p.strikeSpeed);
    if (!(ta < p.tEnd)) return false;
    const idx = sFrom.length;
    sFrom.push(pNode[from]);
    sTo.push(to);
    sLineage.push(pLineage[from]);
    sTarget.push(targetPolity);
    sVictim.push(pLineage[targetPolity]);
    sLaunched.push(t);
    sArrived.push(ta);
    sHit.push(0);
    sRetaliation.push(retaliation);
    q.push(ta, STRIKE, idx, from);
    tally.strikes++;
    if (retaliation) tally.retaliations++;
    else if (protectedByClub(targetPolity, from, t)) punish(from, t);
    return true;
  };

  // ── The faster-than-light channel ────────────────────────────────────────
  const hasFtl = (lineage: number, t: number) => civs[lineage].ftl <= t;
  /**
   * A restrained channel holder attacked by an unrestrained lineage: every
   * restrained channel holder hears of it at once, which is the one thing that
   * could let a galactic club enforce its rules across billions of light years.
   */
  const protectedByClub = (victim: number, attacker: number, t: number) =>
    restrained(pGenome[victim]) && !restrained(pGenome[attacker]) && hasFtl(pLineage[victim], t);
  // A few members answer each offence, not the whole club: enough to make
  // defection costly without turning one skirmish into a universal barrage.
  const ENFORCERS = 3;
  const punish = (offender: number, t: number) => {
    let sent = 0;
    for (const lin of ftlLineages) {
      if (sent >= ENFORCERS) break;
      if (!hasFtl(lin, t) || tierOf(lin, t) < STRIKE_TIER || pLineage[offender] === lin) continue;
      const m = members[lin];
      if (m.length === 0) continue;
      const enforcer = m[Math.floor(rng() * m.length)];
      if (!restrained(pGenome[enforcer])) continue;
      if (fireStrike(enforcer, offender, t, true)) {
        tally.punishments++;
        sent++;
      }
    }
  };

  // ── Observation ──────────────────────────────────────────────────────────
  /** Expected visible groups beyond half the box for this sensor, assuming the box is a fair sample. */
  const farExpectation = (t: number, s: Sensor) => {
    if (!p.farField || census.length === 0) return 0;
    const dd = 0.05;
    const aObs = cosmo.a(t);
    let expected = 0;
    for (let d = halfBox + dd / 2; ; d += dd) {
      const { t: te, a: aEmit } = cosmo.emissionWithScale(t, d);
      if (te < 0) break;
      const si = Math.min(census.length - 1, Math.floor(te / p.sampleEvery));
      const c = census[si];
      // The heat fraction needed to show from here: above the contrast floor and bright enough at d_L.
      const dL = aObs * d * (aObs / aEmit);
      const need = Math.max(s.contrast, (dL / p.detectRange) ** 2 / s.gain);
      if (need > 1) break; // nothing is brighter than all its starlight, and further is only dimmer
      const bin = Math.ceil(CENSUS_PER_DECADE * (Math.log10(need) - CENSUS_LOG_MIN));
      if (bin > brightestBin) break;
      expected += (c[Math.max(0, bin)] / boxVolume) * 4 * Math.PI * d * d * dd;
    }
    return expected;
  };

  // How far away holdings in one's own galaxy group are, for seeing them.
  const intraNode = (p.intraNodeSeeing * uni.L) / Math.cbrt(uni.n);
  const shellShare = (r: number) => Math.min(1, ((4 / 3) * Math.PI * r ** 3) / boxVolume);
  /**
   * Visit groups within `reach` of `from` that someone has ever settled. Sweeps
   * the grid nearest rings first (so `ringDone` can stop early), unless so few
   * groups have been settled that checking each of them directly is cheaper.
   */
  const lookAround = (from: number, reach: number, visit: (j: number, d: number) => void, ringDone: (beyond: number) => boolean) => {
    const near = Math.min(halfBox, reach);
    if (everSettled.length * 4 < uni.n * shellShare(near)) {
      for (const j of everSettled) {
        if (j === from) continue;
        const d = uni.dist(from, j);
        if (d <= near) visit(j, d);
      }
      return;
    }
    uni.byRings(from, near, (j, d) => nodeHead[j] >= 0 && visit(j, d), ringDone);
  };

  /** What species c sees at t with these telescopes: the lineages it can pick out, the nearest, and the far-field expectation. */
  const lookUp = (c: Civ, t: number, s: Sensor) => {
    const seen = new Set<number>();
    let nearest = Infinity;
    const aObs = cosmo.a(t);
    const look = (node: number, d: number) => {
      const { t: te, a: aEmit } = cosmo.emissionWithScale(t, d);
      if (te < 0) return;
      // The light arriving now left at te: find who held the node then.
      const k = holderAt(node, te);
      if (k < 0 || pLineage[k] === c.id || !canSee(heatAt(k, te), d, aEmit, aObs, p.detectRange, s)) return;
      seen.add(pLineage[k]);
      if (d < nearest) nearest = d;
    };
    if (nodeHead[c.node] >= 0) look(c.node, intraNode);
    lookAround(c.node, maxSight(p.detectRange, s, aObs), look, () => false);
    const farExpected = farExpectation(t, s);
    const far = rng() < 1 - Math.exp(-farExpected);
    return { seen, nearest, farExpected, far };
  };

  /** First light: a species with present-day human telescopes looks at its past light cone. */
  const observe = (c: Civ, t: number) => {
    const { seen, nearest, farExpected, far } = lookUp(c, t, humanSensor(p));
    c.saw = { lineages: seen.size, nearest, farExpected, far, hostHere: owner[c.node] >= 0 };
    c.lastLook = t;
    observers++;
    if (seen.size === 0 && !far) silent++;
    else c.firstSeen = t;
    // A species that looks up and sees it isn't alone may learn to keep quiet.
    if (seen.size > 0 || far) {
      c.genome[STEALTH] = Math.min(1, c.genome[STEALTH] + p.skyResponse);
      c.genome[CAUTION] = Math.min(1, c.genome[CAUTION] + p.skyResponse / 2);
    }
  };

  /** A species that has seen nobody so far looks again, with the telescopes it has now. */
  const relook = (c: Civ, t: number, which: number) => {
    const alive =
      c.fate === 'pending' || c.fate === 'quiet' || c.fate === 'engulfed' || (c.fate === 'expanding' && members[c.id].length > 0);
    if (!alive) return;
    tally.relooks++;
    const s = c.fate === 'expanding' ? sensorOf(c.id, t) : homeSensor(p, t - c.tTech);
    const { seen, far } = lookUp(c, t, s);
    c.lastLook = t;
    if (seen.size > 0 || far) {
      c.firstSeen = t;
      return;
    }
    if (which + 1 < RELOOK_AFTER.length) q.push(c.tTech + RELOOK_AFTER[which + 1], RELOOK, c.id, which + 1);
  };

  // ── Event loop ───────────────────────────────────────────────────────────
  // Runs in slices so a viewer can show the history as it is made: everything up
  // to `simT` is final, since events are handled in time order.
  let events = 0;
  let truncated = false;
  let done = false;
  let simT = 0;
  let busyMs = performance.now() - started;
  /** Handle events until the wall clock passes `deadline` (ms) or the run ends; true when it has ended. */
  const advance = (deadline: number): boolean => {
    if (done) return true;
    const sliceStart = performance.now();
    let n = 0;
    try {
      for (;;) {
        if ((++n & 0x3ff) === 0 && performance.now() > deadline) return false;
        const ev = q.pop();
        if (!ev || ev.t > p.tEnd) break;
        if (++events > p.maxEvents) {
          truncated = true;
          break;
        }
        step(ev);
      }
      done = true;
      simT = p.tEnd;
      return true;
    } finally {
      busyMs += performance.now() - sliceStart;
    }
  };

  const step = (ev: Event) => {
    const t = ev.t;
    simT = t;
    if (onProgress && (events & 0x3fff) === 0) onProgress(t / p.tEnd);
    switch (ev.kind) {
      case EMERGE: {
        const c = civs[ev.a];
        // A restrained holder lets the natives arise: the zoo. Anyone else has
        // only reached the galaxies its settlement has spread to so far.
        const holder = owner[c.node];
        if (holder >= 0 && !restrained(pGenome[holder]) && rng() < p.preemption * fillOf(holder, t)) {
          c.fate = 'preempted';
          c.tFate = t;
          break;
        }
        // A rich home makes expansion look cheap.
        c.genome[EXPANSIONISM] = Math.min(1, c.genome[EXPANSIONISM] + p.homeRichness * Math.log(uni.mass[c.node]));
        c.genome[EXPANSIONISM] = Math.max(0, c.genome[EXPANSIONISM]);
        observe(c, t);
        const s = c.saw!;
        const what = s.lineages ? `${s.lineages} other civilisation${s.lineages > 1 ? 's' : ''}` : s.far ? 'a distant glow of someone' : 'an empty sky';
        const kind = c.archetype === 'mixed' ? '' : `, ${ARCHETYPES[c.archetype].label.toLowerCase()}`;
        log(t, 'origin', `The ${c.name} become technological (${p.starClasses[c.starClass].name} star${kind}) and see ${what}.`, 25, c.id);
        const survival = Math.pow(p.filterSurvival, 2 * (1 - c.genome[CAUTION]));
        if (rng() >= survival) {
          c.fate = 'filtered';
          c.tFate = t + rng() * p.techToSpacefaring;
          log(c.tFate, 'filter', `The ${c.name} do not survive their own technology.`, 10, c.id);
          break;
        }
        // An empty sky might only mean crude telescopes: they will look again.
        if (Number.isNaN(c.firstSeen)) q.push(t + RELOOK_AFTER[0], RELOOK, c.id, 0);
        q.push(t + p.techToSpacefaring * (1 + c.genome[CAUTION]), SPACEFARING, c.id);
        break;
      }
      case SPACEFARING: {
        const c = civs[ev.a];
        if (c.fate !== 'pending') break;
        c.tFate = t;
        if (c.genome[EXPANSIONISM] < p.expansionThreshold || owner[c.node] >= 0) {
          c.fate = owner[c.node] >= 0 ? 'engulfed' : 'quiet';
          const res = residents.get(c.node);
          if (res) res.push(c.id);
          else residents.set(c.node, [c.id]);
          quietAlive++;
          break;
        }
        c.fate = 'expanding';
        // Draw the whole tech ladder now; caution climbs it more slowly.
        let tt = t;
        // Plateau civilisations stop climbing early; everyone else can reach the top.
        const topTier = ARCHETYPES[c.archetype].maxTier ?? TIERS.length - 1;
        for (let k = 0; k <= topTier; k++) {
          if (k > 0) tt += exponential(rng, 1 / (p.techStep * (1 + 0.5 * c.genome[CAUTION])));
          c.tierTimes.push(tt);
          if (k > 0 && tt < p.tEnd) q.push(tt, TIER, c.id, k);
        }
        log(t, 'expand', `The ${c.name} begin to spread beyond their home group.`, 30, c.id);
        acquire(c.node, c.id, c.genome, -1, t);
        break;
      }
      case TIER: {
        const c = civs[ev.a];
        if (members[c.id].length === 0) break;
        if (c.peak >= 3) log(t, 'tech', `The ${c.name} master ${TIERS[ev.b].name}.`, 60, c.id);
        // Each holding meets the new capability on its own, and some don't survive it.
        if (p.tierHazard > 0) {
          const m = members[c.id];
          const before = m.length;
          for (let j = m.length - 1; j >= 0; j--) {
            const k = m[j];
            const g = pGenome[k];
            if (rng() < Math.min(1, p.tierHazard * (1.5 - g[CAUTION]) * inwardShelter(g))) {
              kill(k, t);
              tally.tierLosses++;
            }
          }
          const lost = before - m.length;
          if (lost > 0 && before >= 3)
            log(t, 'filter', `${TIERS[ev.b].name[0].toUpperCase()}${TIERS[ev.b].name.slice(1)} cost the ${c.name} ${lost} of ${before} groups.`, 40, c.id);
          if (m.length === 0) break;
        }
        if (ev.b === STRIKE_TIER) q.push(t + exponential(rng, 1 / p.scanInterval), SCAN, c.id);
        if (ev.b === TIERS.length - 1 && p.ftlChance > 0 && rng() < p.ftlChance) {
          c.ftl = t;
          ftlLineages.push(c.id);
          tally.ftlLineages++;
          log(t, 'tech', `The ${c.name} find a channel faster than light, and hear who else is on it.`, 30, c.id);
        }
        break;
      }
      case SCAN: {
        const lineage = ev.a;
        const m = members[lineage];
        if (m.length === 0) break;
        q.push(t + p.scanInterval, SCAN, lineage);
        // A random holding looks, and its temperament decides whether it shoots.
        const v = m[Math.floor(rng() * m.length)];
        const g = pGenome[v];
        if (rng() >= g[AGGRESSION]) break;
        const sensor = sensorOf(lineage, t);
        const from = pNode[v];
        // Once, an aggressive lineage may let loose killers that will outlive it.
        const releaseChance = ARCHETYPES[civs[lineage].archetype].berserker ? p.berserkerBuildChance : p.berserkerChance;
        if (releaseChance > 0 && !released[lineage] && rng() < releaseChance) {
          released[lineage] = 1;
          swarmMaker.push(lineage);
          q.push(t, BERSERK, swarmMaker.length - 1, from);
          tally.swarms++;
          log(t, 'strike', `The ${civs[lineage].name} release self-replicating berserker probes.`, 30, lineage);
        }
        const targets: { k: number; d: number }[] = [];
        const aObs = cosmo.a(t);
        const want = p.strikesPerScan;
        const selfRestrained = restrained(g);
        const selfFtl = hasFtl(lineage, t);
        // Search outward and stop once the nearest `want` visible targets are certain.
        // A channel holder can sense other holders at any distance, so its search isn't bounded by light.
        lookAround(
          from,
          selfFtl ? halfBox : maxSight(p.detectRange, sensor, aObs),
          (node, d) => {
            const o = owner[node];
            if (o < 0 || pLineage[o] === lineage || allied(lineage, pLineage[o])) return;
            if (selfRestrained && restrained(pGenome[o])) return;
            // Channel holders sense each other now, however dim or far; everyone else needs light.
            const sensed = selfFtl && hasFtl(pLineage[o], t);
            if (!sensed) {
              const { t: te, a: aEmit } = cosmo.emissionWithScale(t, d);
              // It has to have been visible then, and the same polity has to still be there now.
              const k = te < 0 ? -1 : holderAt(node, te);
              if (k !== o || !canSee(heatAt(k, te), d, aEmit, aObs, p.detectRange, sensor)) return;
            }
            targets.push({ k: o, d });
          },
          (beyond) => {
            if (targets.length < want) return false;
            targets.sort((a, b) => a.d - b.d);
            return targets[want - 1].d <= beyond;
          },
        );
        targets.sort((a, b) => a.d - b.d);
        for (const { k } of targets.slice(0, p.strikesPerScan)) fireStrike(v, k, t, false);
        break;
      }
      case STRIKE: {
        const idx = ev.a;
        const from = ev.b;
        const target = sTarget[idx];
        const node = sTo[idx];
        const la = sLineage[idx];
        const lb = pLineage[target];
        if (pDied[target] === Infinity && rng() < p.strikeKill) {
          sHit[idx] = 1;
          tally.strikeKills++;
          sterileUntil[node] = t + p.sterileTime;
          kill(target, t);
          const res = residents.get(node);
          if (res) {
            for (const cid of res) {
              civs[cid].fate = 'destroyed';
              civs[cid].tFate = t;
              quietAlive--;
            }
            residents.delete(node);
          }
          // A big enough weapon takes the victim's neighbouring holdings with it.
          if (p.strikeRadius > 0) {
            for (const k of [...members[lb]]) {
              if (uni.dist(pNode[k], node) > p.strikeRadius) continue;
              sterileUntil[pNode[k]] = t + p.sterileTime;
              kill(k, t);
              tally.strikeKills++;
            }
          }
          afflict(lb);
          log(t, 'strike', `A strike from the ${civs[la].name} sterilises a group held by the ${civs[lb].name}.`, 60, la);
        }
        // The victims may trace it back and answer in kind.
        if (!sRetaliation[idx] && members[lb].length > 0 && rng() < p.strikeReveal && pDied[from] === Infinity) {
          const vm = members[lb];
          const avenger = vm[Math.floor(rng() * vm.length)];
          if (tierOf(lb, t) >= STRIKE_TIER && rng() < pGenome[avenger][AGGRESSION]) fireStrike(avenger, from, t, true);
        }
        break;
      }
      case BERSERK: {
        const swarm = ev.a;
        const node = ev.b;
        const key = swarm * uni.n + node;
        if (swarmSeen.has(key)) break;
        swarmSeen.add(key);
        const maker = swarmMaker[swarm];
        const o = owner[node];
        // They kill whatever is bright enough to notice, except their makers.
        if (o >= 0 && pLineage[o] !== maker && heatAt(o, t) >= p.berserkerSense) {
          const victim = pLineage[o];
          sFrom.push(node);
          sTo.push(node);
          sLineage.push(maker);
          sTarget.push(o);
          sVictim.push(victim);
          sLaunched.push(t);
          sArrived.push(t);
          sHit.push(1);
          sRetaliation.push(true);
          sterileUntil[node] = t + p.sterileTime;
          kill(o, t);
          afflict(victim);
          tally.berserkerKills++;
          if (members[victim].length === 0) log(t, 'strike', `Berserkers of the ${civs[maker].name} finish off the ${civs[victim].name}.`, 30, maker);
        }
        if (rng() < p.berserkerDecay) break;
        for (const j of uni.neighbors(node)) {
          if (swarmSeen.has(swarm * uni.n + j)) continue;
          const ta = cosmo.coast(t, uni.dist(node, j), p.berserkerSpeed);
          if (ta < p.tEnd) q.push(ta, BERSERK, swarm, j);
        }
        break;
      }
      case ARRIVE: {
        const s = ev.a;
        const node = ev.b;
        const o = owner[node];
        if (o === -1) {
          if (t < sterileUntil[node]) break;
          if (restrained(pGenome[s]) && youngCivAt(node)) break;
          acquire(node, pLineage[s], capped(mutate(pGenome[s], p.mutationSigma, rng)), s, t);
          tally.settlements++;
          break;
        }
        if (o === s || isKin(s, o)) break;
        const la = pLineage[s];
        const lb = pLineage[o];
        if (la !== lb) meet(la, lb, t);
        const gs = pGenome[s];
        const go = pGenome[o];
        // Two communal lineages that meet join forces instead of fighting.
        if (la !== lb && gs[UNITY] >= 0.5 && go[UNITY] >= 0.5) {
          unite(la, lb);
          tally.alliances++;
          log(t, 'contact', `The ${civs[la].name} and the ${civs[lb].name} unite.`, 60, la);
          break;
        }
        // Members of the club don't fight each other.
        if (restrained(gs) && restrained(go)) break;
        if (rng() >= gs[AGGRESSION] * (1 - 0.8 * go[STEALTH])) break;
        if (protectedByClub(o, s, t)) punish(s, t);
        // Energy decides it. The attackers bring their home group's force,
        // weakened by the distance they came; the defenders fight at home.
        const tSource = Math.min(t, pDied[s]);
        const attack = forceOf(s, tSource) * Math.exp(-uni.dist(pNode[s], node) / p.supportReach);
        const defend = p.defenderAdvantage * forceOf(o, t);
        const wa = Math.pow(attack, p.warExponent);
        const wd = Math.pow(defend, p.warExponent);
        const win = wa + wd > 0 ? wa / (wa + wd) : 0.5;
        if (rng() < win) {
          if (la !== lb) log(t, 'war', `The ${civs[la].name} take a group from the ${civs[lb].name}.`, 40, la);
          // The conquerors inherit what the defenders had built and settled.
          const wasFilled = fillOf(o, t);
          kill(o, t);
          acquire(node, la, capped(mutate(gs, p.mutationSigma, rng)), s, t, wasFilled);
          tally.conquests++;
        } else {
          tally.repelled++;
          // Repelled, and an aggressive defender now knows where the attack came from.
          if (go[AGGRESSION] > 0.5) launch(o, pNode[s], t);
        }
        break;
      }
      case COLLAPSE: {
        if (pDied[ev.a] === Infinity) {
          kill(ev.a, t);
          tally.collapses++;
        }
        break;
      }
      case ENCOUNTER: {
        encounter(ev.a, ev.b, t);
        break;
      }
      case RELOOK: {
        relook(civs[ev.a], t, ev.b);
        break;
      }
      case SAMPLE: {
        const mean = new Array<number>(N_TRAITS).fill(0);
        const bins = new Float32Array(CENSUS_BINS);
        let alive = 0;
        // The living holdings only, by owner, rather than every polity that ever was:
        // over a long run the dead outnumber the living many times over.
        for (const node of everSettled) {
          const k = owner[node];
          if (k < 0) continue;
          alive++;
          const g = pGenome[k];
          for (let i = 0; i < N_TRAITS; i++) mean[i] += g[i];
          const heat = heatAt(k, t);
          if (heat <= 0) continue;
          const b = censusBin(heat);
          bins[b]++;
          if (b > brightestBin) brightestBin = b;
        }
        // Complementary cumulative: bins[b] = polities with range ≥ the bottom of bin b.
        for (let b = CENSUS_BINS - 2; b >= 0; b--) bins[b] += bins[b + 1];
        census.push(bins);
        // NaN, not 0, when nobody is alive — otherwise empty universes read as low-trait ones.
        for (let i = 0; i < N_TRAITS; i++) mean[i] = alive > 0 ? mean[i] / alive : NaN;
        series.push({ t, settled: settledCount / uni.n, lineagesAlive, quietAlive, meanGenome: mean, observers, silent, strikes: tally.strikes });
        break;
      }
      case EPOCH: {
        log(
          t,
          'epoch',
          `Present day. ${observers} civilisations have looked up so far; ${silent} saw an empty sky. ` +
            `${lineagesAlive} lineages hold ${((100 * settledCount) / uni.n).toFixed(1)}% of all groups; ${tally.strikes} strikes fired.`,
        );
        break;
      }
    }
  };

  return { advance, get time() { return simT; }, get done() { return done; }, result: snapshot };

  /** The run so far as a self-contained result: fresh arrays, safe to hand to another thread. */
  function snapshot(): SimResult {
  for (const c of civs) c.alliance = allyOf(c.id);

  const np = pNode.length;
  const genome = new Float32Array(np * N_TRAITS);
  for (let k = 0; k < np; k++) genome.set(pGenome[k], k * N_TRAITS);

  return {
    params: p,
    universe: { nodes: uni.n, boxGly: uni.L, galaxiesPerNode: uni.galaxiesPerNode, scaleToObservable: uni.scaleToObservable },
    cosmology: { age: cosmo.age, eventHorizonNow: cosmo.Dinf - cosmo.D(cosmo.age), Dinf: cosmo.Dinf },
    expectedOrigins: sample.expected,
    saturated: sample.saturated,
    civs,
    polities: {
      node: Int32Array.from(pNode),
      lineage: Int32Array.from(pLineage),
      parent: Int32Array.from(pParent),
      born: Float32Array.from(pBorn),
      died: Float32Array.from(pDied),
      fillStart: Float32Array.from(pFillStart),
      fillTime: Float32Array.from(pFillTime),
      genome,
    },
    strikes: {
      from: Int32Array.from(sFrom),
      to: Int32Array.from(sTo),
      lineage: Int32Array.from(sLineage),
      victim: Int32Array.from(sVictim),
      launched: Float32Array.from(sLaunched),
      arrived: Float32Array.from(sArrived),
      hit: Uint8Array.from(sHit),
    },
    series,
    chronicle: chronicle.sort((a, b) => a.t - b.t),
    positions: { x: uni.x, y: uni.y, z: uni.z, mass: uni.mass },
    runtimeMs: busyMs,
    events,
    truncated,
    tally,
  };
  }
}
