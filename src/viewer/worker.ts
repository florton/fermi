/** Runs the simulation off the main thread so the page stays responsive. */

import { withDefaults, type SimParams } from '../core/params.ts';
import { runSim } from '../core/sim.ts';
import { summarize } from '../core/summary.ts';

self.onmessage = (e: MessageEvent<Partial<SimParams>>) => {
  const result = runSim(withDefaults(e.data));
  const summary = summarize(result);
  const { polities: pol, positions: pos } = result;
  (self as unknown as Worker).postMessage({ result, summary }, [
    pol.node.buffer,
    pol.lineage.buffer,
    pol.parent.buffer,
    pol.born.buffer,
    pol.died.buffer,
    pol.genome.buffer,
    pos.x.buffer,
    pos.y.buffer,
    pos.z.buffer,
    pos.mass.buffer,
  ]);
};
