/** One sweep worker: receives parameter sets, runs them, sends back summaries. */

import { parentPort } from 'node:worker_threads';
import { withDefaults, type SimParams } from '../core/params.ts';
import { runSim } from '../core/sim.ts';
import { summarize } from '../core/summary.ts';

parentPort!.on('message', (msg: { id: number; over: Partial<SimParams> }) => {
  parentPort!.postMessage({ id: msg.id, summary: summarize(runSim(withDefaults(msg.over))) });
});
