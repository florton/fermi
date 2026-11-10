/**
 * The map: a top-down tile view of a depth slice through the box, one tile per
 * screen cell. Cell size is fixed on screen, so zooming in resolves finer
 * structure rather than drawing bigger blocks, and detail fills in as it does:
 *
 *   far   territory as solid shapes, brighter with more waste heat, with seams
 *         where lineages meet; empty space as a faint density wash; new species
 *         as small sparks; strikes as faint lines
 *   mid   territory tiles that fill out as starlight turns to waste heat; empty
 *         groups as dots; ✶ for new species, faint rings for ones that stayed home
 *   near  every galaxy group as a disc sized by mass, ringed in its lineage's
 *         colour and filled by its waste heat; stay-at-homes ringed and named
 *
 * Drag to pan, wheel to zoom, click to select: a species marker if there is one
 * under the cursor, otherwise the lineage with most of that cell.
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
  /** Repeat the wrapping box to fill the screen. */
  wrap: boolean;
  /** The symbol key under the map (drawn by the page, not the canvas). */
  key: boolean;
}

export function inSlice(z: number, L: number, s: Slice): boolean {
  if (s.width >= 1) return true;
  let d = Math.abs(z / L - s.center);
  if (d > 0.5) d = 1 - d;
  return d <= s.width / 2;
}

const MONO = 'ui-monospace, Consolas, monospace';

/** Levels of detail: zoomed out, in between, close enough to see single galaxy groups. */
export const FAR = 0;
export const MID = 1;
export const NEAR = 2;

export class MapView {
  readonly canvas: HTMLCanvasElement;
  onPick: (civ: number) => void = () => {};
  onHover: (html: string | null, x: number, y: number) => void = () => {};
  dirty = true;
  /** Nodes the selected species saw at first light, set by the caller. */
  sight: { node: number; lineage: number }[] = [];
  /** Level of detail the last frame was drawn at. */
  level = FAR;

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
  /** Repeat the wrapping box to fill the screen. */
  private wrap = true;
  /** Screen space covered by floating panels and bars, CSS pixels: left, top, right, bottom. */
  private insets = [0, 0, 0, 0];
  private meanMass = 1;

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
    let m = 0;
    for (const v of r.positions.mass) m += v;
    this.meanMass = m / Math.max(1, r.positions.mass.length) || 1;
    this.resize();
    this.reset();
  }

  /** More of the same run has arrived: keep the camera where it is. */
  update(r: SimResult) {
    this.r = r;
    this.dirty = true;
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

  /**
   * Call fn with every on-screen position of a point. The box wraps, so with the
   * wrap layer on, the view repeats it to fill the screen, the way the universe
   * would look if you could see past an edge. `margin` lets things that extend
   * right/down from the point (like a box outline) count as on screen.
   */
  private eachImage(x: number, y: number, fn: (sx: number, sy: number) => void, margin = 0) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const [sx0, sy0] = this.toScreen(x, y);
    if (!this.wrap || !this.r) {
      if (sx0 + margin >= 0 && sy0 + margin >= 0 && sx0 < W && sy0 < H) fn(sx0, sy0);
      return;
    }
    const step = this.r.params.boxGly * this.scale;
    const i0 = Math.ceil((-margin - sx0) / step);
    const i1 = Math.floor((W - 1 - sx0) / step);
    const j0 = Math.ceil((-margin - sy0) / step);
    const j1 = Math.floor((H - 1 - sy0) / step);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) fn(sx0 + i * step, sy0 + j * step);
    }
  }

  /** The on-screen copy of a point nearest the middle of the clear area. */
  private nearestImage(x: number, y: number): [number, number] {
    const [ox, oy] = this.origin();
    let best: [number, number] = this.toScreen(x, y);
    if (!this.wrap || !this.r) return best;
    const step = this.r.params.boxGly * this.scale;
    best = [best[0] - Math.round((best[0] - ox) / step) * step, best[1] - Math.round((best[1] - oy) / step) * step];
    return best;
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
      if (this.settled[c] > 0) {
        const lin = r.polities.lineage[this.vote[c]];
        lines.push(`<b>${r.civs[lin].name}</b> · ${tierName(r, lin, this.last.t)}`);
      }
      lines.push(`${this.count[c]} galaxy group${this.count[c] > 1 ? 's' : ''}`);
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
    this.wrap = layers.wrap;
    const bin = (sx: number, sy: number, i: number) => {
      const c = Math.floor(sy / cell) * cols + Math.floor(sx / cell);
      this.count[c]++;
      const o = frame.owner[i];
      if (o < 0) return;
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
    };
    for (let i = 0; i < x.length; i++) {
      if (!inSlice(z[i], L, slice)) continue;
      this.eachImage(x[i], y[i], (sx, sy) => bin(sx, sy, i));
    }

    const lod = this.lod(slice);
    this.level = lod;
    const nCells = this.count.length;
    // Each cell's face lineage, or -1, so frontiers between lineages can be drawn.
    const cellLin = new Int32Array(nCells).fill(-1);
    let binned = 0;
    let occupied = 0;
    for (let c = 0; c < nCells; c++) {
      if (this.settled[c] > 0) cellLin[c] = lineageOf[this.vote[c]];
      if (this.count[c] > 0) {
        binned += this.count[c];
        occupied++;
      }
    }
    const meanCount = occupied ? binned / occupied : 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${cell}px ${MONO}`;
    // Largest cell of each lineage on screen, for labels.
    const labelAt = new Map<number, { c: number; n: number; cells: number }>();
    for (let c = 0; c < nCells; c++) {
      const n = this.count[c];
      if (n === 0) continue;
      const x0 = (c % cols) * cell;
      const y0 = Math.floor(c / cols) * cell;
      if (this.settled[c] === 0) {
        if (!layers.empty || lod === NEAR) continue;
        if (lod === FAR) {
          // A faint wash by density, so the cosmic web shows without a field of dots.
          ctx.fillStyle = `rgba(150,160,180,${(0.05 * Math.min(2.5, n / meanCount)).toFixed(3)})`;
          ctx.fillRect(x0, y0, cell, cell);
        } else {
          ctx.fillStyle = `rgba(150,160,180,${Math.min(0.55, 0.12 + 0.06 * n)})`;
          ctx.fillText('·', x0 + cell / 2, y0 + cell / 2);
        }
        continue;
      }
      const lin = cellLin[c];
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
      if (lod === NEAR) {
        // Up close the galaxy groups themselves carry the detail; the cell is a faint wash.
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.13 * dim})`;
        ctx.fillRect(x0, y0, cell, cell);
      } else if (lod === FAR) {
        // Solid territory, brighter with more waste heat, with a dark seam where
        // two lineages meet so neighbouring empires read as separate shapes.
        const right = c % cols < cols - 1 ? cellLin[c + 1] : lin;
        const below = c + cols < nCells ? cellLin[c + cols] : lin;
        const seamR = right >= 0 && right !== lin ? 1 : 0;
        const seamB = below >= 0 && below !== lin ? 1 : 0;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(dim * (0.25 + 0.5 * heat)).toFixed(3)})`;
        ctx.fillRect(x0, y0, cell - seamR, cell - seamB);
      } else {
        // A tile that fills out and brightens as its starlight is converted to waste heat.
        const shade = Math.min(3, Math.floor(heat * 4));
        const inset = (cell * (3 - shade)) / 10;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${dim * (0.4 + 0.2 * shade)})`;
        ctx.fillRect(x0 + inset + 0.5, y0 + inset + 0.5, cell - 2 * inset - 1, cell - 2 * inset - 1);
      }
    }

    if (lod === NEAR) this.drawGroups(ctx, r, frame, slice, layers, selLineage);

    // Box edges: one copy, or every repeat when the wrap fills the screen.
    ctx.strokeStyle = '#1d2230';
    ctx.lineWidth = 1;
    if (this.wrap) ctx.setLineDash([6, 6]);
    this.eachImage(0, 0, (bx, by) => ctx.strokeRect(bx, by, L * this.scale, L * this.scale), L * this.scale);
    ctx.setLineDash([]);

    if (layers.strikes) this.drawStrikes(ctx, r, frame, selLineage, slice, lod);
    if (layers.species) this.drawSpecies(ctx, r, frame, slice, lod);
    if (layers.labels) this.drawLabels(ctx, r, labelAt, selLineage, lod);
    if (selected >= 0 && layers.reach) this.drawSelection(ctx, r, frame, selected);
  }

  /**
   * How much detail the current zoom can carry, from how far apart neighbouring
   * galaxy groups land on screen: far, many to a tile; mid, a few; near, each
   * group distinct.
   */
  private lod(slice: Slice): number {
    if (!this.r) return FAR;
    const inView = this.r.positions.x.length * Math.min(1, slice.width);
    const spacing = ((this.r.params.boxGly / Math.sqrt(Math.max(1, inView))) * this.scale) / this.cell;
    return spacing >= 1.4 ? NEAR : spacing >= 0.45 ? MID : FAR;
  }

  /** Up close: each galaxy group in the slab as a disc sized by its mass; held ones ringed in their lineage's colour and filled as their starlight turns to waste heat. */
  private drawGroups(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, slice: Slice, layers: Layers, sel: number) {
    const { x, y, z, mass } = r.positions;
    const L = r.params.boxGly;
    const lineageOf = r.polities.lineage;
    const dpr = devicePixelRatio || 1;
    const inView = x.length * Math.min(1, slice.width);
    const spacingPx = (L / Math.sqrt(Math.max(1, inView))) * this.scale;
    const base = Math.min(this.cell * 0.45, spacingPx * 0.28);
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.lineWidth = Math.max(1, 1.3 * dpr);
    for (let i = 0; i < x.length; i++) {
      if (!inSlice(z[i], L, slice)) continue;
      const rad = Math.max(1.2 * dpr, base * Math.cbrt(mass[i] / this.meanMass));
      const o = frame.owner[i];
      if (o < 0) {
        if (!layers.empty) continue;
        ctx.fillStyle = 'rgba(150,160,180,0.45)';
      } else if (!layers.territory) continue;
      this.eachImage(x[i], y[i], (sx, sy) => {
        if (sx < -rad || sy < -rad || sx > W + rad || sy > H + rad) return;
        ctx.beginPath();
        ctx.arc(sx, sy, o < 0 ? rad * 0.6 : rad, 0, Math.PI * 2);
        if (o < 0) {
          ctx.fill();
          return;
        }
        const lin = lineageOf[o];
        const [cr, cg, cb] = lineageRgb(lin);
        const dim = sel >= 0 && lin !== sel ? 0.25 : 1;
        const heat = Math.min(1, Math.sqrt(frame.lum[i]));
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(dim * (0.12 + 0.8 * heat)).toFixed(3)})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.9 * dim})`;
        ctx.stroke();
      });
    }
  }

  private drawStrikes(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, sel: number, slice: Slice, lod: number) {
    const st = r.strikes;
    const { x, y, z } = r.positions;
    const L = r.params.boxGly;
    const far = lod === FAR;
    const dot = this.cell * 0.18;
    ctx.lineWidth = far ? 1 : Math.max(1, this.cell / 8);
    ctx.font = `${this.cell}px ${MONO}`;
    for (const { s, f } of frame.inFlight) {
      if (!inSlice(z[st.from[s]], L, slice) && !inSlice(z[st.to[s]], L, slice)) continue;
      const a = st.from[s];
      const b = st.to[s];
      // Head offset in screen units, along the short way round the wrap.
      const hx = f * wrapDelta(x[a], x[b], L) * this.scale;
      const hy = f * wrapDelta(y[a], y[b], L) * this.scale;
      const [cr, cg, cb] = lineageRgb(st.lineage[s]);
      const dim = sel >= 0 && st.lineage[s] !== sel && st.victim[s] !== sel ? 0.25 : 1;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(far ? 0.35 : 0.6) * dim})`;
      ctx.fillStyle = `rgba(255,255,255,${(far ? 0.7 : 1) * dim})`;
      this.eachImage(x[a], y[a], (sx, sy) => {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + hx, sy + hy);
        ctx.stroke();
        if (far) ctx.fillRect(sx + hx - dot / 2, sy + hy - dot / 2, dot, dot);
        else ctx.fillText('•', sx + hx, sy + hy);
      });
    }
    for (const { s, age } of frame.impacts) {
      const b = st.to[s];
      if (!inSlice(z[b], L, slice)) continue;
      ctx.fillStyle = `rgba(255,80,60,${1 - age})`;
      if (far) this.eachImage(x[b], y[b], (sx, sy) => ctx.fillRect(sx - dot, sy - dot, 2 * dot, 2 * dot));
      else this.eachImage(x[b], y[b], (sx, sy) => ctx.fillText('x', sx, sy));
    }
  }

  /**
   * New species flash as they look up (white: saw no one; orange: saw someone).
   * Ones that stayed home are marked only once there's room: a faint ring in
   * the middle zoom, a ring and their name up close.
   */
  private drawSpecies(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, slice: Slice, lod: number) {
    const { x, y, z } = r.positions;
    const L = r.params.boxGly;
    const cell = this.cell;
    const dpr = devicePixelRatio || 1;
    const mark = (id: number, sx: number, sy: number) => {
      const c = Math.floor(sy / cell) * this.cols + Math.floor(sx / cell);
      if (c >= 0 && c < this.civCell.length) this.civCell[c] = id;
    };
    for (const c of r.civs) {
      if (!inSlice(z[c.node], L, slice) || c.fate === 'preempted') continue;
      const age = frame.t - c.tTech;
      if (age < 0) continue;
      if (age < FADE) {
        const silent = c.saw && c.saw.lineages === 0 && !c.saw.far;
        const alpha = 1 - age / FADE;
        const a = lod === FAR ? 0.8 * alpha : alpha;
        ctx.fillStyle = silent ? `rgba(255,255,255,${a})` : `rgba(255,170,90,${a})`;
        if (lod === FAR) {
          // A small spark rather than a glyph, so a busy epoch doesn't turn to snow.
          const rad = Math.max(dpr, cell * 0.11 * (1 + alpha));
          this.eachImage(x[c.node], y[c.node], (sx, sy) => {
            ctx.beginPath();
            ctx.arc(sx, sy, rad, 0, Math.PI * 2);
            ctx.fill();
            mark(c.id, sx, sy);
          });
        } else {
          ctx.font = `bold ${Math.round(cell)}px ${MONO}`;
          this.eachImage(x[c.node], y[c.node], (sx, sy) => {
            ctx.fillText('✶', sx, sy);
            mark(c.id, sx, sy);
          });
        }
        continue;
      }
      const stayed = (c.fate === 'quiet' || c.fate === 'engulfed') && c.tFate <= frame.t;
      if (!stayed || lod === FAR) continue;
      const [cr, cg, cb] = lineageRgb(c.id);
      const near = lod === NEAR;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${near ? 0.9 : 0.45})`;
      ctx.lineWidth = near ? 1.5 * dpr : dpr;
      const rad = near ? cell * 0.42 : cell * 0.25;
      this.eachImage(x[c.node], y[c.node], (sx, sy) => {
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.stroke();
        mark(c.id, sx, sy);
        if (near) {
          ctx.font = `${Math.round(10 * dpr)}px system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(200,210,230,0.75)';
          ctx.fillText(c.name, sx, sy + rad + 8 * dpr);
        }
      });
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D, r: SimResult, labelAt: Map<number, { c: number; n: number; cells: number }>, sel: number, lod: number) {
    const dpr = devicePixelRatio || 1;
    // Only territories big enough to read, largest first; closer in, smaller ones get names too.
    const minCells = [25, 10, 4][lod];
    const big = [...labelAt].filter(([, v]) => v.cells >= minCells).sort((a, b) => b[1].cells - a[1].cells).slice(0, lod === NEAR ? 24 : 12);
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
    // With the wrap on there are many copies of their home; annotate the one nearest the middle.
    const [ox, oy] = this.nearestImage(x[c.node], y[c.node]);
    const dpr = devicePixelRatio || 1;
    ctx.save();
    ctx.lineWidth = dpr;
    ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    // What they could see when they first looked up.
    if (frame.t >= c.tTech && this.sight.length) {
      ctx.strokeStyle = 'rgba(255,170,90,0.35)';
      for (const { node } of this.sight) {
        const tx = ox + wrapDelta(x[c.node], x[node], L) * this.scale;
        const ty = oy + wrapDelta(y[c.node], y[node], L) * this.scale;
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
