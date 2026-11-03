/** Runs the simulation off the main thread so the page stays responsive, reporting progress as it goes. */

import { withDefaults, type SimParams } from '../core/params.ts';
import { runSim } from '../core/sim.ts';
import { summarize } from '../core/summary.ts';

self.onmessage = (e: MessageEvent<Partial<SimParams>>) => {
  const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  let lastSent = 0;
  const result = runSim(withDefaults(e.data), (fraction) => {
    // A few dozen updates are plenty for a progress bar.
    if (fraction - lastSent < 0.01) return;
    lastSent = fraction;
    post({ progress: fraction });
  });
  post({ progress: 1, summarizing: true });
  const summary = summarize(result);
  const { polities: pol, positions: pos, strikes: st } = result;
  post({ result, summary }, [
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
    st.from.buffer,
    st.to.buffer,
    st.lineage.buffer,
    st.victim.buffer,
    st.launched.buffer,
    st.arrived.buffer,
    st.hit.buffer,
  ]);
};
