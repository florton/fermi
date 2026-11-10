/**
 * Flat ΛCDM background: how big the universe is at each moment, how far light
 * and probes can get, and how many stars it is making.
 *
 * Units throughout the project: time in Gyr, distance in comoving Gly, c = 1.
 * "Comoving" means distances are measured on a grid that expands with the
 * universe, so galaxies sit still in these coordinates and only things that
 * actually move (light, probes) change position.
 *
 * The one integral everything rests on is
 *
 *   D(t) = ∫₀ᵗ c dt' / a(t')
 *
 * the comoving distance light covers from the Big Bang to time t. Light emitted
 * at t₁ reaches comoving distance D(t₂) − D(t₁) by t₂, and a probe at speed v
 * covers v times that. D(t) converges as t → ∞ because of dark energy, which is
 * the cosmic event horizon: there are galaxies that nothing launched today will
 * ever reach, at any speed. The simulation does not impose that limit — it falls
 * out of this table.
 *
 * Probes don't keep their speed. Something coasting through an expanding
 * universe loses momentum relative to the galaxies it passes, p ∝ 1/a (the same
 * stretching that redshifts light), so a probe launched at γβ = u₀ has
 * γβ = u₀·a₀/a later. Its comoving momentum U = u₀·a₀ is conserved, and the
 * comoving distance it covers is
 *
 *   χ(t) = ∫ U dt' / (a √(a² + U²))
 *
 * which tends to D(t) as U → ∞ (light) and to U ∫ dt'/a² for slow probes. A slow
 * probe launched early reaches far less than v·D suggests, and every probe has
 * a finite reach even before dark energy closes the horizon. `coast` tabulates
 * this per value of U.
 */

/** km/s/Mpc → 1/Gyr. */
const KMS_MPC_TO_PER_GYR = 1 / 977.792;
/** Mpc per comoving Gly. */
export const MPC_PER_GLY = 306.601;

export interface Cosmology {
  /** Present age of the universe, Gyr. */
  readonly age: number;
  /** Scale factor, 1 today. */
  a(t: number): number;
  /** Comoving distance light travels from t = 0 to t. */
  D(t: number): number;
  /** Inverse of D. Returns Infinity for d ≥ Dinf. */
  tOfD(d: number): number;
  /** lim D(t) as t → ∞. */
  readonly Dinf: number;
  /**
   * When something leaving at `t0` at speed v (fraction of c) arrives at
   * comoving distance d. Infinity if it never does — beyond the event horizon.
   */
  arrival(t0: number, d: number, v: number): number;
  /**
   * When a probe launched at `t0` at speed v (fraction of c, relative to the
   * galaxies around it) and then coasting arrives at comoving distance d.
   * Infinity if it never does.
   */
  coast(t0: number, d: number, v: number): number;
  /** When light that arrives at `t1` from comoving distance d was emitted. -1 if before t = 0. */
  emission(t1: number, d: number): number;
  /**
   * The same, plus the scale factor then, in one lookup. Returns a shared object
   * that the next call overwrites — read it before calling again.
   */
  emissionWithScale(t1: number, d: number): { t: number; a: number };
  /** Cosmic star formation rate density, Msun / Gyr / comoving Mpc³. */
  sfr(t: number): number;
  /** Stellar mass formed per comoving Mpc³ from t = 0 to t. */
  starsFormed(t: number): number;
}

export interface CosmologyParams {
  H0: number; // km/s/Mpc
  omegaM: number;
  omegaL: number;
}

export const PLANCK18: CosmologyParams = { H0: 67.7, omegaM: 0.31, omegaL: 0.69 };

export function makeCosmology(p: CosmologyParams = PLANCK18, tMax = 200): Cosmology {
  const H = p.H0 * KMS_MPC_TO_PER_GYR;
  const sL = Math.sqrt(p.omegaL);
  const k = Math.cbrt(p.omegaM / p.omegaL);
  const w = 1.5 * sL * H;
  const a = (t: number) => k * Math.pow(Math.sinh(w * t), 2 / 3);
  const age = Math.asinh(Math.sqrt(p.omegaL / p.omegaM)) / w;

  // Tabulate on a grid uniform in s = t^(1/3). In s the integrand
  // 3 s² / a(s³) is smooth and finite at s = 0, where in t it diverges as t^(-2/3).
  const N = 40000;
  const sMax = Math.cbrt(tMax);
  const ds = sMax / N;
  const Dt = new Float64Array(N + 1);
  const integrand = (s: number) => {
    if (s === 0) return 3 / (k * Math.pow(w, 2 / 3));
    const t = s * s * s;
    return (3 * s * s) / a(t);
  };
  for (let i = 1; i <= N; i++) {
    const s0 = (i - 1) * ds;
    const s1 = i * ds;
    // Simpson on each cell.
    Dt[i] = Dt[i - 1] + (ds / 6) * (integrand(s0) + 4 * integrand(0.5 * (s0 + s1)) + integrand(s1));
  }
  // Past tMax the expansion is pure exponential with rate H√ΩΛ.
  const Dinf = Dt[N] + 1 / (a(tMax) * H * sL);

  const D = (t: number) => {
    if (t <= 0) return 0;
    if (t >= tMax) return Dinf - 1 / (a(t) * H * sL);
    const x = Math.cbrt(t) / ds;
    const i = Math.min(N - 1, Math.floor(x));
    const f = x - i;
    return Dt[i] + f * (Dt[i + 1] - Dt[i]);
  };

  // The scale factor on the same grid, so looking up "how stretched was the
  // universe when this light left" costs a table read instead of sinh and pow.
  const At = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) At[i] = a(Math.pow(i * ds, 3));

  /** Grid cell and fraction where D reaches d. Assumes 0 < d < Dt[N]. */
  let locLo = 0;
  let locF = 0;
  const locate = (d: number) => {
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (Dt[mid] < d) lo = mid;
      else hi = mid;
    }
    locLo = lo;
    locF = (d - Dt[lo]) / (Dt[hi] - Dt[lo]);
  };

  const tOfD = (d: number) => {
    if (d <= 0) return 0;
    if (d >= Dinf) return Infinity;
    if (d >= Dt[N]) {
      // Invert the exponential-era form of D used above for a, then a for t.
      const aT = 1 / ((Dinf - d) * H * sL);
      return Math.asinh(Math.pow(aT / k, 1.5)) / w;
    }
    locate(d);
    const s = (locLo + locF) * ds;
    return s * s * s;
  };

  const emitted = { t: 0, a: 0 };
  const emissionWithScale = (t1: number, d: number) => {
    const x = D(t1) - d;
    if (x < 0) {
      emitted.t = -1;
      emitted.a = 0;
    } else if (x <= 0 || x >= Dt[N]) {
      emitted.t = tOfD(x);
      emitted.a = a(emitted.t);
    } else {
      locate(x);
      const s = (locLo + locF) * ds;
      emitted.t = s * s * s;
      emitted.a = At[locLo] + locF * (At[locLo + 1] - At[locLo]);
    }
    return emitted;
  };

  // Madau & Dickinson (2014), eq. 15, Msun/yr/Mpc³ → Msun/Gyr/Mpc³.
  // Written in 1+z = 1/a so it extrapolates smoothly into the future, where it
  // keeps declining roughly as a^-2.7.
  const sfr = (t: number) => {
    if (t <= 0) return 0;
    const opz = 1 / a(t);
    return (1e9 * 0.015 * Math.pow(opz, 2.7)) / (1 + Math.pow(opz / 2.9, 5.6));
  };

  const SF_DT = 0.01;
  const SF_N = Math.ceil(tMax / SF_DT);
  const cumSF = new Float64Array(SF_N + 1);
  for (let i = 1; i <= SF_N; i++) cumSF[i] = cumSF[i - 1] + SF_DT * sfr((i - 0.5) * SF_DT);
  const starsFormed = (t: number) => {
    if (t <= 0) return 0;
    const x = Math.min(SF_N, t / SF_DT);
    const i = Math.min(SF_N - 1, Math.floor(x));
    return cumSF[i] + (x - i) * (cumSF[i + 1] - cumSF[i]);
  };

  // ── Coasting ─────────────────────────────────────────────────────────────
  // One table per value of the conserved comoving momentum U, log-spaced, each on
  // a coarser s-grid than D and built on first use.
  const CN = 2000;
  const cds = sMax / CN;
  const U_LOG_MIN = -5;
  const U_PER_DECADE = 16;
  const U_N = 8 * U_PER_DECADE + 1; // 1e-5 .. 1e3
  const coastTables: (Float64Array | undefined)[] = new Array(U_N);
  const coastTable = (i: number) => {
    let tab = coastTables[i];
    if (tab) return tab;
    const U = Math.pow(10, U_LOG_MIN + i / U_PER_DECADE);
    tab = new Float64Array(CN + 1);
    // In s = t^(1/3), dt = 3s² ds; a ~ s² near 0 so the integrand stays finite.
    const f = (s: number) => {
      if (s === 0) return 3 / (k * Math.pow(w, 2 / 3));
      const aa = a(s * s * s);
      return (3 * s * s * U) / (aa * Math.sqrt(aa * aa + U * U));
    };
    for (let j = 1; j <= CN; j++) {
      const s0 = (j - 1) * cds;
      const s1 = j * cds;
      tab[j] = tab[j - 1] + (cds / 6) * (f(s0) + 4 * f(0.5 * (s0 + s1)) + f(s1));
    }
    coastTables[i] = tab;
    return tab;
  };
  /** Arrival time on table i: when its χ has grown by d since t0. */
  const coastOn = (i: number, t0: number, d: number) => {
    const tab = coastTable(i);
    const x0 = Math.min(CN, Math.cbrt(Math.max(0, t0)) / cds);
    const j0 = Math.min(CN - 1, Math.floor(x0));
    const target = tab[j0] + (x0 - j0) * (tab[j0 + 1] - tab[j0]) + d;
    if (target > tab[CN]) return Infinity;
    let lo = j0;
    let hi = CN;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tab[mid] < target) lo = mid;
      else hi = mid;
    }
    const s = (lo + (target - tab[lo]) / (tab[hi] - tab[lo])) * cds;
    return s * s * s;
  };
  const coast = (t0: number, d: number, v: number) => {
    if (d <= 0) return t0;
    if (v >= 0.9999) return tOfD(D(t0) + d);
    if (v <= 0) return Infinity;
    const U = (v / Math.sqrt(1 - v * v)) * a(t0);
    const x = (Math.log10(U) - U_LOG_MIN) * U_PER_DECADE;
    if (x >= U_N - 1) return tOfD(D(t0) + d);
    if (x <= 0) return coastOn(0, t0, d);
    // Interpolate the arrival time between the two neighbouring tables.
    const i = Math.floor(x);
    const fr = x - i;
    const tLo = coastOn(i, t0, d);
    const tHi = coastOn(i + 1, t0, d);
    if (tHi === Infinity) return Infinity;
    if (tLo === Infinity) return fr > 0.5 ? tHi : Infinity;
    return tLo + fr * (tHi - tLo);
  };

  return {
    age,
    a,
    D,
    tOfD,
    Dinf,
    arrival: (t0, d, v) => tOfD(D(t0) + d / v),
    coast,
    emission: (t1, d) => {
      const x = D(t1) - d;
      return x < 0 ? -1 : tOfD(x);
    },
    emissionWithScale,
    sfr,
    starsFormed,
  };
}
