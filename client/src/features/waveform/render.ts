// Canvas 2D 绘制：时间标尺与波形行。纯函数，状态全部由调用方传入。

import { cssVar } from '../../lib/theme';
import type { Radix } from './format';
import { tickLabel, type Ticks } from './ticks';
import { BIT_X, BIT_Z, type Wave } from './vcd';
import { analogOf, scanSegments, upperBound, valueStateAt, valueText } from './waves';

export interface Palette {
  panel: string;
  text: string;
  text2: string;
  text3: string;
  text4: string;
  line: string;
  lineStrong: string;
  primary: string;
  primarySoft: string;
  danger: string;
  warning: string;
  fill: string;
  ink: string;
  inkText: string;
  mono: string;
  font: string;
}

/** 从 CSS 变量读取调色板（主题切换后需重新读取） */
export function readPalette(el?: Element): Palette {
  const v = (name: string, fallback: string) => (el ? cssVar(name, el) : cssVar(name)) || fallback;
  return {
    panel: v('--panel', '#ffffff'),
    text: v('--text', '#1d1d1f'),
    text2: v('--text-2', '#6e6e73'),
    text3: v('--text-3', '#86868b'),
    text4: v('--text-4', '#aeaeb2'),
    line: v('--line', 'rgba(0,0,0,.08)'),
    lineStrong: v('--line-strong', '#d2d2d7'),
    primary: v('--primary', '#0071e3'),
    primarySoft: v('--primary-soft', '#e8f2fd'),
    danger: v('--danger', '#d70015'),
    warning: v('--warning', '#c93400'),
    fill: v('--fill', '#e8e8ed'),
    ink: v('--ink', '#1d1d1f'),
    inkText: v('--ink-text', '#ffffff'),
    mono: v('--mono', 'ui-monospace, Menlo, Consolas, monospace'),
    font: v('--font', 'system-ui, sans-serif'),
  };
}

export type RowMode = 'bit' | 'bus' | 'analog' | 'event';

export interface RenderRow {
  key: string;
  /** 内容坐标中的顶部 y */
  top: number;
  height: number;
  wave: Wave;
  mode: RowMode;
  radix: Radix;
  selected: boolean;
}

export interface View {
  /** 画布 x = 0 对应的时间 */
  start: number;
  /** 像素 / 时间单位 */
  scale: number;
}

export interface WaveDrawState {
  width: number;
  height: number;
  scrollTop: number;
  rows: RenderRow[];
  view: View;
  endTime: number;
  ticks: Ticks;
  cursor: number | null;
  marker: number | null;
  palette: Palette;
  /** 等宽字体单字符宽度 */
  charW: number;
}

const FONT_SIZE = 12;
const CLAMP_PAD = 16;

function clampX(x: number, w: number): number {
  return x < -CLAMP_PAD ? -CLAMP_PAD : x > w + CLAMP_PAD ? w + CLAMP_PAD : x;
}

/** 文本按可用宽度截断（等宽字体） */
export function fitText(text: string, avail: number, charW: number): string {
  if (charW <= 0) return text;
  const max = Math.floor(avail / charW);
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max === 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}

export function measureCharWidth(ctx: CanvasRenderingContext2D, mono: string): number {
  ctx.font = `${FONT_SIZE}px ${mono}`;
  const w = ctx.measureText('0000000000').width / 10;
  return w > 0 ? w : 7.2;
}

// ---------------------------------------------------------------------------
// 波形区

export function drawWaves(ctx: CanvasRenderingContext2D, s: WaveDrawState): void {
  const { width: W, height: H, palette: pal, view } = s;
  ctx.save();
  ctx.fillStyle = pal.panel;
  ctx.fillRect(0, 0, W, H);

  // 选中行背景与行分隔线
  for (const r of s.rows) {
    const y = r.top - s.scrollTop;
    if (y > H || y + r.height < 0) continue;
    if (r.selected) {
      ctx.fillStyle = pal.primarySoft;
      ctx.fillRect(0, y, W, r.height);
    }
  }
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const r of s.rows) {
    const y = Math.round(r.top + r.height - s.scrollTop) - 0.5;
    if (y < 0 || y > H) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();

  // 主刻度网格
  ctx.beginPath();
  for (const t of s.ticks.majors) {
    const x = Math.round((t - view.start) * view.scale) + 0.5;
    if (x < 0 || x > W) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  ctx.strokeStyle = pal.line;
  ctx.stroke();

  // 光标与标记之间的区间
  if (s.cursor !== null && s.marker !== null) {
    const a = clampX((Math.min(s.cursor, s.marker) - view.start) * view.scale, W);
    const b = clampX((Math.max(s.cursor, s.marker) - view.start) * view.scale, W);
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = pal.primary;
    ctx.fillRect(a, 0, b - a, H);
    ctx.globalAlpha = 1;
  }

  ctx.font = `${FONT_SIZE}px ${pal.mono}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const r of s.rows) {
    const y = r.top - s.scrollTop;
    if (y > H || y + r.height < 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, W, r.height);
    ctx.clip();
    switch (r.mode) {
      case 'bit':
        drawBitRow(ctx, r, y, s);
        break;
      case 'bus':
        drawBusRow(ctx, r, y, s);
        break;
      case 'analog':
        drawAnalogRow(ctx, r, y, s);
        break;
      case 'event':
        drawEventRow(ctx, r, y, s);
        break;
    }
    ctx.restore();
  }

  // 标记与光标
  if (s.marker !== null) {
    const x = Math.round((s.marker - view.start) * view.scale) + 0.5;
    if (x >= -1 && x <= W + 1) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = pal.text3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (s.cursor !== null) {
    const x = Math.round((s.cursor - view.start) * view.scale) + 0.5;
    if (x >= -1 && x <= W + 1) {
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function rowBounds(y: number, h: number) {
  const pad = h > 40 ? 8 : 5;
  const top = Math.round(y + pad) + 0.5;
  const bot = Math.round(y + h - pad) - 0.5;
  return { top, bot, mid: (top + bot) / 2 };
}

function drawBitRow(ctx: CanvasRenderingContext2D, r: RenderRow, y: number, s: WaveDrawState) {
  const { width: W, view, palette: pal } = s;
  const wave = r.wave;
  const bits = wave.bits;
  if (!bits || wave.times.length === 0) return;
  const { top, bot, mid } = rowBounds(y, r.height);
  const trace = new Path2D();
  const xPath = new Path2D();
  const zPath = new Path2D();
  const hiFill = new Path2D();
  const xFill = new Path2D();
  const dense = new Path2D();
  let prev = -1;
  const levelY = (v: number) => (v === 1 ? top : v === 0 ? bot : mid);
  scanSegments(wave.times, view.start, view.scale, W, s.endTime, {
    seg(i, x0, x1) {
      const a = clampX(x0, W);
      const b = clampX(x1, W);
      const v = bits[i];
      if (prev >= 0 && x0 >= -CLAMP_PAD && prev !== v) {
        const ex = Math.round(a) + 0.5;
        if (v === BIT_X || prev === BIT_X) {
          const p = v === BIT_X ? xPath : v === BIT_Z ? zPath : trace;
          p.moveTo(ex, top);
          p.lineTo(ex, bot);
        } else {
          const p = v === BIT_Z ? zPath : trace;
          p.moveTo(ex, levelY(prev));
          p.lineTo(ex, levelY(v));
        }
      }
      const sa = x0 >= -CLAMP_PAD ? Math.round(a) + 0.5 : a;
      if (v === 0) {
        trace.moveTo(sa, bot);
        trace.lineTo(b, bot);
      } else if (v === 1) {
        trace.moveTo(sa, top);
        trace.lineTo(b, top);
        hiFill.rect(sa, top, b - sa, bot - top);
      } else if (v === BIT_X) {
        xFill.rect(sa, top, b - sa, bot - top);
        xPath.moveTo(sa, top);
        xPath.lineTo(b, top);
        xPath.moveTo(sa, bot);
        xPath.lineTo(b, bot);
      } else {
        zPath.moveTo(sa, mid);
        zPath.lineTo(b, mid);
      }
      prev = v;
    },
    dense(x0, x1, _from, to) {
      const a = clampX(x0, W);
      const b = clampX(x1, W);
      dense.rect(a, top, Math.max(1, b - a), bot - top);
      prev = bits[to];
    },
  });
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = pal.primary;
  ctx.fill(hiFill);
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = pal.danger;
  ctx.fill(xFill);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = pal.primary;
  ctx.fill(dense);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pal.primary;
  ctx.stroke(trace);
  ctx.strokeStyle = pal.danger;
  ctx.stroke(xPath);
  ctx.strokeStyle = pal.warning;
  ctx.stroke(zPath);
}

const ALL_Z = /^z+$/;

function drawBusRow(ctx: CanvasRenderingContext2D, r: RenderRow, y: number, s: WaveDrawState) {
  const { width: W, view, palette: pal, charW } = s;
  const wave = r.wave;
  if (wave.times.length === 0) return;
  const { top, bot, mid } = rowBounds(y, r.height);
  const okPath = new Path2D();
  const xPath = new Path2D();
  const zPath = new Path2D();
  const xFill = new Path2D();
  const dense = new Path2D();
  const texts: { x: number; text: string; color: string }[] = [];
  const hex = (p: Path2D, a: number, b: number, sl: number) => {
    p.moveTo(a, mid);
    p.lineTo(a + sl, top);
    p.lineTo(b - sl, top);
    p.lineTo(b, mid);
    p.lineTo(b - sl, bot);
    p.lineTo(a + sl, bot);
    p.closePath();
  };
  scanSegments(wave.times, view.start, view.scale, W, s.endTime, {
    seg(i, x0, x1) {
      const a = x0 < -CLAMP_PAD ? -CLAMP_PAD * 2 : Math.round(x0) + 0.5;
      const b = x1 > W + CLAMP_PAD ? W + CLAMP_PAD * 2 : Math.round(x1) + 0.5;
      const w = b - a;
      if (w <= 0) return;
      const sl = Math.min(3, w / 2);
      const st = valueStateAt(wave, i);
      if (wave.kind === 'vec' && st === 'z' && ALL_Z.test(wave.vecs![i])) {
        zPath.moveTo(a, top);
        zPath.lineTo(a, bot);
        zPath.moveTo(a, mid);
        zPath.lineTo(b, mid);
      } else if (st === 'x') {
        hex(xPath, a, b, sl);
        hex(xFill, a, b, sl);
      } else if (st === 'z') {
        hex(zPath, a, b, sl);
      } else {
        hex(okPath, a, b, sl);
      }
      const va = Math.max(a + sl + 3, 3);
      const vb = Math.min(b - sl - 3, W - 3);
      const avail = vb - va;
      if (avail >= charW) {
        const text = fitText(valueText(wave, i, r.radix), avail, charW);
        if (text) texts.push({ x: (va + vb) / 2, text, color: st === 'x' ? pal.danger : st === 'z' ? pal.warning : pal.text });
      }
    },
    dense(x0, x1) {
      const a = clampX(x0, W);
      const b = clampX(x1, W);
      dense.rect(a, top, Math.max(1, b - a), bot - top);
    },
  });
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = pal.danger;
  ctx.fill(xFill);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = pal.primary;
  ctx.fill(dense);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = pal.primary;
  ctx.stroke(okPath);
  ctx.strokeStyle = pal.danger;
  ctx.stroke(xPath);
  ctx.strokeStyle = pal.warning;
  ctx.stroke(zPath);
  for (const t of texts) {
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, mid + 0.5);
  }
}

function drawAnalogRow(ctx: CanvasRenderingContext2D, r: RenderRow, y: number, s: WaveDrawState) {
  const { width: W, view, palette: pal } = s;
  const wave = r.wave;
  if (wave.times.length === 0) return;
  const { top, bot } = rowBounds(y, r.height);
  const an = analogOf(wave, r.radix === 'sdec');
  let lo = an.min;
  let hi = an.max;
  if (hi - lo <= 0) {
    const d = Math.abs(hi) > 0 ? Math.abs(hi) * 0.1 : 1;
    lo -= d;
    hi += d;
  }
  const yOf = (v: number) => bot - ((v - lo) / (hi - lo)) * (bot - top);
  const vals = an.values;
  const line = new Path2D();
  const xFill = new Path2D();
  const dense = new Path2D();
  let pen = false;
  scanSegments(wave.times, view.start, view.scale, W, s.endTime, {
    seg(i, x0, x1) {
      const a = clampX(x0, W);
      const b = clampX(x1, W);
      const v = vals[i];
      if (!Number.isFinite(v)) {
        xFill.rect(a, top, Math.max(0, b - a), bot - top);
        pen = false;
        return;
      }
      const yy = yOf(v);
      if (pen) line.lineTo(a, yy);
      else line.moveTo(a, yy);
      line.lineTo(b, yy);
      pen = true;
    },
    dense(x0, x1, from, to) {
      // 过密区域逐像素列画出 min..max 包络，保留波形形状
      const times = wave.times;
      const a = Math.max(Math.floor(clampX(x0, W)), -1);
      const b = Math.min(Math.ceil(clampX(x1, W)), W + 1);
      let k = from;
      for (let px = a; px < b && k <= to; px++) {
        const tEnd = view.start + (px + 1) / view.scale;
        const j = px + 1 >= b ? to + 1 : Math.min(to + 1, upperBound(times, tEnd, k));
        if (j <= k) continue;
        let mn = Infinity;
        let mx = -Infinity;
        for (let q = k; q < j; q++) {
          const v = vals[q];
          if (!Number.isFinite(v)) continue;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        if (mn === Infinity) xFill.rect(px, top, 1, bot - top);
        else dense.rect(px, yOf(mx) - 0.75, 1, Math.max(1.5, yOf(mn) - yOf(mx) + 1.5));
        k = j;
      }
      const last = vals[to];
      if (Number.isFinite(last)) {
        line.moveTo(b, yOf(last));
        pen = true;
      } else pen = false;
    },
  });
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = pal.danger;
  ctx.fill(xFill);
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.primary;
  ctx.fill(dense);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pal.primary;
  ctx.stroke(line);
  if (r.height >= 40) {
    ctx.save();
    ctx.font = `10px ${pal.mono}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.text3;
    const fmt = (v: number) => (Number.isInteger(v) ? String(v) : Number(v.toPrecision(5)).toString());
    ctx.textBaseline = 'top';
    ctx.fillText(fmt(an.max), 4, top - 6 > y ? top - 6 : top);
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmt(an.min), 4, bot + 6);
    ctx.restore();
  }
}

function drawEventRow(ctx: CanvasRenderingContext2D, r: RenderRow, y: number, s: WaveDrawState) {
  const { width: W, view, palette: pal } = s;
  const wave = r.wave;
  if (wave.times.length === 0) return;
  const { top, bot } = rowBounds(y, r.height);
  const p = new Path2D();
  const heads = new Path2D();
  const draw = (x: number) => {
    const ex = Math.round(x) + 0.5;
    p.moveTo(ex, bot);
    p.lineTo(ex, top + 1);
    heads.moveTo(ex - 3.5, top + 5);
    heads.lineTo(ex, top);
    heads.lineTo(ex + 3.5, top + 5);
    heads.closePath();
  };
  scanSegments(wave.times, view.start, view.scale, W, s.endTime, {
    seg(_i, x0) {
      if (x0 >= -CLAMP_PAD && x0 <= W + CLAMP_PAD) draw(x0);
    },
    dense(x0, x1) {
      const a = clampX(x0, W);
      const b = clampX(x1, W);
      p.rect(a, top, Math.max(1, b - a), bot - top);
    },
  }, 3);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = pal.primary;
  ctx.stroke(p);
  ctx.fillStyle = pal.primary;
  ctx.fill(heads);
}

// ---------------------------------------------------------------------------
// 标尺

export interface RulerDrawState {
  width: number;
  height: number;
  view: View;
  ticks: Ticks;
  fsUnit: number;
  cursor: number | null;
  marker: number | null;
  cursorLabel: string | null;
  markerLabel: string | null;
  /** 拖动选择的缩放范围（时间） */
  selection: [number, number] | null;
  palette: Palette;
}

export function drawRuler(ctx: CanvasRenderingContext2D, s: RulerDrawState): void {
  const { width: W, height: H, view, ticks, palette: pal } = s;
  ctx.save();
  ctx.fillStyle = pal.panel;
  ctx.fillRect(0, 0, W, H);
  const xOf = (t: number) => (t - view.start) * view.scale;

  if (s.selection) {
    const a = clampX(xOf(Math.min(s.selection[0], s.selection[1])), W);
    const b = clampX(xOf(Math.max(s.selection[0], s.selection[1])), W);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = pal.primary;
    ctx.fillRect(a, 0, b - a, H);
    ctx.globalAlpha = 1;
  }

  // 次刻度
  ctx.strokeStyle = pal.lineStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const minorPx = ticks.minor * view.scale;
  if (minorPx >= 4) {
    const k0 = Math.ceil(view.start / ticks.minor);
    const k1 = Math.floor((view.start + W / view.scale) / ticks.minor);
    for (let k = k0; k <= k1 && k - k0 < 4000; k++) {
      const x = Math.round(xOf(k * ticks.minor)) + 0.5;
      ctx.moveTo(x, H - 4);
      ctx.lineTo(x, H);
    }
  }
  ctx.stroke();
  // 主刻度 + 标签
  ctx.strokeStyle = pal.text4;
  ctx.beginPath();
  ctx.font = `11px ${pal.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.text3;
  for (const t of ticks.majors) {
    const x = Math.round(xOf(t)) + 0.5;
    ctx.moveTo(x, H - 9);
    ctx.lineTo(x, H);
    const label = tickLabel(t, ticks, s.fsUnit);
    // 放不下的标签（贴近右边缘）不画，避免被截成半个
    if (x + 4 + ctx.measureText(label).width <= W) ctx.fillText(label, x + 4, H / 2 - 3);
  }
  ctx.stroke();
  // 底线
  ctx.strokeStyle = pal.line;
  ctx.beginPath();
  ctx.moveTo(0, H - 0.5);
  ctx.lineTo(W, H - 0.5);
  ctx.stroke();

  const pill = (t: number, label: string, bg: string, fg: string) => {
    const x = xOf(t);
    if (x < -1 || x > W + 1) return;
    ctx.font = `600 11px ${pal.font}`;
    const tw = ctx.measureText(label).width + 12;
    const ph = 18;
    let px = x - tw / 2;
    px = Math.max(1, Math.min(W - tw - 1, px));
    const py = (H - ph) / 2 - 1;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(px, py, tw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.fillText(label, px + tw / 2, py + ph / 2 + 0.5);
    ctx.strokeStyle = bg;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, py + ph);
    ctx.lineTo(Math.round(x) + 0.5, H);
    ctx.stroke();
  };
  if (s.marker !== null && s.markerLabel) pill(s.marker, s.markerLabel, pal.fill, pal.text);
  if (s.cursor !== null && s.cursorLabel) pill(s.cursor, s.cursorLabel, pal.ink, pal.inkText);
  ctx.restore();
}
