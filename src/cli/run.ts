/**
 * One run, printed as a summary plus the chronicle.
 *
 *   npm run run -- --seed 3 --nodes 50000 --preemption 0.5
 *   npm run run -- --json        (summary only, as JSON)
 *   npm run run -- --scenario berserkers --hardStepLog10 -5.6
 *   npm run run -- --archetypes peaceful,communal,hunter --conditions sterilization,ftl
 *
 * Any scalar field of SimParams can be overridden as --name value. --scenario
 * applies a named bundle from core/scenarios.ts first, so explicit flags win.
 */

import { withDefaults, withHardStepRate, type SimParams } from '../core/params.ts';
import { scenario, universeParams } from '../core/scenarios.ts';
import { runSim } from '../core/sim.ts';
import { summarize } from '../core/summary.ts';

export function parseOverrides(argv: string[]): { over: Partial<SimParams>; flags: Set<string> } {
  const over: Record<string, number> = {};
  const flags = new Set<string>();
  let base: Partial<SimParams> = {};
  let lists: Partial<SimParams> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(key);
      continue;
    }
    if (key === 'scenario') base = scenario(next);
    else if (key === 'archetypes') lists = { ...lists, archetypes: next.split(',') };
    else if (key === 'conditions') lists = { ...universeParams(next.split(','), lists.archetypes ?? []), ...lists };
    else over[key] = Number(next);
    i++;
  }
  // The shorthand isn't a SimParams field; expand it into the hard-step rates.
  const { hardStepLog10, ...rest } = over;
  const merged = { ...base, ...lists, ...rest } as Partial<SimParams>;
  const params = hardStepLog10 === undefined ? merged : withHardStepRate(merged, hardStepLog10);
  return { over: params, flags };
}

if (import.meta.main) {
  const { over, flags } = parseOverrides(process.argv.slice(2));
  const result = runSim(withDefaults(over));
  const summary = summarize(result);
  if (flags.has('json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const e of result.chronicle) console.log(`${e.t.toFixed(2).padStart(6)} Gyr  ${e.text}`);
    console.log('');
    console.log(summary);
  }
}
