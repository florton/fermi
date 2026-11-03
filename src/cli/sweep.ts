/**
 * A parameter sweep: the experiment. Every combination of the --vary lists, each
 * run with several seeds, one CSV row per run, spread across CPU cores.
 *
 *   npm run sweep -- --vary speedMax=0.1,0.5,0.9 --vary filterSurvival=0.1,0.5 --seeds 5
 *   npm run sweep -- --vary hardStepLog10=-4.4,-4.8,-5.2 --seeds 8 --nodes 20000 --jobs 6
 *
 *   npm run sweep -- --vary scenario=baseline,berserkers,sterilization --vary hardStepLog10=-5.4,-5.8
 *
 * `hardStepLog10` is a shorthand that sets the rate of every hard step whose
 * default rate is below 1 per Gyr. `scenario` takes names from core/scenarios.ts;
 * explicit flags still win over a scenario's settings. Other fixed overrides pass
 * through as in run.ts.
 * --jobs defaults to one fewer than the number of cores.
 * Output goes to out/sweep-<timestamp>.csv.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { withHardStepRate, type SimParams } from '../core/params.ts';
import { scenario } from '../core/scenarios.ts';
import type { Summary } from '../core/summary.ts';
import { parseOverrides } from './run.ts';

type Value = number | string;
const argv = process.argv.slice(2);
const vary: [string, Value[]][] = [];
const rest: string[] = [];
let seeds = 3;
let jobs = Math.max(1, availableParallelism() - 1);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--vary') {
    const [key, list] = argv[++i].split('=');
    const values = list.split(',');
    vary.push([key, key === 'scenario' ? values : values.map(Number)]);
  } else if (argv[i] === '--seeds') {
    seeds = Number(argv[++i]);
  } else if (argv[i] === '--jobs') {
    jobs = Number(argv[++i]);
  } else rest.push(argv[i]);
}
const { over: fixed } = parseOverrides(rest);

function apply(base: Partial<SimParams>, key: string, value: Value): Partial<SimParams> {
  if (key === 'scenario') return { ...scenario(String(value)), ...base };
  if (key === 'hardStepLog10') return withHardStepRate(base, Number(value));
  return { ...base, [key]: value };
}

let combos: { label: Record<string, Value>; over: Partial<SimParams> }[] = [{ label: {}, over: fixed }];
for (const [key, values] of vary) {
  combos = combos.flatMap((c) => values.map((v) => ({ label: { ...c.label, [key]: v }, over: apply(c.over, key, v) })));
}
const tasks = combos.flatMap((combo) =>
  Array.from({ length: seeds }, (_, s) => ({ label: combo.label, over: { ...combo.over, seed: s + 1 } })),
);

const flat = (s: Summary): Record<string, number | string | boolean> => {
  const { fates, finalTraits, tally, ...scalars } = s;
  const out: Record<string, number | string | boolean> = { ...scalars };
  for (const [k, v] of Object.entries(tally)) out[`n_${k}`] = v;
  for (const [k, v] of Object.entries(fates)) out[`fate_${k}`] = v;
  for (const [k, v] of Object.entries(finalTraits)) out[`trait_${k}`] = v;
  return out;
};

const rows: Record<string, number | string | boolean>[] = new Array(tasks.length);
let next = 0;
let done = 0;
const started = Date.now();
const workers = Array.from({ length: Math.min(jobs, tasks.length) }, () => new Worker(new URL('./sweep-worker.ts', import.meta.url)));
console.log(`${tasks.length} runs on ${workers.length} workers`);

await new Promise<void>((resolve) => {
  const feed = (w: Worker) => {
    if (next >= tasks.length) {
      w.terminate();
      return;
    }
    const id = next++;
    w.postMessage({ id, over: tasks[id].over });
  };
  for (const w of workers) {
    w.on('message', ({ id, summary }: { id: number; summary: Summary }) => {
      const task = tasks[id];
      rows[id] = { ...task.label, ...flat(summary) };
      done++;
      const label = Object.entries(task.label).map(([k, v]) => `${k}=${v}`).join(' ');
      console.log(
        `[${done}/${tasks.length}] ${label} seed=${summary.seed}  origins=${summary.origins} silent=${summary.silentFrac} ` +
          `presentSilent=${summary.presentSilentFrac} settledNow=${summary.settledAtPresent} (${summary.runtimeMs} ms)`,
      );
      if (done === tasks.length) resolve();
      feed(w);
    });
    feed(w);
  }
});

const cols = Object.keys(rows[0]);
const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c])).join(','))].join('\n');
mkdirSync('out', { recursive: true });
const path = `out/sweep-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
writeFileSync(path, csv);
console.log(`wrote ${path} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
