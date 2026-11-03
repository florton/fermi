/**
 * The 3D view: every galaxy group as a soft point, coloured by holder and
 * brightened by waste heat, with strikes as streaks. Good for the shape of
 * things — the cosmic web, territories as volumes, the reach of a war — and
 * deliberately lighter on detail than the map. Drag to orbit, wheel to zoom;
 * it turns slowly on its own while playing.
 */

import type { SimResult } from '../core/sim.ts';
import { inSlice, type Slice } from './map2d.ts';
import { lineageRgb, wrapDelta, type Frame } from './state.ts';

const VS = `#version 300 es
in vec3 a_pos;
in vec4 a_col;
uniform mat4 u_mvp;
uniform float u_size;
uniform float u_maxSize;
out vec4 v_col;
out float v_size;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  // Grows as you approach, but only to a few pixels: these are markers for
  // galaxy groups, not their size, and a big soft sprite just reads as blur.
  v_size = clamp(u_size * (0.5 + 1.5 * a_col.a) / gl_Position.w, 1.0, u_maxSize);
  gl_PointSize = v_size;
  v_col = a_col;
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 v_col;
in float v_size;
uniform bool u_points;
out vec4 o;
void main() {
  float k = 1.0;
  if (u_points) {
    // A solid disc with a one-pixel antialiased rim.
    float r = length(gl_PointCoord - 0.5) * v_size;
    k = clamp(0.5 * v_size - r + 0.5, 0.0, 1.0);
    if (k <= 0.0) discard;
  }
  float a = v_col.a * k;
  o = vec4(v_col.rgb * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** Camera on a sphere around the origin, looking at it. */
function orbit(yaw: number, pitch: number, dist: number): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Rows of the rotation are the camera's right, up and back axes.
  const right = [cy, 0, -sy];
  const up = [-sy * sp, cp, -cy * sp];
  const back = [sy * cp, sp, cy * cp];
  const m = new Float32Array(16);
  for (let i = 0; i < 3; i++) {
    m[i * 4] = right[i];
    m[i * 4 + 1] = up[i];
    m[i * 4 + 2] = back[i];
  }
  m[14] = -dist;
  m[15] = 1;
  return m;
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

export class View3D {
  readonly canvas: HTMLCanvasElement;
  dirty = true;
  spinning = false;

  private gl: WebGL2RenderingContext | null;
  private prog: WebGLProgram | null = null;
  private posBuf: WebGLBuffer | null = null;
  private colBuf: WebGLBuffer | null = null;
  private lineVao: WebGLVertexArrayObject | null = null;
  private pointVao: WebGLVertexArrayObject | null = null;
  private linePos: WebGLBuffer | null = null;
  private lineCol: WebGLBuffer | null = null;
  private colors = new Uint8Array(0);
  private n = 0;
  private r: SimResult | null = null;
  private yaw = 0.6;
  private pitch = 0.35;
  private dist = 1.9;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false });
    if (!this.gl) return;
    const gl = this.gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    this.prog = prog;

    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - drag.x) * 0.006;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
      this.dirty = true;
    });
    canvas.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.dist = Math.max(0.3, Math.min(5, this.dist * Math.exp(e.deltaY * 0.0012)));
        this.dirty = true;
      },
      { passive: false },
    );
  }

  get supported() {
    return this.gl !== null;
  }

  setResult(r: SimResult) {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    this.r = r;
    const { x, y, z } = r.positions;
    const L = r.params.boxGly;
    this.n = x.length;
    const pos = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      pos[i * 3] = x[i] / L - 0.5;
      pos[i * 3 + 1] = -(y[i] / L - 0.5); // y down on the map, up here, so the two views agree from the front
      pos[i * 3 + 2] = z[i] / L - 0.5;
    }
    this.colors = new Uint8Array(this.n * 4);

    const aPos = gl.getAttribLocation(this.prog, 'a_pos');
    const aCol = gl.getAttribLocation(this.prog, 'a_col');
    const vao = (posBuf: WebGLBuffer, colBuf: WebGLBuffer) => {
      const v = gl.createVertexArray()!;
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
      gl.enableVertexAttribArray(aCol);
      gl.vertexAttribPointer(aCol, 4, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.bindVertexArray(null);
      return v;
    };
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    this.colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.DYNAMIC_DRAW);
    this.pointVao = vao(this.posBuf!, this.colBuf!);
    this.linePos = gl.createBuffer();
    this.lineCol = gl.createBuffer();
    this.lineVao = vao(this.linePos!, this.lineCol!);
    this.dirty = true;
  }

  resize() {
    // A hidden canvas measures 0; sizing it then would leave a 1-pixel buffer stretched when shown.
    if (this.canvas.clientWidth === 0) return;
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.dirty = true;
  }

  render(frame: Frame, selected: number, slice: Slice, dt: number) {
    const gl = this.gl;
    const r = this.r;
    if (!gl || !r || !this.prog) return;
    if (this.spinning) this.yaw += dt * 0.08;
    this.dirty = false;

    const { z } = r.positions;
    const L = r.params.boxGly;
    const lineageOf = r.polities.lineage;
    const col = this.colors;
    for (let i = 0; i < this.n; i++) {
      const o = frame.owner[i];
      let rr = 70;
      let gg = 78;
      let bb = 96;
      let a = 0.22;
      if (!inSlice(z[i], L, slice)) a = 0;
      else if (o >= 0) {
        const lin = lineageOf[o];
        // Waste heat shows as brightness of the lineage colour.
        const heat = 0.45 + 0.55 * Math.min(1, Math.sqrt(frame.lum[i]));
        [rr, gg, bb] = lineageRgb(lin).map((v) => v * heat) as [number, number, number];
        a = 0.85;
        if (selected >= 0 && lin !== selected) a *= 0.15;
      }
      col[i * 4] = rr;
      col[i * 4 + 1] = gg;
      col[i * 4 + 2] = bb;
      col[i * 4 + 3] = Math.round(255 * a);
    }

    // Strike streaks, from launcher to head.
    const st = r.strikes;
    const { x, y } = r.positions;
    const lp = new Float32Array(frame.inFlight.length * 6);
    const lc = new Uint8Array(frame.inFlight.length * 8);
    frame.inFlight.forEach(({ s, f }, j) => {
      const a = st.from[s];
      const b = st.to[s];
      const ax = x[a] / L - 0.5;
      const ay = -(y[a] / L - 0.5);
      const az = z[a] / L - 0.5;
      lp.set([ax, ay, az, ax + (f * wrapDelta(x[a], x[b], L)) / L, ay - (f * wrapDelta(y[a], y[b], L)) / L, az + (f * wrapDelta(z[a], z[b], L)) / L], j * 6);
      const [cr, cg, cb] = lineageRgb(st.lineage[s]);
      const alpha = selected >= 0 && st.lineage[s] !== selected ? 40 : 200;
      lc.set([cr, cg, cb, alpha / 4, 255, 255, 255, alpha], j * 8);
    });

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.02, 0.024, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    // Premultiplied "over", not additive: thousands of overlapping points in a
    // settled region summed straight to white. Over-blending keeps the lineage
    // colour however deep the stack, and draw order doesn't matter at this point size.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    const mvp = multiply(perspective(0.9, this.canvas.width / this.canvas.height, 0.05, 20), orbit(this.yaw, this.pitch, this.dist));
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'u_mvp'), false, mvp);
    const dpr = devicePixelRatio || 1;
    gl.uniform1f(gl.getUniformLocation(this.prog, 'u_size'), 4 * dpr);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'u_maxSize'), 6 * dpr);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, col);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'u_points'), 1);
    gl.bindVertexArray(this.pointVao);
    gl.drawArrays(gl.POINTS, 0, this.n);

    if (frame.inFlight.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linePos);
      gl.bufferData(gl.ARRAY_BUFFER, lp, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineCol);
      gl.bufferData(gl.ARRAY_BUFFER, lc, gl.DYNAMIC_DRAW);
      gl.uniform1i(gl.getUniformLocation(this.prog, 'u_points'), 0);
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINES, 0, frame.inFlight.length * 2);
    }
    gl.bindVertexArray(null);
  }
}
