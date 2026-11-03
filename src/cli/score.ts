/**
 * Score a sweep against what we actually observe: we arose about 13.8 Gyr after
 * the Big Bang, around a G star, nobody has arrived here, and the sky shows no
 * one. Each parameter setting in the sweep gets a likelihood — how probable an
 * observer exactly like us is under it — and a posterior share, assuming every
 * setting in the grid was equally plausible beforehand.
 *
 *   npm run score -- out/sweep-<timestamp>.csv
 *
 * Two answers are given, because anthropic reasoning hasn't settled which is right:
 *
 *   SSA  (self-sampling) — we are a random observer, so a setting scores by the
 *        *fraction* of its observers who look like us.
 *   SIA  (self-indication) — we are a random possible observer, so a setting also
 *        scores higher for producing *more* observers like us in total.
 *
 * SSA asks "is our situation typical?"; SIA additionally rewards crowded
 * universes. They can disagree sharply, and where they do is itself informative.
 */

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run score -- <sweep.csv>');
  process.exit(1);
}
const [head, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
const cols = head.split(',');
if (!cols.includes('gShareNow')) {
  console.error(`${file} predates the likelihood fields (gShareNow, presentSilent, usLikeObservable). Re-run the sweep.`);
  process.exit(1);
}
const axes = cols.slice(0, cols.indexOf('seed'));
type Row = Record<string, string>;
const rows: Row[] = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));

interface Cell {
  key: string;
  values: Record<string, string>;
  runs: number;
  observers: number;
  present: number;
  presentSilent: number;
  gShare: number;
  ssa: number;
  sia: number;
}

const groups = new Map<string, Row[]>();
for (const r of rows) {
  const key = axes.map((a) => `${a}=${r[a]}`).join(' ');
  groups.set(key, [...(groups.get(key) ?? []), r]);
}

const cells: Cell[] = [...groups].map(([key, g]) => {
  const sum = (c: string) => g.reduce((a, r) => a + (Number(r[c]) || 0), 0);
  const observers = sum('observers');
  const presentSilent = sum('presentSilent');
  const gShare = sum('gShareNow') / g.length;
  return {
    key,
    values: Object.fromEntries(axes.map((a) => [a, g[0][a]])),
    runs: g.length,
    observers,
    present: sum('presentObservers'),
    presentSilent,
    gShare,
    // Jeffreys-smoothed so a setting with no matches in a small sample isn't scored as impossible.
    ssa: ((presentSilent + 0.5) / (observers + 1)) * gShare,
    sia: sum('usLikeObservable') / g.length,
  };
});

const norm = (k: 'ssa' | 'sia') => cells.reduce((a, c) => a + c[k], 0);
const ssaTotal = norm('ssa');
const siaTotal = norm('sia');
const bar = (x: number) => '█'.repeat(Math.round(x * 30)).padEnd(30, '·');
const pct = (x: number) => `${(100 * x).toFixed(1)}%`.padStart(6);

console.log(`${cells.length} settings, ${rows.length} runs. Posterior assumes a flat prior over the grid.\n`);
const width = Math.max(...cells.map((c) => c.key.length));
console.log(`${'setting'.padEnd(width)}  observers  like-us  ${'SSA posterior'.padEnd(38)}  SIA posterior`);
for (const c of cells) {
  const s = c.ssa / ssaTotal;
  const i = c.sia / siaTotal;
  console.log(
    `${c.key.padEnd(width)}  ${String(c.observers).padStart(9)}  ${String(c.presentSilent).padStart(7)}  ${pct(s)} ${bar(s)}  ${pct(i)} ${bar(i)}`,
  );
}
console.log('\n"like-us" counts silent observers within 1 Gyr of today; the G-star factor is applied analytically.');

// With more than one axis, sum the posterior over the others: how well does each
// value of one axis do, whatever the rest turn out to be?
if (axes.length > 1) {
  for (const axis of axes) {
    console.log(`\nMarginal over ${axis}:`);
    const values = [...new Set(cells.map((c) => c.values[axis]))];
    const w = Math.max(...values.map((v) => v.length));
    for (const v of values) {
      const inCell = cells.filter((c) => c.values[axis] === v);
      const s = inCell.reduce((a, c) => a + c.ssa, 0) / ssaTotal;
      const i = inCell.reduce((a, c) => a + c.sia, 0) / siaTotal;
      console.log(`  ${v.padEnd(w)}  SSA ${pct(s)} ${bar(s)}  SIA ${pct(i)} ${bar(i)}`);
    }
  }
}
