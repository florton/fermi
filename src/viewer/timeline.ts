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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let down = false;
    const scrub = (e: PointerEvent) => {
      if (!this.r) return;
      const f = Math.min(1, Math.max(0, e.offsetX / canvas.clientWidth));
      this.onScrub(f * this.r.params.tEnd);
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
    this.r = r;
    const bins = 400;
    this.strikeBins = new Float32Array(bins);
    const st = r.strikes;
    for (let s = 0; s < st.launched.length; s++) {
      const b = Math.min(bins - 1, Math.floor((st.arrived[s] / r.params.tEnd) * bins));
      this.strikeBins[b]++;
    }
    this.strikeMax = Math.max(1, ...this.strikeBins);
    this.resize();
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
    const X = (tt: number) => (tt / tEnd) * w;
    const mid = h * 0.62;

    // Settled share of the box.
    ctx.fillStyle = 'rgba(200,210,230,0.14)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (const s of r.series) ctx.lineTo(X(s.t), mid - s.settled * mid * 0.85);
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
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(t), 0);
    ctx.lineTo(X(t), h);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}
