/**
 * Civilisations travel from the worker as columns of typed arrays rather than
 * objects: a run can have 100 000 of them, and cloning that many objects takes
 * hundreds of milliseconds, far too slow to send several times a second while
 * the simulation streams. The parts that never change are sent once.
 */

import { ARCHETYPES } from '../core/archetypes.ts';
import { N_TRAITS } from '../core/genome.ts';
import { lineageName } from '../core/names.ts';
import { FATES, type Civ } from '../core/sim.ts';
import { TIERS } from '../core/tech.ts';

const KINDS = Object.keys(ARCHETYPES);
const NT = TIERS.length;

/** What a civilisation is from the start: sent with the first snapshot only. */
export interface CivStatic {
  node: Int32Array;
  tForm: Float32Array;
  tTech: Float32Array;
  starClass: Uint8Array;
  archetype: Uint8Array;
}

/** What changes as the run goes on. */
export interface CivDynamic {
  fate: Uint8Array;
  tFate: Float32Array;
  tEngulfed: Float32Array;
  firstSeen: Float32Array;
  lastLook: Float32Array;
  peak: Int32Array;
  ftl: Float32Array;
  alliance: Int32Array;
  /** Bit 0: looked up; bit 1: far-field sighting; bit 2: someone already at home. */
  sawFlags: Uint8Array;
  sawLineages: Int32Array;
  sawNearest: Float32Array;
  sawFarExpected: Float32Array;
  genome: Float32Array;
  /** NT per civ; NaN where the tier wasn't reached. */
  tierTimes: Float32Array;
}

export function packStatic(civs: Civ[]): CivStatic {
  const n = civs.length;
  const s: CivStatic = { node: new Int32Array(n), tForm: new Float32Array(n), tTech: new Float32Array(n), starClass: new Uint8Array(n), archetype: new Uint8Array(n) };
  civs.forEach((c, i) => {
    s.node[i] = c.node;
    s.tForm[i] = c.tForm;
    s.tTech[i] = c.tTech;
    s.starClass[i] = c.starClass;
    s.archetype[i] = KINDS.indexOf(c.archetype);
  });
  return s;
}

export function packDynamic(civs: Civ[]): CivDynamic {
  const n = civs.length;
  const d: CivDynamic = {
    fate: new Uint8Array(n),
    tFate: new Float32Array(n),
    tEngulfed: new Float32Array(n),
    firstSeen: new Float32Array(n),
    lastLook: new Float32Array(n),
    peak: new Int32Array(n),
    ftl: new Float32Array(n),
    alliance: new Int32Array(n),
    sawFlags: new Uint8Array(n),
    sawLineages: new Int32Array(n),
    sawNearest: new Float32Array(n),
    sawFarExpected: new Float32Array(n),
    genome: new Float32Array(n * N_TRAITS),
    tierTimes: new Float32Array(n * NT).fill(NaN),
  };
  civs.forEach((c, i) => {
    d.fate[i] = FATES.indexOf(c.fate);
    d.tFate[i] = c.tFate;
    d.tEngulfed[i] = c.tEngulfed;
    d.firstSeen[i] = c.firstSeen;
    d.lastLook[i] = c.lastLook;
    d.peak[i] = c.peak;
    d.ftl[i] = c.ftl;
    d.alliance[i] = c.alliance;
    if (c.saw) {
      d.sawFlags[i] = 1 | (c.saw.far ? 2 : 0) | (c.saw.hostHere ? 4 : 0);
      d.sawLineages[i] = c.saw.lineages;
      d.sawNearest[i] = c.saw.nearest;
      d.sawFarExpected[i] = c.saw.farExpected;
    }
    d.genome.set(c.genome, i * N_TRAITS);
    for (let k = 0; k < c.tierTimes.length && k < NT; k++) d.tierTimes[i * NT + k] = c.tierTimes[k];
  });
  return d;
}

export const buffersOf = (o: object): ArrayBuffer[] => Object.values(o).map((a: ArrayBufferView) => a.buffer as ArrayBuffer);

/** Build civ objects from the static part, then keep them current with `applyDynamic`. */
export function unpackStatic(s: CivStatic): Civ[] {
  return Array.from(s.node, (node, id) => ({
    id,
    name: lineageName(id),
    node,
    tForm: s.tForm[id],
    tTech: s.tTech[id],
    starClass: s.starClass[id],
    archetype: KINDS[s.archetype[id]],
    genome: new Float32Array(N_TRAITS),
    fate: 'pending',
    tFate: NaN,
    saw: null,
    ftl: Infinity,
    alliance: id,
    tEngulfed: NaN,
    firstSeen: NaN,
    lastLook: NaN,
    peak: 0,
    tierTimes: [],
  }));
}

export function applyDynamic(civs: Civ[], d: CivDynamic) {
  for (let i = 0; i < civs.length; i++) {
    const c = civs[i];
    c.fate = FATES[d.fate[i]];
    c.tFate = d.tFate[i];
    c.tEngulfed = d.tEngulfed[i];
    c.firstSeen = d.firstSeen[i];
    c.lastLook = d.lastLook[i];
    c.peak = d.peak[i];
    c.ftl = d.ftl[i];
    c.alliance = d.alliance[i];
    const f = d.sawFlags[i];
    c.saw = f & 1 ? { lineages: d.sawLineages[i], nearest: d.sawNearest[i], farExpected: d.sawFarExpected[i], far: (f & 2) !== 0, hostHere: (f & 4) !== 0 } : null;
    for (let k = 0; k < N_TRAITS; k++) c.genome[k] = d.genome[i * N_TRAITS + k];
    let nt = 0;
    while (nt < NT && !Number.isNaN(d.tierTimes[i * NT + nt])) nt++;
    if (c.tierTimes.length !== nt) c.tierTimes = Array.from(d.tierTimes.subarray(i * NT, i * NT + nt));
  }
}
