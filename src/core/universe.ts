/**
 * The large-scale structure: where the matter is.
 *
 * Pruning, level one. The observable universe holds a few hundred billion
 * galaxies; this holds tens of thousands of *nodes*, each standing for a galaxy
 * group. That is the right granularity because the interesting clock is
 * intergalactic: once a civilisation can cross its own galaxy it does so in a few
 * million years, which is noise against the Gyr it takes to cross between groups.
 * So a node is either settled or not, and nothing below it is modelled until
 * something happens there.
 *
 * The box is periodic and comoving. It is a sample of the universe, not all of
 * it; rates are calibrated per unit volume so that counts scale to the
 * observable universe by `scaleToObservable`.
 */

import { MPC_PER_GLY } from './cosmology.ts';
import type { SimParams } from './params.ts';
import { mulberry32, normal, type Rng } from './rng.ts';

/** Comoving radius of the observable universe today, Gly. */
const OBSERVABLE_RADIUS_GLY = 46.5;

export interface Universe {
  readonly n: number;
  /** Box side, comoving Gly. */
  readonly L: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Relative stellar mass of each node, mean 1. */
  readonly mass: Float32Array;
  /** Real galaxies each node stands for. */
  readonly galaxiesPerNode: number;
  /** Observable-universe volume ÷ box volume. */
  readonly scaleToObservable: number;
  /** Comoving distance with periodic wrap. */
  dist(i: number, j: number): number;
  /** The k nearest other nodes, computed on first request. */
  neighbors(i: number): Int32Array;
}

export function makeUniverse(p: SimParams, rng: Rng = mulberry32(p.seed * 7919 + 1)): Universe {
  const n = p.nodes;
  const L = p.boxGly;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = new Float32Array(n);
  const mass = new Float32Array(n);

  // A crude cosmic web: some nodes in Gaussian clusters, the rest in the field.
  const spacing = L / Math.cbrt(n);
  const nClusters = Math.max(1, Math.round(n / 60));
  const cx = new Float32Array(nClusters);
  const cy = new Float32Array(nClusters);
  const cz = new Float32Array(nClusters);
  for (let c = 0; c < nClusters; c++) {
    cx[c] = rng() * L;
    cy[c] = rng() * L;
    cz[c] = rng() * L;
  }
  const wrap = (v: number) => ((v % L) + L) % L;
  const sigma = 1.2 * spacing;
  let massSum = 0;
  for (let i = 0; i < n; i++) {
    let clustered = false;
    if (rng() < p.clusterFrac) {
      const c = Math.floor(rng() * nClusters);
      x[i] = wrap(cx[c] + sigma * normal(rng));
      y[i] = wrap(cy[c] + sigma * normal(rng));
      z[i] = wrap(cz[c] + sigma * normal(rng));
      clustered = true;
    } else {
      x[i] = rng() * L;
      y[i] = rng() * L;
      z[i] = rng() * L;
    }
    // Groups in clusters are heavier on average.
    mass[i] = Math.exp(0.9 * normal(rng) + (clustered ? 0.3 : 0));
    massSum += mass[i];
  }
  for (let i = 0; i < n; i++) mass[i] *= n / massSum;

  const boxMpc3 = Math.pow(L * MPC_PER_GLY, 3);
  const galaxiesPerNode = (p.galaxyDensity * boxMpc3) / n;
  const scaleToObservable = ((4 / 3) * Math.PI * Math.pow(OBSERVABLE_RADIUS_GLY, 3)) / Math.pow(L, 3);

  // Uniform grid for neighbour search.
  const G = Math.max(1, Math.floor(Math.cbrt(n / 4)));
  const cell = L / G;
  const cellOf = (v: number) => Math.min(G - 1, Math.floor(v / cell));
  const counts = new Int32Array(G * G * G + 1);
  const key = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    key[i] = (cellOf(x[i]) * G + cellOf(y[i])) * G + cellOf(z[i]);
    counts[key[i] + 1]++;
  }
  for (let c = 0; c < G * G * G; c++) counts[c + 1] += counts[c];
  const start = counts.slice();
  const items = new Int32Array(n);
  for (let i = 0; i < n; i++) items[start[key[i]]++] = i;

  const half = L / 2;
  const d1 = (a: number, b: number) => {
    let d = Math.abs(a - b);
    if (d > half) d = L - d;
    return d;
  };
  const dist = (i: number, j: number) => {
    const dx = d1(x[i], x[j]);
    const dy = d1(y[i], y[j]);
    const dz = d1(z[i], z[j]);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  const cache: (Int32Array | undefined)[] = new Array(n);
  const k = p.kNeighbors;
  const neighbors = (i: number) => {
    const hit = cache[i];
    if (hit) return hit;
    const gx = cellOf(x[i]);
    const gy = cellOf(y[i]);
    const gz = cellOf(z[i]);
    let found: { j: number; d: number }[] = [];
    // Grow the searched cube until it holds a comfortable surplus of candidates.
    // Stops before the cube wraps onto itself, which would list cells twice.
    for (let r = 1; 2 * r + 1 <= G || r === 1; r++) {
      found = [];
      for (let ox = -r; ox <= r; ox++)
        for (let oy = -r; oy <= r; oy++)
          for (let oz = -r; oz <= r; oz++) {
            const c = ((((gx + ox) % G) + G) % G * G + ((((gy + oy) % G) + G) % G)) * G + ((((gz + oz) % G) + G) % G);
            for (let s = counts[c]; s < counts[c + 1]; s++) {
              const j = items[s];
              if (j !== i) found.push({ j, d: dist(i, j) });
            }
          }
      if (found.length >= k * 3 || 2 * r + 1 >= G) break;
    }
    found.sort((a, b) => a.d - b.d);
    const out = Int32Array.from(found.slice(0, k), (f) => f.j);
    cache[i] = out;
    return out;
  };

  return { n, L, x, y, z, mass, galaxiesPerNode, scaleToObservable, dist, neighbors };
}
