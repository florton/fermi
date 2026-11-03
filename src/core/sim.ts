/**
 * The run: technological species arise on the schedule biology.ts drew for them,
 * look at the sky, survive or don't, and the ones that expand settle node after
 * node, carrying a mutating genome with them, until the run ends or the
 * expansion of the universe puts everything else out of reach.
 *
 * Vocabulary:
 *   civ      one technological origin — a species and the lineage it founds
 *   polity   one lineage's hold on one node, from settlement to collapse or conquest
 *   observer a civ at the moment it becomes technological, looking at its past light cone
 *
 * The experiment is the observers. Each one records which other lineages it can
 * see, the way we look at our own sky, and later whether and when someone
 * arrives. "Silent" means it saw nobody.
 */

import { buildStepTable, sampleOrigins } from './biology.ts';
import { makeCosmology, type Cosmology } from './cosmology.ts';
import {
  AGGRESSION,
  CAUTION,
  EXPANSIONISM,
  N_TRAITS,
  SPEED,
  STEALTH,
  genomeDistance,
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
  saw: { lineages: number; nearest: number } | null;
  /** When a foreign lineage first settled this civ's home node, if ever. */
  tEngulfed: number;
  /** Most nodes the lineage held at once. */
  peak: number;
}

export interface ChronicleEntry {
  t: number;
  kind: 'origin' | 'filter' | 'expand' | 'contact' | 'war' | 'extinct' | 'milestone' | 'zoo' | 'epoch';
  text: string;
}

export interface Sample {
  t: number;
  /** Fraction of nodes held by some polity. */
  settled: number;
  lineagesAlive: number;
  quietAlive: number;
  /** Mean genome over living polities. */
  meanGenome: number[];
  /** Observers so far, and how many of them saw nothing. */
  observers: number;
  silent: number;
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

export interface SimResult {
  params: SimParams;
  universe: { nodes: number; boxGly: number; galaxiesPerNode: number; scaleToObservable: number };
  cosmology: { age: number; eventHorizonNow: number; Dinf: number };
  expectedOrigins: number;
  saturated: boolean;
  civs: Civ[];
  polities: Polities;
  series: Sample[];
  chronicle: ChronicleEntry[];
  positions: { x: Float32Array; y: Float32Array; z: Float32Array; mass: Float32Array };
  runtimeMs: number;
  events: number;
  /** Hit params.maxEvents and stopped early. */
  truncated: boolean;
  tally: { launches: number; settlements: number; conquests: number; repelled: number; collapses: number };
}

const EMERGE = 0;
const SPACEFARING = 1;
const ARRIVE = 2;
const COLLAPSE = 3;
const SAMPLE = 4;
const EPOCH = 5;

export function runSim(p: SimParams): SimResult {
  const started = performance.now();
  const rng = mulberry32(p.seed);
  const cosmo: Cosmology = makeCosmology();
  const uni: Universe = makeUniverse(p);
  const maxWindow = Math.max(...p.starClasses.map((c) => c.window));
  const table = buildStepTable(p, Math.min(maxWindow, p.tEnd) + 1);
  const sample = sampleOrigins(p, cosmo, uni, table, rng);

  const civs: Civ[] = sample.origins.map((o, id) => ({
    id,
    name: lineageName(id),
    node: o.node,
    tForm: o.tForm,
    tTech: o.tTech,
    starClass: o.starClass,
    genome: randomGenome(rng),
    fate: 'pending',
    tFate: NaN,
    saw: null,
    tEngulfed: NaN,
    peak: 0,
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
  const pRange: number[] = [];
  // Each node's polities as a linked list, newest first, and the nodes that have ever had one.
  const pPrevAtNode: number[] = [];
  const nodeHead = new Int32Array(uni.n).fill(-1);
  const everSettled: number[] = [];
  // A polity launches toward a given target at most once. Without this, every
  // conquest re-launches at every neighbour and wars cascade without bound.
  const launched = new Set<number>();

  const owner = new Int32Array(uni.n).fill(-1);
  const residents = new Map<number, number[]>();
  const lineageAlive = new Int32Array(civs.length);
  let settledCount = 0;
  let lineagesAlive = 0;
  let quietAlive = 0;
  let observers = 0;
  let silent = 0;

  const series: Sample[] = [];
  const chronicle: ChronicleEntry[] = [];
  const kindCount = new Map<string, number>();
  const log = (t: number, kind: ChronicleEntry['kind'], text: string, cap = Infinity) => {
    const n = kindCount.get(kind) ?? 0;
    if (n >= cap || chronicle.length >= p.maxChronicle) return;
    kindCount.set(kind, n + 1);
    chronicle.push({ t, kind, text });
  };
  const contacts = new Set<number>();

  const q = new EventQueue();
  for (const c of civs) q.push(c.tTech, EMERGE, c.id);
  for (let t = 0; t <= p.tEnd; t += p.sampleEvery) q.push(t, SAMPLE);
  if (cosmo.age < p.tEnd) q.push(cosmo.age, EPOCH);

  const speedOf = (g: Genome) => p.speedMin + (p.speedMax - p.speedMin) * g[SPEED];
  const isKin = (a: number, b: number) =>
    pLineage[a] === pLineage[b] && genomeDistance(pGenome[a], pGenome[b]) < p.kinThreshold;

  const launch = (from: number, target: number, t: number) => {
    const key = from * uni.n + target;
    if (launched.has(key)) return;
    launched.add(key);
    const g = pGenome[from];
    const held = owner[target] >= 0 && !isKin(from, owner[target]);
    // Only the aggressive bother sending anything at a held node; a peaceful probe would just turn back.
    if (held && rng() >= g[AGGRESSION]) return;
    const meanDelay =
      (p.launchDelay * (1 + g[CAUTION]) * (1 + g[STEALTH]) * (1 + 2 * g[SPEED] * g[SPEED])) /
      (0.2 + g[EXPANSIONISM]);
    const tl = t + exponential(rng, 1 / meanDelay) + (held ? exponential(rng, 1 / p.siegeDelay) : 0);
    const ta = cosmo.arrival(tl, uni.dist(pNode[from], target), speedOf(g));
    if (ta < p.tEnd) {
      q.push(ta, ARRIVE, from, target);
      tally.launches++;
    }
  };

  const acquire = (node: number, lineage: number, genome: Genome, parent: number, t: number) => {
    const id = pNode.length;
    pNode.push(node);
    pLineage.push(lineage);
    pParent.push(parent);
    pBorn.push(t);
    pDied.push(Infinity);
    pGenome.push(genome);
    pRange.push(p.detectRange * Math.sqrt(visibility(genome) * uni.mass[node]));
    if (nodeHead[node] === -1) everSettled.push(node);
    pPrevAtNode.push(nodeHead[node]);
    nodeHead[node] = id;
    owner[node] = id;
    settledCount++;
    if (lineageAlive[lineage]++ === 0) lineagesAlive++;
    const civ = civs[lineage];
    if (lineageAlive[lineage] > civ.peak) {
      civ.peak = lineageAlive[lineage];
      if (civ.peak === 10 || civ.peak === 100 || civ.peak === 1000 || civ.peak === 10000)
        log(t, 'milestone', `The ${civ.name} hold ${civ.peak} galaxy groups.`);
    }

    const here = civsAt.get(node);
    if (here) for (const cid of here) if (cid !== lineage && Number.isNaN(civs[cid].tEngulfed)) civs[cid].tEngulfed = t;

    const g = genome;
    const hazard = p.collapseRate * (0.5 + g[AGGRESSION]) * (1.5 - g[CAUTION]);
    const tc = t + exponential(rng, hazard);
    if (tc < p.tEnd) q.push(tc, COLLAPSE, id);

    for (const j of uni.neighbors(node)) {
      const o = owner[j];
      if (o >= 0 && isKin(id, o)) continue;
      launch(id, j, t);
    }

    // Anyone already living here quietly now lives inside someone's territory.
    const res = residents.get(node);
    if (res) {
      for (let k = res.length - 1; k >= 0; k--) {
        const c = civs[res[k]];
        if (c.id === lineage) continue;
        if (rng() < g[AGGRESSION] * (1 - 0.8 * c.genome[STEALTH])) {
          c.fate = 'destroyed';
          c.tFate = t;
          res.splice(k, 1);
          quietAlive--;
          log(t, 'war', `The ${civ.name} reach the ${c.name}' home and wipe them out.`, 40);
        } else {
          log(t, 'zoo', `The ${civ.name} find the ${c.name} and leave them be.`, 30);
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
    if (--lineageAlive[lineage] === 0) {
      lineagesAlive--;
      const c = civs[lineage];
      if (c.peak >= 5) log(t, 'extinct', `The last of the ${c.name} falls. At their height they held ${c.peak} groups.`, 80);
    }
    // The vacancy is an opportunity for whoever is next door.
    for (const j of uni.neighbors(node)) {
      const o = owner[j];
      if (o >= 0) launch(o, node, t);
    }
  };

  const meet = (la: number, lb: number, t: number) => {
    const key = Math.min(la, lb) * 1_000_003 + Math.max(la, lb);
    if (contacts.has(key)) return;
    contacts.add(key);
    log(t, 'contact', `First contact: the ${civs[la].name} and the ${civs[lb].name}.`, 80);
  };

  const observe = (c: Civ, t: number) => {
    const seen = new Set<number>();
    let nearest = Infinity;
    for (const node of everSettled) {
      const d = uni.dist(c.node, node);
      // Nobody at this node can be seen from further than a fully unhidden polity could.
      if (d > p.detectRange * Math.sqrt(uni.mass[node])) continue;
      const te = cosmo.emission(t, d);
      if (te < 0) continue;
      // The light arriving now left at te: find who held the node then.
      for (let k = nodeHead[node]; k >= 0; k = pPrevAtNode[k]) {
        if (pBorn[k] > te) continue;
        if (te < pDied[k] && d <= pRange[k]) {
          seen.add(pLineage[k]);
          if (d < nearest) nearest = d;
        }
        break;
      }
    }
    c.saw = { lineages: seen.size, nearest };
    observers++;
    if (seen.size === 0) silent++;
  };

  const tally = { launches: 0, settlements: 0, conquests: 0, repelled: 0, collapses: 0 };
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
        if (owner[c.node] >= 0 && rng() < p.preemption) {
          c.fate = 'preempted';
          c.tFate = t;
          break;
        }
        observe(c, t);
        log(t, 'origin', `The ${c.name} become technological (${p.starClasses[c.starClass].name} star) and see ${c.saw!.lineages || 'no'} other civilisations.`, 25);
        const survival = Math.pow(p.filterSurvival, 2 * (1 - c.genome[CAUTION]));
        if (rng() >= survival) {
          c.fate = 'filtered';
          c.tFate = t + rng() * p.techToSpacefaring;
          log(c.tFate, 'filter', `The ${c.name} do not survive their own technology.`, 10);
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
        log(t, 'expand', `The ${c.name} begin to spread beyond their home group.`, 30);
        acquire(c.node, c.id, c.genome, -1, t);
        break;
      }
      case ARRIVE: {
        const s = ev.a;
        const node = ev.b;
        const o = owner[node];
        if (o === -1) {
          acquire(node, pLineage[s], mutate(pGenome[s], p.mutationSigma, rng), s, t);
          tally.settlements++;
          break;
        }
        if (o === s || isKin(s, o)) break;
        const la = pLineage[s];
        const lb = pLineage[o];
        if (la !== lb) meet(la, lb, t);
        const gs = pGenome[s];
        const go = pGenome[o];
        if (rng() >= gs[AGGRESSION] * (1 - 0.8 * go[STEALTH])) break;
        const ps = power(gs);
        const po = p.defenderAdvantage * power(go);
        if (rng() < ps / (ps + po)) {
          if (la !== lb) log(t, 'war', `The ${civs[la].name} take a group from the ${civs[lb].name}.`, 40);
          kill(o, t);
          acquire(node, la, mutate(gs, p.mutationSigma, rng), s, t);
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
        let alive = 0;
        for (let k = 0; k < pNode.length; k++) {
          if (pDied[k] !== Infinity) continue;
          alive++;
          const g = pGenome[k];
          for (let i = 0; i < N_TRAITS; i++) mean[i] += g[i];
        }
        // NaN, not 0, when nobody is alive — otherwise empty universes read as low-trait ones.
        for (let i = 0; i < N_TRAITS; i++) mean[i] = alive > 0 ? mean[i] / alive : NaN;
        series.push({ t, settled: settledCount / uni.n, lineagesAlive, quietAlive, meanGenome: mean, observers, silent });
        break;
      }
      case EPOCH: {
        log(
          t,
          'epoch',
          `Present day. ${observers} civilisations have looked up so far; ${silent} saw an empty sky. ` +
            `${lineagesAlive} lineages hold ${(100 * settledCount / uni.n).toFixed(1)}% of all groups.`,
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
    series,
    chronicle: chronicle.sort((a, b) => a.t - b.t),
    positions: { x: uni.x, y: uni.y, z: uni.z, mass: uni.mass },
    runtimeMs: performance.now() - started,
    events,
    truncated,
    tally,
  };
}
