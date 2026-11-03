/**
 * A parameter sweep: the experiment. Every combination of the --vary lists, each
 * run with several seeds, one CSV row per run.
 *
 *   npm run sweep -- --vary speedMax=0.1,0.5,0.9 --vary filterSurvival=0.1,0.5 --seeds 5
 *   npm run sweep -- --vary hardStepLog10=-4.4,-4.8,-5.2 --seeds 8 --nodes 20000
 *
 * `hardStepLog10` is a shorthand that sets the rate of every hard step whose
 * default rate is below 1 per Gyr. Other fixed overrides pass through as in run.ts.
 * Output goes to out/sweep-<timestamp>.csv.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { withDefaults, withHardStepRate, type SimParams } from '../core/params.ts';
import { runSim } from '../core/sim.ts';
import { summarize, type Summary } from '../core/summary.ts';
import { parseOverrides } from './run.ts';

const argv = process.argv.slice(2);
const vary: [string, number[]][] = [];
const rest: string[] = [];
let seeds = 3;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--vary') {
    const [key, list] = argv[++i].split('=');
    vary.push([key, list.split(',').map(Number)]);
  } else if (argv[i] === '--seeds') {
    seeds = Number(argv[++i]);
  } else rest.push(argv[i]);
}
const { over: fixed } = parseOverrides(rest);

function apply(base: Partial<SimParams>, key: string, value: number): Partial<SimParams> {
  if (key === 'hardStepLog10') return withHardStepRate(base, value);
  return { ...base, [key]: value };
}

let combos: { label: Record<string, number>; over: Partial<SimParams> }[] = [{ label: {}, over: fixed }];
for (const [key, values] of vary) {
  combos = combos.flatMap((c) => values.map((v) => ({ label: { ...c.label, [key]: v }, over: apply(c.over, key, v) })));
}

const flat = (s: Summary): Record<string, number | string | boolean> => {
  const { fates, finalTraits, tally, ...scalars } = s;
  const out: Record<string, number | string | boolean> = { ...scalars };
  for (const [k, v] of Object.entries(tally)) out[`n_${k}`] = v;
  for (const [k, v] of Object.entries(fates)) out[`fate_${k}`] = v;
  for (const [k, v] of Object.entries(finalTraits)) out[`trait_${k}`] = v;
  return out;
};

const rows: Record<string, number | string | boolean>[] = [];
const total = combos.length * seeds;
let done = 0;
for (const combo of combos) {
  for (let s = 1; s <= seeds; s++) {
    const summary = summarize(runSim(withDefaults({ ...combo.over, seed: s })));
    rows.push({ ...combo.label, ...flat(summary) });
    done++;
    const label = Object.entries(combo.label).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(
      `[${done}/${total}] ${label} seed=${s}  origins=${summary.origins} silent=${summary.silentFrac} ` +
        `presentSilent=${summary.presentSilentFrac} settledNow=${summary.settledAtPresent} (${summary.runtimeMs} ms)`,
    );
  }
}

const cols = Object.keys(rows[0]);
const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c])).join(','))].join('\n');
mkdirSync('out', { recursive: true });
const path = `out/sweep-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
writeFileSync(path, csv);
console.log(`wrote ${path}`);
