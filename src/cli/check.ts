/**
 * Sanity checks against numbers the simulation did not get to choose: the
 * standard cosmology's textbook distances, and the hard-step math's known
 * closed form. If these drift, nothing downstream means anything.
 */

import { buildStepTable, habitableWindow, mainSequenceLife, makeLife } from '../core/biology.ts';
import { makeCosmology } from '../core/cosmology.ts';
import { withDefaults } from '../core/params.ts';
import { canSee, humanSensor } from '../core/tech.ts';

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

// Coasting probes. A near-light probe arrives with the light; a fast probe on a
// short hop barely slows; a slow one obeys χ = U∫dt/a² (integrated directly here).
expect('coasting at 0.99999c arrives with light, Gyr', c.coast(5, 1, 0.99999), c.tOfD(c.D(5) + 1), 0.01);
expect('coasting 0.5c over 10 Mly ≈ constant speed, Gyr', c.coast(13.8, 0.01, 0.5), c.arrival(13.8, 0.01, 0.5), 2e-3);
{
  const v = 0.01;
  const t0 = 3;
  const U = (v / Math.sqrt(1 - v * v)) * c.a(t0);
  let chi = 0;
  let tt = t0;
  const step = 1e-3;
  while (chi < 0.02) {
    const am = c.a(tt + step / 2);
    chi += (U / (am * Math.sqrt(am * am + U * U))) * step;
    tt += step;
  }
  expect('slow coasting probe matches direct integration, Gyr', c.coast(t0, 0.02, v), tt, 0.05);
}
expect('coasting is slower than constant speed over 1 Gly at 0.2c from 3 Gyr', c.coast(3, 1, 0.2) > c.arrival(3, 1, 0.2) ? 1 : 0, 1, 0);

// Stars and metals.
const d = withDefaults();
const G = d.starClasses.find((s) => s.name === 'G')!;
expect("the Sun's main-sequence lifetime, Gyr", mainSequenceLife(G), 10, 0.01);
expect('habitable window around a G star, Gyr', habitableWindow(d, G), 6, 0.5);
const lifeTables = makeLife(withDefaults({ sterilizeRate: 0.03 }), c);
expect('metal factor today', lifeTables.metalFactor(c.age), 1, 1e-3);
expect('radiation hazard factor today', lifeTables.hazardFactor(c.age), 1, 1e-3);
expect('radiation at cosmic noon (3.5 Gyr) at least 30× today', lifeTables.hazardFactor(3.5) >= 30 ? 1 : 0, 1, 0);
expect('few rocky planets in the first Gyr (metal factor < 0.1)', lifeTables.metalFactor(1) < 0.1 ? 1 : 0, 1, 0);

// Sight: a fully converted galaxy is seen today exactly out to detectRange.
const human = humanSensor(d);
expect('a fully lit galaxy at the detection range is seen', canSee(1, d.detectRange * 0.999, 1, 1, d.detectRange, human) ? 1 : 0, 1, 0);
expect('…and just past it is not', canSee(1, d.detectRange * 1.001, 1, 1, d.detectRange, human) ? 1 : 0, 0, 0);
expect('heat below the dust contrast is never seen, however close', canSee(human.contrast * 0.9, 1e-3, 1, 1, d.detectRange, human) ? 1 : 0, 0, 0);

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
