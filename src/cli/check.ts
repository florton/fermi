/**
 * Sanity checks against numbers the simulation did not get to choose: the
 * standard cosmology's textbook distances, and the hard-step math's known
 * closed form. If these drift, nothing downstream means anything.
 */

import { buildStepTable } from '../core/biology.ts';
import { makeCosmology } from '../core/cosmology.ts';
import { withDefaults } from '../core/params.ts';

let failed = 0;
function expect(name: string, got: number, want: number, tol: number) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got.toFixed(4)} (want ${want} ± ${tol})`);
}

const c = makeCosmology();
expect('age of the universe, Gyr', c.age, 13.8, 0.1);
expect('scale factor today', c.a(c.age), 1, 1e-3);
// The textbook 46.3 includes radiation, which slows the first ~100 kyr. This model
// leaves radiation out, which nothing here cares about, and lands about 0.8 Gly further.
expect('particle horizon today (no radiation), Gly', c.D(c.age), 47.1, 0.3);
expect('event horizon today, Gly', c.Dinf - c.D(c.age), 16.6, 0.5);
expect('D then tOfD round trip at 5 Gyr', c.tOfD(c.D(5)), 5, 1e-3);
expect('D then tOfD round trip at 300 Gyr', c.tOfD(c.D(300)), 300, 0.5);
expect('light from 13.8 Gly-travel-time ago left at ~t=0', c.emission(c.age, c.D(c.age)), 0, 0.01);
expect('a probe at c from now reaches the event horizon only at t=∞', c.arrival(c.age, c.Dinf - c.D(c.age) - 1e-6, 1) > 100 ? 1 : 0, 1, 0);
expect('present star formation, Msun/yr/Mpc³', c.sfr(c.age) / 1e9, 0.015, 0.003);
expect('stars formed by today, 1e8 Msun/Mpc³', c.starsFormed(c.age) / 1e8, 6.5, 2);

// Two equal-rate steps: Erlang-2 CDF is 1 − e^{−λt}(1 + λt).
const p = withDefaults({ minDelay: 0, hardSteps: [{ name: 'a', log10Rate: -1 }, { name: 'b', log10Rate: -1 }] });
const tbl = buildStepTable(p, 20, 0.01);
const lam = 0.1;
const t = 10;
expect('two-step completion CDF at 10 Gyr', tbl.cdf(t), 1 - Math.exp(-lam * t) * (1 + lam * t), 0.01);

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
