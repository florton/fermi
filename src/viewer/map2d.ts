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

import { lineageSensor, maturity } from '../core/tech.ts';
import type { SimResult } from '../core/sim.ts';
import { FADE, boxWidth, cosmo, heatShade, kardashevLabel, lightFront, lineageRgb, tierName, wrapDelta, type Frame } from './state.ts';

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

/** A lineage's tiles on screen: how many, how many groups, and their screen positions summed by groups. */
interface LabelSpot {
  cells: number;
  w: number;
  sx: number;
  sy: number;
}

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
  /** Screen space covered by floating panels and bars, CSS pixels: left, top, right, bottom. */
  private insets = [0, 0, 0, 0];
  private meanMass = 1;
  /** Lineages named in the last frame, so names don't swap in and out between frames. */
  private labelsShown = new Set<number>();
  /** Where each of those names sat, in world coordinates, so it can stay put while the camera moves. */
  private labelWorld = new Map<number, [number, number]>();

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
          this.clamp();
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
    this.camX = boxWidth(this.r) / 2;
    this.camY = this.r.universe.boxGly / 2;
    this.scale = this.fitScale();
    this.clamp();
    this.dirty = true;
  }

  /** Zoom by a factor about a point given in CSS pixels. */
  zoomAt(cssX: number, cssY: number, factor: number) {
    const dpr = devicePixelRatio || 1;
    const [wx, wy] = this.toWorld(cssX * dpr, cssY * dpr);
    // Never smaller than the whole box fitting the clear area: it is shown once.
    this.scale = Math.min(this.maxScale(), Math.max(this.fitScale(), this.scale * factor));
    const [wx2, wy2] = this.toWorld(cssX * dpr, cssY * dpr);
    this.camX += wx - wx2;
    this.camY += wy - wy2;
    this.clamp();
    this.dirty = true;
  }

  /** Centre the view on a node. */
  focus(node: number) {
    if (!this.r) return;
    this.camX = this.r.positions.x[node];
    this.camY = this.r.positions.y[node];
    this.clamp();
    this.dirty = true;
  }

  resize() {
    // A hidden canvas measures 0; sizing it then would leave a 1-pixel buffer stretched when shown.
    if (this.canvas.clientWidth === 0) return;
    const wasFit = this.atFit();
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
    this.refit(wasFit);
  }

  /** After the screen or the clear area changes: stay fitted if fitted, else never smaller than the fit. */
  private refit(wasFit: boolean) {
    if (this.r) this.scale = wasFit ? this.fitScale() : Math.max(this.scale, this.fitScale());
    this.clamp();
    this.dirty = true;
  }

  /** Whether the view is zoomed all the way out. */
  private atFit() {
    return !!this.r && this.scale <= this.fitScale() * 1.001;
  }

  /** Zoom by a factor about the middle of the clear area. */
  zoomCentre(factor: number) {
    const dpr = devicePixelRatio || 1;
    const [ox, oy] = this.origin();
    this.zoomAt(ox / dpr, oy / dpr, factor);
  }

  /** Bigger tiles merge more of the box into each one; smaller ones show finer structure. */
  setTileSize(px: number) {
    this.tilePx = px;
    this.resize();
  }

  /** Tell the map what the panels cover, so centring on something uses the clear area between them. */
  setInsets(left: number, top: number, right: number, bottom: number) {
    // The camera point is drawn at the centre of the clear area, so it stays put.
    const wasFit = this.atFit();
    this.insets = [left, top, right, bottom];
    this.refit(wasFit);
  }

  /** The clear area between panels and bars, device pixels: left, top, right, bottom edges. */
  private clear(): [number, number, number, number] {
    const dpr = devicePixelRatio || 1;
    const [l, t, r, b] = this.insets;
    const W = this.canvas.width;
    const H = this.canvas.height;
    let [x0, x1, y0, y1] = [dpr * l, W - dpr * r, dpr * t, H - dpr * b];
    // If panels would squeeze the map to a sliver, use the whole screen on that axis instead.
    if (x1 - x0 < 0.2 * W) [x0, x1] = [0, W];
    if (y1 - y0 < 0.2 * H) [y0, y1] = [0, H];
    return [x0, y0, x1, y1];
  }

  /** Centre of the clear area, device pixels. */
  private origin(): [number, number] {
    const [x0, y0, x1, y1] = this.clear();
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }

  /** The scale at which the whole box just fits the clear area, shown once. */
  private fitScale() {
    if (!this.r) return 1;
    const [x0, y0, x1, y1] = this.clear();
    return Math.max(1e-3, Math.min((x1 - x0) / boxWidth(this.r), (y1 - y0) / this.r.universe.boxGly));
  }

  /** Closest zoom: about 60 times the box filling the whole window. */
  private maxScale() {
    if (!this.r) return 1;
    return (60 * Math.max(100, this.canvas.width, this.canvas.height)) / Math.max(boxWidth(this.r), this.r.universe.boxGly);
  }

  /**
   * Keep the box in the clear area: where it is bigger than the clear area, an
   * edge can be panned up to the clear area's edge but not past it, so nothing is
   * ever stuck under a panel; where it is smaller, it sits in the middle.
   */
  private clamp() {
    if (!this.r) return;
    const [x0, y0, x1, y1] = this.clear();
    const [ox, oy] = this.origin();
    const axis = (cam: number, side: number, o: number, lo: number, hi: number) => {
      // Screen position of world v is (v - cam) * scale + o.
      const min = (o - lo) / this.scale; // box's near edge at the clear area's near edge
      const max = side - (hi - o) / this.scale; // far edge at the far edge
      if (min > max) return side / 2;
      return Math.min(max, Math.max(min, cam));
    };
    this.camX = axis(this.camX, boxWidth(this.r), ox, x0, x1);
    this.camY = axis(this.camY, this.r.universe.boxGly, oy, y0, y1);
  }

  /** Call fn with a point's screen position if it is on screen. `margin` lets things that extend right/down from the point count. */
  private eachImage(x: number, y: number, fn: (sx: number, sy: number) => void, margin = 0) {
    const [sx, sy] = this.toScreen(x, y);
    if (sx + margin >= 0 && sy + margin >= 0 && sx < this.canvas.width && sy < this.canvas.height) fn(sx, sy);
  }

  private nearestImage(x: number, y: number): [number, number] {
    return this.toScreen(x, y);
  }

  /** Restrict drawing to the box, for things that run past an edge and wrap. */
  private clipToBox(ctx: CanvasRenderingContext2D, r: SimResult) {
    const [bx, by] = this.toScreen(0, 0);
    ctx.beginPath();
    ctx.rect(bx, by, boxWidth(r) * this.scale, r.universe.boxGly * this.scale);
    ctx.clip();
  }

  /**
   * World offsets to draw something at so that the part past an edge shows up
   * from the opposite edge: none if (px, py) is inside the box, else one shift
   * per axis it has left by, and both together.
   */
  private wrapImages(px: number, py: number, Lx: number, L: number): [number, number][] {
    const sx = px < 0 ? Lx : px >= Lx ? -Lx : 0;
    const sy = py < 0 ? L : py >= L ? -L : 0;
    const out: [number, number][] = [[0, 0]];
    if (sx) out.push([sx, 0]);
    if (sy) out.push([0, sy]);
    if (sx && sy) out.push([sx, sy]);
    return out;
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
        lines.push(`<b>${r.civs[lin].name}</b> · ${tierName(r, lin, this.last.t)} · ${kardashevLabel(r, this.last, lin)}`);
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
    const heatSum = new Float32Array(this.count.length);
    const hasSel = new Uint8Array(this.count.length);
    const bin = (sx: number, sy: number, i: number) => {
      const c = Math.floor(sy / cell) * cols + Math.floor(sx / cell);
      this.count[c]++;
      const o = frame.owner[i];
      if (o < 0) return;
      this.settled[c]++;
      heatSum[c] += heatShade(frame.heat[i]);
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
    // Each lineage's on-screen extent, for labels: tiles held and their centre of mass.
    const labelAt = new Map<number, LabelSpot>();
    for (let c = 0; c < nCells; c++) {
      const n = this.count[c];
      if (n === 0) continue;
      const x0 = (c % cols) * cell;
      const y0 = Math.floor(c / cols) * cell;
      if (this.settled[c] === 0) {
        if (!layers.empty || lod === NEAR) continue;
        if (lod === FAR) {
          // A small point, brighter where groups crowd, so the cosmic web shows quietly.
          const d = Math.max(1, Math.round(cell * 0.09));
          ctx.fillStyle = `rgba(150,160,180,${(0.12 + 0.12 * Math.min(2.5, n / meanCount)).toFixed(3)})`;
          ctx.fillRect(x0 + (cell - d) / 2, y0 + (cell - d) / 2, d, d);
        } else {
          ctx.fillStyle = `rgba(150,160,180,${Math.min(0.55, 0.12 + 0.06 * n)})`;
          ctx.fillText('·', x0 + cell / 2, y0 + cell / 2);
        }
        continue;
      }
      const lin = cellLin[c];
      const w = this.settled[c];
      const spot = labelAt.get(lin);
      if (!spot) labelAt.set(lin, { cells: 1, w, sx: w * (x0 + cell / 2), sy: w * (y0 + cell / 2) });
      else {
        spot.cells++;
        spot.w += w;
        spot.sx += w * (x0 + cell / 2);
        spot.sy += w * (y0 + cell / 2);
      }
      if (!layers.territory) continue;
      const heat = heatSum[c] / this.settled[c];
      const [cr, cg, cb] = lineageRgb(lin);
      const dim = selLineage >= 0 && !hasSel[c] ? 0.18 : 1;
      if (lod === NEAR) {
        // Up close the galaxy groups themselves carry the detail; the cell is a faint wash.
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.13 * dim})`;
        ctx.fillRect(x0, y0, cell, cell);
      } else if (lod === FAR) {
        // Whole tiles in full colour, brighter with more waste heat, a hairline
        // apart, and a wider seam where two lineages meet so empires read as shapes.
        const right = c % cols < cols - 1 ? cellLin[c + 1] : lin;
        const below = c + cols < nCells ? cellLin[c + cols] : lin;
        const gap = Math.max(1, Math.round(cell * 0.06));
        const gapR = right >= 0 && right !== lin ? 2 * gap : gap;
        const gapB = below >= 0 && below !== lin ? 2 * gap : gap;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(dim * (0.5 + 0.5 * heat)).toFixed(3)})`;
        ctx.fillRect(x0, y0, cell - gapR, cell - gapB);
      } else {
        // A tile that fills out and brightens as its starlight is converted to waste heat.
        const shade = Math.min(3, Math.floor(heat * 4));
        const inset = (cell * (3 - shade)) / 10;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${dim * (0.4 + 0.2 * shade)})`;
        ctx.fillRect(x0 + inset + 0.5, y0 + inset + 0.5, cell - 2 * inset - 1, cell - 2 * inset - 1);
      }
    }

    if (lod === NEAR) this.drawGroups(ctx, r, frame, slice, layers, selLineage);

    // The box's edge, seen only when zoomed to it.
    ctx.strokeStyle = '#1d2230';
    ctx.lineWidth = 1;
    const [bx, by] = this.toScreen(0, 0);
    ctx.strokeRect(bx, by, boxWidth(r) * this.scale, L * this.scale);

    if (layers.strikes) this.drawStrikes(ctx, r, frame, selLineage, slice, lod);
    if (layers.species) this.drawSpecies(ctx, r, frame, slice, lod);
    if (layers.labels) this.drawLabels(ctx, r, labelAt, cellLin, selLineage, lod);
    if (selected >= 0 && layers.reach) this.drawSelection(ctx, r, frame, selected);
  }

  /**
   * How much detail the current zoom can carry, from how far apart neighbouring
   * galaxy groups land on screen: far, many to a tile; mid, a few; near, each
   * group distinct.
   */
  private lod(slice: Slice): number {
    if (!this.r) return FAR;
    const spacing = (this.groupSpacing(this.r, slice) * this.scale) / this.cell;
    return spacing >= 1.4 ? NEAR : spacing >= 0.45 ? MID : FAR;
  }

  /** Typical distance between neighbouring groups in the slab as seen from above, Gly. */
  private groupSpacing(r: SimResult, slice: Slice): number {
    const inView = r.positions.x.length * Math.min(1, slice.width);
    return Math.sqrt((boxWidth(r) * r.universe.boxGly) / Math.max(1, inView));
  }

  /** Up close: each galaxy group in the slab as a disc sized by its mass; held ones ringed in their lineage's colour and filled as their starlight turns to waste heat. */
  private drawGroups(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, slice: Slice, layers: Layers, sel: number) {
    const { x, y, z, mass } = r.positions;
    const L = r.params.boxGly;
    const lineageOf = r.polities.lineage;
    const dpr = devicePixelRatio || 1;
    const spacingPx = this.groupSpacing(r, slice) * this.scale;
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
        const heat = heatShade(frame.heat[i]);
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
    const Lx = boxWidth(r);
    const W = this.canvas.width;
    const H = this.canvas.height;
    const pad = this.cell;
    ctx.save();
    this.clipToBox(ctx, r);
    for (const { s, f } of frame.inFlight) {
      if (!inSlice(z[st.from[s]], L, slice) && !inSlice(z[st.to[s]], L, slice)) continue;
      const a = st.from[s];
      const b = st.to[s];
      // The head, along the short way round the wrap, in world units and possibly past an edge.
      const ex = x[a] + f * wrapDelta(x[a], x[b], Lx);
      const ey = y[a] + f * wrapDelta(y[a], y[b], L);
      const [cr, cg, cb] = lineageRgb(st.lineage[s]);
      const dim = sel >= 0 && st.lineage[s] !== sel && st.victim[s] !== sel ? 0.25 : 1;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(far ? 0.35 : 0.6) * dim})`;
      ctx.fillStyle = `rgba(255,255,255,${(far ? 0.7 : 1) * dim})`;
      // A trail that crosses an edge carries on from the opposite one.
      for (const [wx, wy] of this.wrapImages(ex, ey, Lx, L)) {
        const [sx, sy] = this.toScreen(x[a] + wx, y[a] + wy);
        const [hx, hy] = this.toScreen(ex + wx, ey + wy);
        // Drawn whenever any of the trail is on screen, not only its launch point,
        // so zooming in on the head of a strike doesn't lose it.
        if (Math.max(sx, hx) < -pad || Math.min(sx, hx) > W + pad) continue;
        if (Math.max(sy, hy) < -pad || Math.min(sy, hy) > H + pad) continue;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        if (far) ctx.fillRect(hx - dot / 2, hy - dot / 2, dot, dot);
        else ctx.fillText('•', hx, hy);
      }
    }
    ctx.restore();
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

  /**
   * Names for the larger territories on screen. Kept steady from frame to frame:
   * each sits at its territory's core (the tile with the most of its own tiles
   * around it) and stays exactly where it was for as long as that spot is still
   * theirs and still fairly central, names already showing keep their place
   * ahead of newcomers of about the same size, and a name that would overlap one
   * already placed is left out rather than drawn on top.
   */
  private drawLabels(ctx: CanvasRenderingContext2D, r: SimResult, labelAt: Map<number, LabelSpot>, cellLin: Int32Array, sel: number, lod: number) {
    const dpr = devicePixelRatio || 1;
    const minCells = [25, 10, 4][lod];
    const limit = lod === NEAR ? 24 : 12;
    const shown = this.labelsShown;
    // Names already showing count as half again as big, and stay until well under the threshold.
    const score = (lin: number, cells: number) => (shown.has(lin) ? 1.5 * cells : cells);
    const candidates = [...labelAt]
      .filter(([lin, v]) => (sel < 0 || lin === sel) && v.cells >= (shown.has(lin) ? 0.6 * minCells : minCells))
      .sort((a, b) => score(b[0], b[1].cells) - score(a[0], a[1].cells))
      .slice(0, 2 * limit);

    // Anchor each name at the core of its territory: a tile with nearly as many
    // of its own tiles around it as the densest one. Of those, the one nearest
    // where the name was last frame, or, for a new name, nearest the centre of mass.
    const cell = this.cell;
    const cols = this.cols;
    const rows = Math.ceil(cellLin.length / cols);
    const R = 2;
    const density = (c: number, lin: number) => {
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      let n = 0;
      for (let y = Math.max(0, cy - R); y <= Math.min(rows - 1, cy + R); y++)
        for (let x = Math.max(0, cx - R); x <= Math.min(cols - 1, cx + R); x++) if (cellLin[y * cols + x] === lin) n++;
      return n;
    };
    const want = new Map<number, { ax: number; ay: number; best: number; dist: number; c: number }>();
    for (const [lin, v] of candidates) {
      const prev = this.labelWorld.get(lin);
      const [ax, ay] = prev ? this.toScreen(prev[0], prev[1]) : [v.sx / v.w, v.sy / v.w];
      want.set(lin, { ax, ay, best: -1, dist: Infinity, c: -1 });
    }
    const centre = (c: number): [number, number] => [(c % cols) * cell + cell / 2, Math.floor(c / cols) * cell + cell / 2];
    const dens = new Int16Array(cellLin.length);
    for (let c = 0; c < cellLin.length; c++) {
      const lin = cellLin[c];
      const w = want.get(lin);
      if (!w) continue;
      dens[c] = density(c, lin);
      if (dens[c] > w.best) w.best = dens[c];
    }
    // Of the tiles dense enough to count as core, the one nearest the old spot,
    // so a name that loses its place moves a little rather than across the map.
    for (let c = 0; c < cellLin.length; c++) {
      const w = want.get(cellLin[c]);
      if (!w || dens[c] < 0.6 * w.best) continue;
      const [x, y] = centre(c);
      const dist = (x - w.ax) ** 2 + (y - w.ay) ** 2;
      if (dist < w.dist) {
        w.dist = dist;
        w.c = c;
      }
    }
    /** Screen spot for a name: where it was, if that is still theirs and still near their core; else the core. */
    const spotFor = (lin: number): [number, number] => {
      const w = want.get(lin)!;
      const prev = this.labelWorld.get(lin);
      if (prev) {
        const [px, py] = this.toScreen(prev[0], prev[1]);
        const gx = Math.floor(px / cell);
        const gy = Math.floor(py / cell);
        if (gx >= 0 && gy >= 0 && gx < cols && gy < rows) {
          const pc = gy * cols + gx;
          if (cellLin[pc] === lin && density(pc, lin) >= 0.6 * w.best) return [px, py];
        }
      }
      return centre(w.c);
    };

    ctx.font = `600 ${Math.round(12 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed: [number, number, number, number][] = [];
    const h = 16 * dpr;
    const next = new Set<number>();
    const nextWorld = new Map<number, [number, number]>();
    for (const [lin] of candidates) {
      if (next.size >= limit) break;
      if (want.get(lin)!.c < 0) continue;
      const [cx, cy] = spotFor(lin);
      const name = r.civs[lin].name;
      const half = ctx.measureText(name).width / 2 + 4 * dpr;
      const box: [number, number, number, number] = [cx - half, cy - h / 2, cx + half, cy + h / 2];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      next.add(lin);
      nextWorld.set(lin, this.toWorld(cx, cy));
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(5,6,10,0.85)';
      ctx.strokeText(name, cx, cy);
      ctx.fillStyle = `rgb(${lineageRgb(lin).join(',')})`;
      ctx.fillText(name, cx, cy);
    }
    this.labelsShown = next;
    this.labelWorld = nextWorld;
  }

  private drawSelection(ctx: CanvasRenderingContext2D, r: SimResult, frame: Frame, civId: number) {
    const c = r.civs[civId];
    const L = r.universe.boxGly;
    const Lx = boxWidth(r);
    const { x, y } = r.positions;
    const [ox, oy] = this.nearestImage(x[c.node], y[c.node]);
    const dpr = devicePixelRatio || 1;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.save();
    ctx.lineWidth = dpr;
    ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    /** Text kept on screen. */
    const note = (text: string, tx: number, ty: number) => {
      const tw = ctx.measureText(text).width;
      ctx.fillText(text, Math.max(4 * dpr, Math.min(tx, cw - tw - 8 * dpr)), Math.max(20 * dpr, Math.min(ty, ch - 60 * dpr)));
    };
    /** A ring about home, clipped to the box and carried on round its edges. */
    const ring = (radius: number) => {
      ctx.save();
      this.clipToBox(ctx, r);
      ctx.beginPath();
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const cx = ox + i * Lx * this.scale;
          const cy = oy + j * L * this.scale;
          ctx.moveTo(cx + radius, cy);
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        }
      ctx.stroke();
      ctx.restore();
    };
    // What they could see when they first looked up.
    if (frame.t >= c.tTech && this.sight.length) {
      ctx.save();
      this.clipToBox(ctx, r);
      ctx.strokeStyle = 'rgba(255,170,90,0.35)';
      ctx.beginPath();
      for (const { node } of this.sight) {
        const ex = x[c.node] + wrapDelta(x[c.node], x[node], Lx);
        const ey = y[c.node] + wrapDelta(y[c.node], y[node], L);
        for (const [wx, wy] of this.wrapImages(ex, ey, Lx, L)) {
          const [sx, sy] = this.toScreen(x[c.node] + wx, y[c.node] + wy);
          const [tx, ty] = this.toScreen(ex + wx, ey + wy);
          ctx.moveTo(sx, sy);
          ctx.lineTo(tx, ty);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    // How far the news of this species' birth has travelled.
    const front = lightFront(c.tTech, frame.t) * this.scale;
    if (front > 0) {
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ring(front);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      if (front < Math.max(Lx, L) * this.scale) note('light of their first radio', ox + front * 0.71 + 4, oy - front * 0.71);
    }
    // How far their telescopes pick out the faintest heat they can tell from dust.
    if (maturity(c.tierTimes, frame.t) >= 0 && frame.held[civId] > 0) {
      const s = lineageSensor(r.params, c.tTech, c.tierTimes, frame.t);
      const gly = (r.params.detectRange * Math.sqrt(s.gain * s.contrast)) / cosmo.a(frame.t);
      const range = gly * this.scale;
      const [cr, cg, cb] = lineageRgb(civId);
      const pct = `${s.contrast * 100 >= 1 ? (s.contrast * 100).toFixed(0) : (s.contrast * 100).toFixed(1)}%`;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.8)`;
      if (gly < Math.max(Lx, L)) {
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.5)`;
        ring(range);
        note(`sees waste heat ≥ ${pct} of starlight to here`, ox + range * 0.71 + 4, oy + range * 0.71);
      } else note(`sees waste heat ≥ ${pct} of starlight across the whole box`, ox + 14 * dpr, oy + 18 * dpr);
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(16 * dpr)}px ${MONO}`;
    ctx.fillText('◎', ox, oy);
    ctx.restore();
  }
}
