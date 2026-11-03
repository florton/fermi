/**
 * The lo-fi map: a top-down glyph grid, one character per screen cell, in the
 * spirit of a roguelike overview. The cell size is fixed on screen, so zooming
 * in resolves finer structure rather than drawing bigger blocks.
 *
 *   ·   unsettled galaxy groups (brighter = more of them)
 *   ■   held territory: the tile fills out and brightens as its starlight is
 *       converted to waste heat, so young holdings are small and dim
 *   ✶   a species becoming technological (white: saw an empty sky)
 *   o   a species that stayed home
 *   x   a strike landing
 *
 * Drag to pan, wheel to zoom, click a cell to select the lineage that holds most of it.
 */

import { TIERS, tierAt } from '../core/tech.ts';
import type { SimResult } from '../core/sim.ts';
import { FADE, lightFront, lineageRgb, tierName, wrapDelta, type Frame } from './state.ts';

export interface Slice {
  /** Centre of the depth slab, 0..1 of the box. */
  center: number;
  /** Width of the slab, 0..1; 1 shows everything. */
  width: number;
}

export function inSlice(z: number, L: number, s: Slice): boolean {
  if (s.width >= 1) return true;
  let d = Math.abs(z / L - s.center);
  if (d > 0.5) d = 1 - d;
  return d <= s.width / 2;
}

export class MapView {
  readonly canvas: HTMLCanvasElement;
  onPick: (lineage: number) => void = () => {};
  onHover: (html: string | null, x: number, y: number) => void = () => {};
  dirty = true;

  private r: SimResult | null = null;
  private camX = 0;
  private camY = 0;
  private scale = 1;
  private cell = 10;
  private cols = 0;
  private rows = 0;
  private vote = new Int32Array(0);
  private count = new Int32Array(0);
  private settled = new Int32Array(0);
  private last: { frame: Frame; selected: number; slice: Slice } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          const dpr = devicePixelRatio || 1;
          this.camX -= (dx * dpr) / this.scale;
          this.camY -= (dy * dpr) / this.scale;
          drag.x = e.clientX;
          drag.y = e.clientY;
          this.dirty = true;
        }
        return;
      }
      this.onHover(this.describe(e.offsetX, e.offsetY), e.offsetX, e.offsetY);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.onPick(this.pick(e.offsetX, e.offsetY));
      drag = null;
    });
    canvas.addEventListener('pointerleave', () => this.onHover(null, 0, 0));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const dpr = devicePixelRatio || 1;
        const [wx, wy] = this.toWorld(e.offsetX * dpr, e.offsetY * dpr);
        const factor = Math.exp(-e.deltaY * 0.0015);
        this.scale = Math.min(this.fitScale() * 40, Math.max(this.fitScale() * 0.5, this.scale * factor));
        // Keep the point under the cursor fixed.
        const [wx2, wy2] = this.toWorld(e.offsetX * dpr, e.offsetY * dpr);
        this.camX += wx - wx2;
        this.camY += wy - wy2;
        this.dirty = true;
      },
      { passive: false },
    );
  }

  setResult(r: SimResult) {
    this.r = r;
    this.resize();
    this.reset();
  }

  reset() {
    if (!this.r) return;
    this.camX = this.camY = this.r.params.boxGly / 2;
    this.scale = this.fitScale();
    this.dirty = true;
  }

  /** Centre the view on a node. */
  focus(node: number) {
    if (!this.r) return;
    this.camX = this.r.positions.x[node];
    this.camY = this.r.positions.y[node];
    this.dirty = true;
  }

  resize() {
    // A hidden canvas measures 0; sizing it then would leave a 1-pixel buffer stretched when shown.
    if (this.canvas.clientWidth === 0) return;
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.cell = Math.round(11 * dpr);
    this.cols = Math.ceil(this.canvas.width / this.cell);
    this.rows = Math.ceil(this.canvas.height / this.cell);
    const nCells = this.cols * this.rows;
    this.vote = new Int32Array(nCells);
    this.count = new Int32Array(nCells);
    this.settled = new Int32Array(nCells);
    this.dirty = true;
  }

  private fitScale() {
    if (!this.r) return 1;
    return (0.94 * Math.min(this.canvas.width, this.canvas.height)) / this.r.params.boxGly;
  }

  private toScreen(x: number, y: number): [number, number] {
    return [(x - this.camX) * this.scale + this.canvas.width / 2, (y - this.camY) * this.scale + this.canvas.height / 2];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.canvas.width / 2) / this.scale + this.camX, (sy - this.canvas.height / 2) / this.scale + this.camY];
  }

  private cellAt(cssX: number, cssY: number): number {
    const dpr = devicePixelRatio || 1;
    const c = Math.floor((cssX * dpr) / this.cell);
    const r = Math.floor((cssY * dpr) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private pick(cssX: number, cssY: number): number {
    const c = this.cellAt(cssX, cssY);
    if (c < 0 || !this.r || !this.last) return -1;
    return this.settled[c] > 0 ? this.r.polities.lineage[this.vote[c]] : -1;
  }

  private describe(cssX: number, cssY: number): string | null {
    const c = this.cellAt(cssX, cssY);
    if (c < 0 || !this.r || !this.last || this.count[c] === 0) return null;
    const groups = `${this.count[c]} group${this.count[c] > 1 ? 's' : ''}, ${this.settled[c]} held`;
    if (this.settled[c] === 0) return groups;
    const lin = this.r.polities.lineage[this.vote[c]];
    return `<b>${this.r.civs[lin].name}</b><br>${groups}<br>${tierName(this.r, lin, this.last.frame.t)}`;
  }

  render(frame: Frame, selected: number, slice: Slice) {
    const r = this.r;
    if (!r) return;
    this.last = { frame, selected, slice };
    this.dirty = false;
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cell = this.cell;
    const cols = this.cols;
    const L = r.params.boxGly;
    const { x, y, z } = r.positions;
    const lineageOf = r.polities.lineage;

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);

    // Bin nodes into screen cells. Holder is a majority vote by polity, which is
    // exact when one lineage holds most of the cell and harmless when none does.
    this.count.fill(0);
    this.settled.fill(0);
    const voteCount = new Int32Array(this.count.length);
    const lumSum = new Float32Array(this.count.length);
    const hasSel = new Uint8Array(this.count.length);
    for (let i = 0; i < x.length; i++) {
      if (!inSlice(z[i], L, slice)) continue;
      const [sx, sy] = this.toScreen(x[i], y[i]);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const c = Math.floor(sy / cell) * cols + Math.floor(sx / cell);
      this.count[c]++;
      const o = frame.owner[i];
      if (o < 0) continue;
      this.settled[c]++;
      lumSum[c] += frame.lum[i];
      if (lineageOf[o] === selected) {
        hasSel[c] = 1;
        this.vote[c] = o;
        voteCount[c] = 1 << 20; // pin the selection as the cell's face
      } else if (voteCount[c] === 0) {
        this.vote[c] = o;
        voteCount[c] = 1;
      } else if (lineageOf[this.vote[c]] === lineageOf[o]) voteCount[c]++;
      else voteCount[c]--;
    }

    ctx.font = `${cell}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < this.count.length; c++) {
      const n = this.count[c];
      if (n === 0) continue;
      const cx = (c % cols) * cell + cell / 2;
      const cy = Math.floor(c / cols) * cell + cell / 2;
      if (this.settled[c] === 0) {
        ctx.fillStyle = `rgba(150,160,180,${Math.min(0.7, 0.18 + 0.08 * n)})`;
        ctx.fillText('·', cx, cy);
        continue;
      }
      const lin = lineageOf[this.vote[c]];
      const heat = Math.min(1, Math.sqrt(lumSum[c] / this.settled[c]));
      const [cr, cg, cb] = lineageRgb(lin);
      const dim = selected >= 0 && !hasSel[c] ? 0.18 : 1;
      // A tile that fills out and brightens as its starlight is converted to waste heat.
      const shade = Math.min(3, Math.floor(heat * 4));
      const inset = (cell * (3 - shade)) / 10;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${dim * (0.4 + 0.2 * shade)})`;
      ctx.fillRect(cx - cell / 2 + inset + 0.5, cy - cell / 2 + inset + 0.5, cell - 2 * inset - 1, cell - 2 * inset - 1);
    }

    // Box edge.
    const [bx0, by0] = this.toScreen(0, 0);
    ctx.strokeStyle = '#1d2230';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx0, by0, L * this.scale, L * this.scale);

    // Strikes in flight: a line from the launcher toward the head.
    const st = r.strikes;
    ctx.lineWidth = Math.max(1, cell / 8);
    for (const { s, f } of frame.inFlight) {
      if (!inSlice(z[st.from[s]], L, slice) && !inSlice(z[st.to[s]], L, slice)) continue;
      const a = st.from[s];
      const b = st.to[s];
      const [sx, sy] = this.toScreen(x[a], y[a]);
      const hx = x[a] + f * wrapDelta(x[a], x[b], L);
      const hy = y[a] + f * wrapDelta(y[a], y[b], L);
      const [ex, ey] = this.toScreen(hx, hy);
      const [cr, cg, cb] = lineageRgb(st.lineage[s]);
      const dim = selected >= 0 && st.lineage[s] !== selected ? 0.25 : 1;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.6 * dim})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${dim})`;
      ctx.fillText('•', ex, ey);
    }
    for (const { s, age } of frame.impacts) {
      const b = st.to[s];
      if (!inSlice(z[b], L, slice)) continue;
      const [sx, sy] = this.toScreen(x[b], y[b]);
      ctx.fillStyle = `rgba(255,80,60,${1 - age})`;
      ctx.fillText('x', sx, sy);
    }

    // Species: becoming technological, and those that stayed home.
    for (const c of r.civs) {
      if (!inSlice(z[c.node], L, slice)) continue;
      const age = frame.t - c.tTech;
      const [sx, sy] = this.toScreen(x[c.node], y[c.node]);
      if (age >= 0 && age < FADE && c.fate !== 'preempted') {
        const silent = c.saw && c.saw.lineages === 0 && !c.saw.far;
        ctx.fillStyle = silent ? `rgba(255,255,255,${1 - age / FADE})` : `rgba(255,170,90,${1 - age / FADE})`;
        ctx.font = `bold ${Math.round(cell * 1.4)}px ui-monospace, Consolas, monospace`;
        ctx.fillText('✶', sx, sy);
        ctx.font = `${cell}px ui-monospace, Consolas, monospace`;
      } else if ((c.fate === 'quiet' || c.fate === 'engulfed') && c.tFate <= frame.t) {
        ctx.fillStyle = 'rgba(230,235,245,0.8)';
        ctx.fillText('o', sx, sy);
      }
    }

    if (selected >= 0) this.drawSelection(ctx, r, frame, selected);
  }

  private drawSelection(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, lin: number) {
    const c = r.civs[lin];
    const [ox, oy] = this.toScreen(r.positions.x[c.node], r.positions.y[c.node]);
    const dpr = devicePixelRatio || 1;
    ctx.save();
    ctx.lineWidth = dpr;
    ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    // How far the news of this species' birth has travelled.
    const front = lightFront(c.tTech, frame.t) * this.scale;
    if (front > 0) {
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(ox, oy, front, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('light of their first radio', ox + front * 0.71 + 4, oy - front * 0.71);
      ctx.setLineDash([]);
    }
    // How far they can see a fully built-out neighbour.
    const k = tierAt(c.tierTimes, frame.t);
    if (k >= 0 && frame.held[lin] > 0) {
      const range = r.params.detectRange * TIERS[k].sensor * this.scale;
      const [cr, cg, cb] = lineageRgb(lin);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.5)`;
      ctx.beginPath();
      ctx.arc(ox, oy, range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.8)`;
      ctx.fillText('sensor range', ox + range * 0.71 + 4, oy + range * 0.71);
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(16 * dpr)}px ui-monospace, Consolas, monospace`;
    ctx.fillText('◎', ox, oy);
    ctx.restore();
  }
}
