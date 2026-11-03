/**
 * One run, printed as a summary plus the chronicle.
 *
 *   npm run run -- --seed 3 --nodes 50000 --preemption 0.5
 *   npm run run -- --json        (summary only, as JSON)
 *
 * Any scalar field of SimParams can be overridden as --name value.
 */

import { withDefaults, withHardStepRate, type SimParams } from '../core/params.ts';
import { runSim } from '../core/sim.ts';
import { summarize } from '../core/summary.ts';

export function parseOverrides(argv: string[]): { over: Partial<SimParams>; flags: Set<string> } {
  const over: Record<string, number> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(key);
      continue;
    }
    over[key] = Number(next);
    i++;
  }
  // The shorthand isn't a SimParams field; expand it into the hard-step rates.
  const { hardStepLog10, ...rest } = over;
  const params = hardStepLog10 === undefined ? rest : withHardStepRate(rest, hardStepLog10);
  return { over: params as Partial<SimParams>, flags };
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
