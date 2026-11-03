/**
 * The map: a top-down tile view of a depth slice through the box, one tile per
 * screen cell. Cell size is fixed on screen, so zooming in resolves finer
 * structure rather than drawing bigger blocks.
 *
 *   ·   unsettled galaxy groups (brighter = more of them)
 *   ■   held territory: the tile fills out and brightens as its starlight is
 *       converted to waste heat, so young holdings are small and dim
 *   ✶   a species becoming technological (white: saw an empty sky)
 *   o   a species that stayed home
 *   x   a strike or berserker kill landing
 *
 * Drag to pan, wheel to zoom, click to select: a species marker if there is one
 * under the cursor, otherwise the lineage holding most of that cell.
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

export interface Layers {
  territory: boolean;
  empty: boolean;
  strikes: boolean;
  species: boolean;
  labels: boolean;
  /** For the selection: light front, sensor range, and what it saw at first light. */
  reach: boolean;
}

export function inSlice(z: number, L: number, s: Slice): boolean {
  if (s.width >= 1) return true;
  let d = Math.abs(z / L - s.center);
  if (d > 0.5) d = 1 - d;
  return d <= s.width / 2;
}

const MONO = 'ui-monospace, Consolas, monospace';

export class MapView {
  readonly canvas: HTMLCanvasElement;
  onPick: (civ: number) => void = () => {};
  onHover: (html: string | null, x: number, y: number) => void = () => {};
  dirty = true;
  /** Nodes the selected species saw at first light, set by the caller. */
  sight: { node: number; lineage: number }[] = [];

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
  /** Species marker drawn in each cell this frame, or -1. */
  private civCell = new Int32Array(0);
  private last: Frame | null = null;
  /** Tile size on screen, CSS pixels. */
  private tilePx = 11;
  /** Screen space covered by floating panels and bars, CSS pixels: left, top, right, bottom. */
  private insets = [0, 0, 0, 0];

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
          this.onHover(null, 0, 0);
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
        this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
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

  /** Zoom by a factor about a point given in CSS pixels. */
  zoomAt(cssX: number, cssY: number, factor: number) {
    const dpr = devicePixelRatio || 1;
    const [wx, wy] = this.toWorld(cssX * dpr, cssY * dpr);
    this.scale = Math.min(this.fitScale() * 60, Math.max(this.fitScale() * 0.5, this.scale * factor));
    const [wx2, wy2] = this.toWorld(cssX * dpr, cssY * dpr);
    this.camX += wx - wx2;
    this.camY += wy - wy2;
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
    this.cell = Math.round(this.tilePx * dpr);
    this.cols = Math.ceil(this.canvas.width / this.cell);
    this.rows = Math.ceil(this.canvas.height / this.cell);
    const nCells = this.cols * this.rows;
    this.vote = new Int32Array(nCells);
    this.count = new Int32Array(nCells);
    this.settled = new Int32Array(nCells);
    this.civCell = new Int32Array(nCells);
    this.dirty = true;
  }

  /** Bigger tiles merge more of the box into each one; smaller ones show finer structure. */
  setTileSize(px: number) {
    this.tilePx = px;
    this.resize();
  }

  /** Tell the map what the panels cover, so fitting and centring use the clear area between them. */
  setInsets(left: number, top: number, right: number, bottom: number) {
    // The camera point is drawn at the centre of the clear area, so it stays put.
    this.insets = [left, top, right, bottom];
    this.dirty = true;
  }

  /** Centre of the clear area, device pixels. */
  private origin(): [number, number] {
    const dpr = devicePixelRatio || 1;
    const [l, t, r, b] = this.insets;
    return [(dpr * (l - r) + this.canvas.width) / 2, (dpr * (t - b) + this.canvas.height) / 2];
  }

  private fitScale() {
    if (!this.r) return 1;
    const dpr = devicePixelRatio || 1;
    const [l, t, r, b] = this.insets;
    const w = this.canvas.width - dpr * (l + r);
    const h = this.canvas.height - dpr * (t + b);
    return (0.94 * Math.max(100, Math.min(w, h))) / this.r.params.boxGly;
  }

  private toScreen(x: number, y: number): [number, number] {
    const [ox, oy] = this.origin();
    return [(x - this.camX) * this.scale + ox, (y - this.camY) * this.scale + oy];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    const [ox, oy] = this.origin();
    return [(sx - ox) / this.scale + this.camX, (sy - oy) / this.scale + this.camY];
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
    if (c < 0 || !this.r) return -1;
    if (this.civCell[c] >= 0) return this.civCell[c];
    return this.settled[c] > 0 ? this.r.polities.lineage[this.vote[c]] : -1;
  }

  private describe(cssX: number, cssY: number): string | null {
    const c = this.cellAt(cssX, cssY);
    const r = this.r;
    if (c < 0 || !r || !this.last) return null;
    const lines: string[] = [];
    const civ = this.civCell[c];
    if (civ >= 0) {
      const s = r.civs[civ];
      lines.push(`<b>${s.name}</b> · ${s.fate} · first light ${s.tTech.toFixed(2)} Gyr`);
    }
    if (this.count[c] > 0) {
      lines.push(`${this.count[c]} group${this.count[c] > 1 ? 's' : ''}, ${this.settled[c]} held`);
      if (this.settled[c] > 0) {
        const lin = r.polities.lineage[this.vote[c]];
        lines.push(`<b>${r.civs[lin].name}</b> · ${tierName(r, lin, this.last.t)}`);
      }
    }
    return lines.length ? lines.join('<br>') : null;
  }

  render(frame: Frame, selected: number, slice: Slice, layers: Layers) {
    const r = this.r;
    if (!r) return;
    this.last = frame;
    this.dirty = false;
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cell = this.cell;
    const cols = this.cols;
    const L = r.params.boxGly;
    const { x, y, z } = r.positions;
    const lineageOf = r.polities.lineage;
    const selLineage = selected >= 0 && frame.held[selected] > 0 ? selected : -1;

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);

    // Bin nodes into screen cells. The face of a cell is a majority vote by
    // polity — exact when one lineage holds most of it — pinned to the selection
    // when the selection is present.
    this.count.fill(0);
    this.settled.fill(0);
    this.civCell.fill(-1);
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
      if (lineageOf[o] === selLineage) {
        hasSel[c] = 1;
        this.vote[c] = o;
        voteCount[c] = 1 << 20;
      } else if (voteCount[c] === 0) {
        this.vote[c] = o;
        voteCount[c] = 1;
      } else if (lineageOf[this.vote[c]] === lineageOf[o]) voteCount[c]++;
      else voteCount[c]--;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${cell}px ${MONO}`;
    // Largest cell of each lineage on screen, for labels.
    const labelAt = new Map<number, { c: number; n: number; cells: number }>();
    for (let c = 0; c < this.count.length; c++) {
      const n = this.count[c];
      if (n === 0) continue;
      const cx = (c % cols) * cell + cell / 2;
      const cy = Math.floor(c / cols) * cell + cell / 2;
      if (this.settled[c] === 0) {
        if (!layers.empty) continue;
        ctx.fillStyle = `rgba(150,160,180,${Math.min(0.7, 0.18 + 0.08 * n)})`;
        ctx.fillText('·', cx, cy);
        continue;
      }
      const lin = lineageOf[this.vote[c]];
      const best = labelAt.get(lin);
      if (!best) labelAt.set(lin, { c, n: this.settled[c], cells: 1 });
      else {
        best.cells++;
        if (this.settled[c] > best.n) {
          best.c = c;
          best.n = this.settled[c];
        }
      }
      if (!layers.territory) continue;
      const heat = Math.min(1, Math.sqrt(lumSum[c] / this.settled[c]));
      const [cr, cg, cb] = lineageRgb(lin);
      const dim = selLineage >= 0 && !hasSel[c] ? 0.18 : 1;
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

    if (layers.strikes) this.drawStrikes(ctx, r, frame, selLineage, slice);
    if (layers.species) this.drawSpecies(ctx, r, frame, slice);
    if (layers.labels) this.drawLabels(ctx, r, labelAt, selLineage);
    if (selected >= 0 && layers.reach) this.drawSelection(ctx, r, frame, selected);
  }

  private drawStrikes(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, sel: number, slice: Slice) {
    const st = r.strikes;
    const { x, y, z } = r.positions;
    const L = r.params.boxGly;
    ctx.lineWidth = Math.max(1, this.cell / 8);
    ctx.font = `${this.cell}px ${MONO}`;
    for (const { s, f } of frame.inFlight) {
      if (!inSlice(z[st.from[s]], L, slice) && !inSlice(z[st.to[s]], L, slice)) continue;
      const a = st.from[s];
      const b = st.to[s];
      const [sx, sy] = this.toScreen(x[a], y[a]);
      const [ex, ey] = this.toScreen(x[a] + f * wrapDelta(x[a], x[b], L), y[a] + f * wrapDelta(y[a], y[b], L));
      const [cr, cg, cb] = lineageRgb(st.lineage[s]);
      const dim = sel >= 0 && st.lineage[s] !== sel && st.victim[s] !== sel ? 0.25 : 1;
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
  }

  private drawSpecies(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, slice: Slice) {
    const { x, y, z } = r.positions;
    const L = r.params.boxGly;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cell = this.cell;
    for (const c of r.civs) {
      if (!inSlice(z[c.node], L, slice) || c.fate === 'preempted') continue;
      const age = frame.t - c.tTech;
      if (age < 0) continue;
      const [sx, sy] = this.toScreen(x[c.node], y[c.node]);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const stayed = (c.fate === 'quiet' || c.fate === 'engulfed') && c.tFate <= frame.t;
      if (age < FADE) {
        const silent = c.saw && c.saw.lineages === 0 && !c.saw.far;
        ctx.fillStyle = silent ? `rgba(255,255,255,${1 - age / FADE})` : `rgba(255,170,90,${1 - age / FADE})`;
        ctx.font = `bold ${Math.round(cell * 1.4)}px ${MONO}`;
        ctx.fillText('✶', sx, sy);
      } else if (stayed) {
        ctx.fillStyle = 'rgba(230,235,245,0.8)';
        ctx.font = `${cell}px ${MONO}`;
        ctx.fillText('o', sx, sy);
      } else continue;
      const cc = Math.floor(sy / cell) * this.cols + Math.floor(sx / cell);
      this.civCell[cc] = c.id;
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D, r: SimResult, labelAt: Map<number, { c: number; n: number; cells: number }>, sel: number) {
    const dpr = devicePixelRatio || 1;
    // Only territories big enough to read, largest first, at most a dozen.
    const big = [...labelAt].filter(([, v]) => v.cells >= 25).sort((a, b) => b[1].cells - a[1].cells).slice(0, 12);
    ctx.font = `600 ${Math.round(12 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [lin, { c }] of big) {
      if (sel >= 0 && lin !== sel) continue;
      const cx = (c % this.cols) * this.cell + this.cell / 2;
      const cy = Math.floor(c / this.cols) * this.cell + this.cell / 2;
      const name = r.civs[lin].name;
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(5,6,10,0.85)';
      ctx.strokeText(name, cx, cy);
      ctx.fillStyle = `rgb(${lineageRgb(lin).join(',')})`;
      ctx.fillText(name, cx, cy);
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, civId: number) {
    const c = r.civs[civId];
    const L = r.params.boxGly;
    const { x, y } = r.positions;
    const [ox, oy] = this.toScreen(x[c.node], y[c.node]);
    const dpr = devicePixelRatio || 1;
    ctx.save();
    ctx.lineWidth = dpr;
    ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    // What they could see when they first looked up.
    if (frame.t >= c.tTech && this.sight.length) {
      ctx.strokeStyle = 'rgba(255,170,90,0.35)';
      for (const { node } of this.sight) {
        const [tx, ty] = this.toScreen(x[c.node] + wrapDelta(x[c.node], x[node], L), y[c.node] + wrapDelta(y[c.node], y[node], L));
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }
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
    if (k >= 0 && frame.held[civId] > 0) {
      const range = r.params.detectRange * TIERS[k].sensor * this.scale;
      const [cr, cg, cb] = lineageRgb(civId);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.5)`;
      ctx.beginPath();
      ctx.arc(ox, oy, range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.8)`;
      ctx.fillText('sensor range', ox + range * 0.71 + 4, oy + range * 0.71);
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(16 * dpr)}px ${MONO}`;
    ctx.fillText('◎', ox, oy);
    ctx.restore();
  }
}
