/**
 * The run at a glance, under the map: how much of the box is settled over time
 * (grey area), species becoming technological (ticks above: white saw an empty
 * sky, orange saw someone), strike density (red below), and today. Click or drag
 * to scrub.
 */

import type { SimResult } from '../core/sim.ts';

export class Timeline {
  readonly canvas: HTMLCanvasElement;
  onScrub: (t: number) => void = () => {};
  private r: SimResult | null = null;
  private strikeBins = new Float32Array(0);
  private strikeMax = 1;
  /**
   * Where the strip starts. The first few Gyr usually hold nothing but star
   * formation, so the view begins shortly before the first species appears.
   */
  t0 = 0;
  /** How far the simulation has got while it is still running; Infinity once done. */
  simT = Infinity;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let down = false;
    const scrub = (e: PointerEvent) => {
      if (!this.r) return;
      const f = Math.min(1, Math.max(0, e.offsetX / canvas.clientWidth));
      this.onScrub(this.t0 + f * (this.r.params.tEnd - this.t0));
    };
    canvas.addEventListener('pointerdown', (e) => {
      down = true;
      canvas.setPointerCapture(e.pointerId);
      scrub(e);
    });
    canvas.addEventListener('pointermove', (e) => down && scrub(e));
    canvas.addEventListener('pointerup', () => (down = false));
  }

  setResult(r: SimResult) {
    const first = r.civs.reduce((m, c) => Math.min(m, c.tTech), Infinity);
    this.t0 = Number.isFinite(first) ? Math.max(0, Math.floor(first - 0.5)) : 0;
    this.update(r);
    this.resize();
  }

  /** More of the same run: rebin, keep the start. */
  update(r: SimResult) {
    this.r = r;
    const bins = 400;
    const span = r.params.tEnd - this.t0;
    this.strikeBins = new Float32Array(bins);
    const st = r.strikes;
    for (let s = 0; s < st.launched.length; s++) {
      const b = Math.min(bins - 1, Math.max(0, Math.floor(((st.arrived[s] - this.t0) / span) * bins)));
      this.strikeBins[b]++;
    }
    this.strikeMax = Math.max(1, ...this.strikeBins);
  }

  resize() {
    if (this.canvas.clientWidth === 0) return;
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.floor(this.canvas.clientHeight * dpr);
  }

  draw(t: number) {
    const r = this.r;
    const ctx = this.canvas.getContext('2d')!;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!r) return;
    const dpr = devicePixelRatio || 1;
    const tEnd = r.params.tEnd;
    const t0 = this.t0;
    const X = (tt: number) => ((tt - t0) / (tEnd - t0)) * w;
    const mid = h * 0.62;

    // Settled share of the box.
    ctx.fillStyle = 'rgba(200,210,230,0.14)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (const s of r.series) if (s.t >= t0) ctx.lineTo(X(s.t), mid - s.settled * mid * 0.85);
    ctx.lineTo(w, mid);
    ctx.fill();

    // Strikes below the line.
    ctx.fillStyle = 'rgba(255,90,70,0.7)';
    const bw = w / this.strikeBins.length;
    this.strikeBins.forEach((n, i) => {
      if (n) ctx.fillRect(i * bw, mid + 1, Math.max(1, bw - 0.5), ((h - mid - 2) * Math.sqrt(n)) / Math.sqrt(this.strikeMax));
    });

    // First light, as ticks along the top.
    for (const c of r.civs) {
      if (c.fate === 'preempted' || !c.saw) continue;
      const silent = c.saw.lineages === 0 && !c.saw.far;
      ctx.fillStyle = silent ? 'rgba(255,255,255,0.55)' : 'rgba(255,170,90,0.7)';
      ctx.fillRect(X(c.tTech), 0, Math.max(1, dpr), 5 * dpr);
    }

    // Not simulated yet: dimmed, with the edge marked.
    if (this.simT < tEnd) {
      const ex = Math.max(0, X(this.simT));
      ctx.fillStyle = 'rgba(5,6,10,0.6)';
      ctx.fillRect(ex, 0, w - ex, h);
      // The edge breathes, so it reads as work in progress.
      const pulse = 0.55 + 0.35 * Math.sin(performance.now() / 250);
      ctx.fillStyle = `rgba(138,180,255,${pulse})`;
      ctx.fillRect(ex - dpr, 0, 2 * dpr, h);
      ctx.font = `${Math.round(10 * dpr)}px system-ui, sans-serif`;
      const label = `simulating ${this.simT.toFixed(1)} Gyr…`;
      const lw = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(ex + 4 * dpr, w - lw - 2 * dpr), 12 * dpr);
    }

    // Today, and the cursor.
    ctx.strokeStyle = 'rgba(138,180,255,0.7)';
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(X(r.cosmology.age), 0);
    ctx.lineTo(X(r.cosmology.age), h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(138,180,255,0.9)';
    ctx.font = `${Math.round(10 * dpr)}px system-ui, sans-serif`;
    ctx.fillText('today', X(r.cosmology.age) + 3 * dpr, h - 3 * dpr);
    // The strip's ends, so a trimmed start doesn't read as the Big Bang.
    ctx.fillStyle = 'rgba(200,210,230,0.6)';
    ctx.fillText(`${t0} Gyr`, 2 * dpr, h - 3 * dpr);
    const endLabel = `${tEnd} Gyr`;
    ctx.fillText(endLabel, w - ctx.measureText(endLabel).width - 2 * dpr, h - 3 * dpr);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(t), 0);
    ctx.lineTo(X(t), h);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}
