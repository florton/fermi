/**
 * Runs the simulation off the main thread, a slice at a time, posting the
 * history made so far after each slice so the page can play it while the rest
 * is still being simulated.
 */

import { withDefaults, type SimParams } from '../core/params.ts';
import { startSim, type SimResult } from '../core/sim.ts';
import { summarize, type Summary } from '../core/summary.ts';
import { buffersOf, packDynamic, packStatic, type CivDynamic, type CivStatic } from './civpack.ts';

/** A result without its civs and positions, which travel separately. */
export type Snap = Omit<SimResult, 'civs' | 'positions'>;

export type WorkerMessage =
  | {
      kind: 'snapshot';
      /** Which request this answers; replies to an older one are stale. */
      run: number;
      /** Simulated time reached; the history up to here is final. */
      simT: number;
      done: boolean;
      snap: Snap;
      civs: CivDynamic;
      /** First snapshot only. */
      civStatic?: CivStatic;
      positions?: SimResult['positions'];
    }
  | { kind: 'summary'; run: number; summary: Summary };

const post = (msg: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

/** Bumped by each new request, so a run that's been replaced stops at its next slice. */
let current = 0;

self.onmessage = (e: MessageEvent<Partial<SimParams>>) => {
  const id = ++current;
  const run = startSim(withDefaults(e.data));
  let first = true;
  // The first picture comes quickly; after that, slices long enough that
  // packing and sending stays a small share of the time.
  let slice = 80;
  const loop = () => {
    if (id !== current) return;
    const done = run.advance(performance.now() + slice);
    const sent = performance.now();
    const { civs, positions, ...snap } = run.result();
    const dyn = packDynamic(civs);
    const transfer: ArrayBuffer[] = [...buffersOf(snap.polities), ...buffersOf(snap.strikes), ...buffersOf(dyn)];
    const msg: WorkerMessage = { kind: 'snapshot', run: id, simT: run.time, done, snap, civs: dyn };
    if (first) {
      msg.civStatic = packStatic(civs);
      // Copies: the simulation keeps using its own.
      msg.positions = { x: positions.x.slice(), y: positions.y.slice(), z: positions.z.slice(), mass: positions.mass.slice() };
      transfer.push(...buffersOf(msg.civStatic), ...buffersOf(msg.positions));
      first = false;
    }
    post(msg, transfer);
    slice = Math.max(250, 8 * (performance.now() - sent));
    if (!done) {
      setTimeout(loop, 0);
      return;
    }
    // The arrays just sent are gone from this side; take a fresh copy to summarize.
    post({ kind: 'summary', run: id, summary: summarize(run.result()) });
  };
  loop();
};
