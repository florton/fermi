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
 * Seeing has consequences. A lineage with strike capability periodically looks
 * at its own sky and, if aggressive, fires at what it finds; a strike can be
 * traced back. That is the dark-forest hypothesis made into a mechanism, so
 * whether hiding pays is something the run decides rather than something assumed.
 *
 * The experiment is still the observers. Each one records which lineages it can
 * see inside the box, and — beyond half the box, where the box can't be
 * simulated directly — how many it would expect to see if the rest of the
 * universe looks like this sample. "Silent" means it saw nobody either way.
 */

import { buildStepTable, sampleOrigins } from './biology.ts';
import { makeCosmology, type Cosmology } from './cosmology.ts';
import {
  AGGRESSION,
  CAUTION,
  EXPANSIONISM,
  INWARDNESS,
  N_TRAITS,
  RESTRAINT,
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
import { EventQueue } from './heap.ts';
import { lineageName } from './names.ts';
import type { SimParams } from './params.ts';
import { exponential, mulberry32 } from './rng.ts';
import { STRIKE_TIER, TIERS, luminosity, tierAt } from './tech.ts';
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
  /** When the lineage found the faster-than-light channel; Infinity if never. */
  ftl: number;
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

// Luminosity census bins for the far field: detection range at sensor 1, log-spaced.
const CENSUS_BINS = 64;
const CENSUS_MIN = 0.01;
const CENSUS_PER_DECADE = 16;

export function runSim(p: SimParams): SimResult {
  const started = performance.now();
  const rng = mulberry32(p.seed);
  const cosmo: Cosmology = makeCosmology();
  const uni: Universe = makeUniverse(p);
  const maxWindow = Math.max(...p.starClasses.map((c) => c.window));
  const table = buildStepTable(p, Math.min(maxWindow, p.tEnd) + 1);
  const sample = sampleOrigins(p, cosmo, uni, table, rng);
  const halfBox = uni.L / 2;
  const boxVolume = uni.L ** 3;

  // Optional strategies can't exceed what nature allows; everything else spans [0, 1].
  const capped = (g: Genome) => {
    if (g[INWARDNESS] > p.inwardnessCap) g[INWARDNESS] = p.inwardnessCap;
    if (g[RESTRAINT] > p.restraintCap) g[RESTRAINT] = p.restraintCap;
    return g;
  };
  const civs: Civ[] = sample.origins.map((o, id) => ({
    id,
    name: lineageName(id),
    node: o.node,
    tForm: o.tForm,
    tTech: o.tTech,
    starClass: o.starClass,
    genome: capped(randomGenome(rng)),
    fate: 'pending',
    tFate: NaN,
    saw: null,
    tEngulfed: NaN,
    peak: 0,
    tierTimes: [],
    ftl: Infinity,
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
  const tally: Tally = { launches: 0, settlements: 0, conquests: 0, repelled: 0, collapses: 0, strikes: 0, strikeKills: 0, retaliations: 0, tierLosses: 0, swarms: 0, berserkerKills: 0, ftlLineages: 0, punishments: 0 };

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
  const speedOf = (k: number, t: number) =>
    (p.speedMin + (p.speedMax - p.speedMin) * pGenome[k][SPEED]) * TIERS[Math.max(0, tierOf(pLineage[k], t))].speed;
  const isKin = (a: number, b: number) =>
    pLineage[a] === pLineage[b] && genomeDistance(pGenome[a], pGenome[b]) < p.kinThreshold;
  const strength = (k: number, t: number) =>
    power(pGenome[k], p.stealthCost) *
    TIERS[Math.max(0, tierOf(pLineage[k], t))].power *
    (1 + p.lineageStrength * Math.log10(Math.max(1, members[pLineage[k]].length)));

  /** Waste heat of polity k's node as emitted at time te. */
  const lumAt = (k: number, te: number) => {
    // With a cloaking channel, a holder can push its waste heat out of normal space:
    // stealth then has no floor, and full stealth is true invisibility.
    const cloaked = p.ftlCloak > 0 && civs[pLineage[k]].ftl <= te;
    const vis = cloaked ? visibility(pGenome[k], 0) : pVis[k];
    return luminosity(tierOf(pLineage[k], te), te - pBorn[k], p.conversionTime, vis, uni.mass[pNode[k]]);
  };
  /** Can light emitted at te from distance d be seen at tObs with this sensor? */
  const detectable = (d: number, te: number, tObs: number, lum: number, sensor: number) =>
    lum > 0 && d * (cosmo.a(tObs) / cosmo.a(te)) <= p.detectRange * sensor * Math.sqrt(lum);
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
    const meanDelay =
      (p.launchDelay * (1 + g[CAUTION]) * (1 + p.stealthCost * g[STEALTH]) * (1 + 2 * g[SPEED] * g[SPEED]) * (1 + 3 * g[INWARDNESS])) /
      (0.2 + g[EXPANSIONISM]);
    const tl = Math.max(t, notBefore) + exponential(rng, 1 / meanDelay) + (held ? exponential(rng, 1 / p.siegeDelay) : 0);
    const ta = cosmo.arrival(tl, uni.dist(pNode[from], target), speedOf(from, tl));
    if (ta < p.tEnd) {
      q.push(ta, ARRIVE, from, target);
      tally.launches++;
    }
  };

  const acquire = (node: number, lineage: number, genome: Genome, parent: number, t: number) => {
    if (genome[STEALTH] < fear[lineage]) genome[STEALTH] = fear[lineage];
    const id = pNode.length;
    pNode.push(node);
    pLineage.push(lineage);
    pParent.push(parent);
    pBorn.push(t);
    pDied.push(Infinity);
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

    // Anyone already living here quietly now lives inside someone's territory.
    const res = residents.get(node);
    if (res) {
      for (let k = res.length - 1; k >= 0; k--) {
        const c = civs[res[k]];
        if (c.id === lineage) continue;
        if (!restrained(g) && rng() < g[AGGRESSION] * (1 - 0.8 * c.genome[STEALTH])) {
          c.fate = 'destroyed';
          c.tFate = t;
          res.splice(k, 1);
          quietAlive--;
          log(t, 'war', `The ${civ.name} reach the ${c.name}' home and wipe them out.`, 40, lineage);
        } else {
          log(t, 'zoo', `The ${civ.name} find the ${c.name} and leave them be.`, 30, lineage);
        }
      }
    }
    return id;
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
    const ta = cosmo.arrival(t, uni.dist(pNode[from], to), p.strikeSpeed);
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
  /** Expected visible nodes beyond half the box, at sensor 1, assuming the box is a fair sample. */
  const farExpectation = (t: number) => {
    if (!p.farField || census.length === 0) return 0;
    const dd = 0.05;
    let expected = 0;
    for (let d = halfBox + dd / 2; ; d += dd) {
      const te = cosmo.emission(t, d);
      if (te < 0) break;
      const si = Math.min(census.length - 1, Math.floor(te / p.sampleEvery));
      const c = census[si];
      // Need range ≥ d·(1+z).
      const need = d * (cosmo.a(t) / cosmo.a(te));
      const bin = Math.ceil(CENSUS_PER_DECADE * Math.log10(need / CENSUS_MIN));
      if (bin > brightestBin) break; // nothing in any census is that bright, and further is only dimmer
      const count = bin < 0 ? c[0] : c[bin];
      expected += (count / boxVolume) * 4 * Math.PI * d * d * dd;
    }
    return expected;
  };

  // How far away holdings in one's own galaxy group are, for seeing them.
  const intraNode = (p.intraNodeSeeing * uni.L) / Math.cbrt(uni.n);

  const observe = (c: Civ, t: number) => {
    const seen = new Set<number>();
    let nearest = Infinity;
    for (const node of everSettled) {
      const d = Math.max(uni.dist(c.node, node), node === c.node ? intraNode : 0);
      if (d > halfBox) continue;
      const te = cosmo.emission(t, d);
      if (te < 0) continue;
      // The light arriving now left at te: find who held the node then.
      const k = holderAt(node, te);
      if (k < 0 || !detectable(d, te, t, lumAt(k, te), 1)) continue;
      seen.add(pLineage[k]);
      if (d < nearest) nearest = d;
    }
    const farExpected = farExpectation(t);
    const far = rng() < 1 - Math.exp(-farExpected);
    c.saw = { lineages: seen.size, nearest, farExpected, far, hostHere: owner[c.node] >= 0 };
    observers++;
    if (seen.size === 0 && !far) silent++;
    // A species that looks up and sees it isn't alone may learn to keep quiet.
    if (seen.size > 0 || far) {
      c.genome[STEALTH] = Math.min(1, c.genome[STEALTH] + p.skyResponse);
      c.genome[CAUTION] = Math.min(1, c.genome[CAUTION] + p.skyResponse / 2);
    }
  };

  // ── Event loop ───────────────────────────────────────────────────────────
  let events = 0;
  let truncated = false;
  for (let ev = q.pop(); ev; ev = q.pop()) {
    const t = ev.t;
    if (t > p.tEnd) break;
    if (++events > p.maxEvents) {
      truncated = true;
      break;
    }
    switch (ev.kind) {
      case EMERGE: {
        const c = civs[ev.a];
        // A restrained holder lets the natives arise: the zoo.
        const holder = owner[c.node];
        if (holder >= 0 && !restrained(pGenome[holder]) && rng() < p.preemption) {
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
        log(t, 'origin', `The ${c.name} become technological (${p.starClasses[c.starClass].name} star) and see ${what}.`, 25, c.id);
        const survival = Math.pow(p.filterSurvival, 2 * (1 - c.genome[CAUTION]));
        if (rng() >= survival) {
          c.fate = 'filtered';
          c.tFate = t + rng() * p.techToSpacefaring;
          log(c.tFate, 'filter', `The ${c.name} do not survive their own technology.`, 10, c.id);
          break;
        }
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
        for (let k = 0; k < TIERS.length; k++) {
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
        const sensor = TIERS[Math.max(0, tierOf(lineage, t))].sensor;
        const from = pNode[v];
        // Once, an aggressive lineage may let loose killers that will outlive it.
        if (p.berserkerChance > 0 && !released[lineage] && rng() < p.berserkerChance) {
          released[lineage] = 1;
          swarmMaker.push(lineage);
          q.push(t, BERSERK, swarmMaker.length - 1, from);
          tally.swarms++;
          log(t, 'strike', `The ${civs[lineage].name} release self-replicating berserker probes.`, 30, lineage);
        }
        const targets: { k: number; d: number }[] = [];
        for (const node of everSettled) {
          const o = owner[node];
          if (o < 0 || pLineage[o] === lineage) continue;
          if (restrained(g) && restrained(pGenome[o])) continue;
          const d = uni.dist(from, node);
          if (d > halfBox) continue;
          const te = cosmo.emission(t, d);
          const k = te < 0 ? -1 : holderAt(node, te);
          // It has to have been visible then, and the same polity has to still be there now.
          // Channel holders sense each other now, however dim or far; everyone else needs light.
          const sensed = hasFtl(lineage, t) && hasFtl(pLineage[o], t);
          if (!sensed && (k !== o || !detectable(d, te, t, lumAt(k, te), sensor))) continue;
          targets.push({ k: o, d });
        }
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
        if (o >= 0 && pLineage[o] !== maker && lumAt(o, t) >= p.berserkerSense) {
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
          const ta = cosmo.arrival(t, uni.dist(node, j), p.berserkerSpeed);
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
        // Members of the club don't fight each other.
        if (restrained(gs) && restrained(go)) break;
        if (rng() >= gs[AGGRESSION] * (1 - 0.8 * go[STEALTH])) break;
        if (protectedByClub(o, s, t)) punish(s, t);
        const ps = strength(s, t);
        const po = p.defenderAdvantage * strength(o, t);
        if (rng() < ps / (ps + po)) {
          if (la !== lb) log(t, 'war', `The ${civs[la].name} take a group from the ${civs[lb].name}.`, 40, la);
          kill(o, t);
          acquire(node, la, capped(mutate(gs, p.mutationSigma, rng)), s, t);
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
      case SAMPLE: {
        const mean = new Array<number>(N_TRAITS).fill(0);
        const bins = new Float32Array(CENSUS_BINS);
        let alive = 0;
        for (let k = 0; k < pNode.length; k++) {
          if (pDied[k] !== Infinity) continue;
          alive++;
          const g = pGenome[k];
          for (let i = 0; i < N_TRAITS; i++) mean[i] += g[i];
          const lum = lumAt(k, t);
          if (lum <= 0) continue;
          const range = p.detectRange * Math.sqrt(lum);
          const b = Math.max(0, Math.min(CENSUS_BINS - 1, Math.floor(CENSUS_PER_DECADE * Math.log10(range / CENSUS_MIN))));
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
  }

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
    runtimeMs: performance.now() - started,
    events,
    truncated,
    tally,
  };
}
