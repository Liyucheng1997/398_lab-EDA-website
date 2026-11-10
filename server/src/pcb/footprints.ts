/**
 * 内置封装库（参数化生成）。尺寸取常见的标称焊盘图形，仅用于原型设计；投板前请对照器件手册核对。
 * 约定（rotation = 0）：y 向下；双列器件 1 脚在左上，逆时针编号。
 */
import type { PcbFootprintDef, PcbPad, PcbRect } from '@webeda/shared';

type Pad = PcbPad;

function smd(num: string | number, x: number, y: number, w: number, h: number): Pad {
  return { num: String(num), x, y, w, h, shape: 'rect' };
}

function tht(num: string | number, x: number, y: number, dia: number, drill: number, square = false): Pad {
  return { num: String(num), x, y, w: dia, h: dia, shape: square ? 'rect' : 'round', drill };
}

function body(w: number, h: number): PcbRect {
  return { x1: -w / 2, y1: -h / 2, x2: w / 2, y2: h / 2 };
}

const CHIP: Record<string, { padW: number; padH: number; cx: number; w: number; h: number }> = {
  '0402': { padW: 0.54, padH: 0.64, cx: 0.51, w: 1.9, h: 1.0 },
  '0603': { padW: 0.8, padH: 0.95, cx: 0.825, w: 2.96, h: 1.46 },
  '0805': { padW: 1.025, padH: 1.4, cx: 0.9125, w: 3.36, h: 1.9 },
  '1206': { padW: 1.125, padH: 1.75, cx: 1.4625, w: 4.56, h: 2.26 },
};

function chip(id: string, description: string): PcbFootprintDef {
  const size = id.replace(/^LED-/, '');
  const d = CHIP[size];
  return {
    id,
    description,
    pads: [smd(1, -d.cx, 0, d.padW, d.padH), smd(2, d.cx, 0, d.padW, d.padH)],
    body: body(d.w, d.h),
  };
}

/** 双列贴片：左列自上而下 1..n/2，右列自下而上 */
function dualSmd(id: string, n: number, pitch: number, padW: number, padH: number, rowX: number, bodyW: number, description: string): PcbFootprintDef {
  const half = n / 2;
  const pads: Pad[] = [];
  for (let i = 0; i < half; i++) pads.push(smd(i + 1, -rowX, (i - (half - 1) / 2) * pitch, padW, padH));
  for (let i = 0; i < half; i++) pads.push(smd(half + i + 1, rowX, ((half - 1) / 2 - i) * pitch, padW, padH));
  return { id, description, pads, body: body(bodyW, half * pitch + 0.4) };
}

/** 四边扁平封装：1 脚在左边最上，逆时针（左↓ 下→ 右↑ 上←） */
function quad(id: string, perSide: number, pitch: number, padL: number, padW: number, rowC: number, bodyW: number, description: string): PcbFootprintDef {
  const pads: Pad[] = [];
  const off = (i: number) => (i - (perSide - 1) / 2) * pitch;
  let n = 1;
  for (let i = 0; i < perSide; i++) pads.push(smd(n++, -rowC, off(i), padL, padW));
  for (let i = 0; i < perSide; i++) pads.push(smd(n++, off(i), rowC, padW, padL));
  for (let i = 0; i < perSide; i++) pads.push(smd(n++, rowC, -off(i), padL, padW));
  for (let i = 0; i < perSide; i++) pads.push(smd(n++, -off(i), -rowC, padW, padL));
  return { id, description, pads, body: body(bodyW, bodyW) };
}

function dip(n: number): PcbFootprintDef {
  const half = n / 2;
  const rowX = n >= 32 ? 7.62 : 3.81;
  const pads: Pad[] = [];
  for (let i = 0; i < half; i++) pads.push(tht(i + 1, -rowX, (i - (half - 1) / 2) * 2.54, 1.6, 0.8, i === 0));
  for (let i = 0; i < half; i++) pads.push(tht(half + i + 1, rowX, ((half - 1) / 2 - i) * 2.54, 1.6, 0.8));
  return { id: `DIP-${n}`, description: `DIP-${n} 直插，2.54 mm 间距，行距 ${rowX * 2} mm`, pads, body: body(rowX * 2 + 2.6, half * 2.54 + 0.6) };
}

/** 排针：rows 列 × n 行，竖直排列，1 脚在左上；双排时奇数脚在左列 */
function header(rows: number, n: number): PcbFootprintDef {
  const pads: Pad[] = [];
  let num = 1;
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < rows; r++) {
      pads.push(tht(num, (r - (rows - 1) / 2) * 2.54, (i - (n - 1) / 2) * 2.54, 1.7, 1.0, num === 1));
      num++;
    }
  }
  return { id: `HDR-${rows}x${n}`, description: `${rows}×${n} 排针，2.54 mm 间距`, pads, body: body(rows * 2.54 + 0.5, n * 2.54 + 0.5) };
}

function electrolytic(id: string, pitch: number, dia: number): PcbFootprintDef {
  return {
    id,
    description: `直插电解电容 Ø${dia} mm，脚距 ${pitch} mm；1 = 正极`,
    pads: [tht(1, -pitch / 2, 0, 1.6, 0.8, true), tht(2, pitch / 2, 0, 1.6, 0.8)],
    body: body(dia + 0.5, dia + 0.5),
  };
}

function terminal(n: number): PcbFootprintDef {
  const pads: Pad[] = [];
  for (let i = 0; i < n; i++) pads.push(tht(i + 1, (i - (n - 1) / 2) * 5.08, 0, 2.6, 1.3, i === 0));
  return { id: `TERM-${n}`, description: `${n} 位螺钉接线端子，5.08 mm 间距，水平排列，1 脚在左`, pads, body: body(n * 5.08 + 0.6, 8.6) };
}

const FIXED: Record<string, () => PcbFootprintDef> = {
  '0402': () => chip('0402', '0402 贴片阻容'),
  '0603': () => chip('0603', '0603 贴片阻容'),
  '0805': () => chip('0805', '0805 贴片阻容'),
  '1206': () => chip('1206', '1206 贴片阻容'),
  'LED-0603': () => chip('LED-0603', '0603 贴片 LED；1 = 阴极 K，2 = 阳极 A'),
  'LED-0805': () => chip('LED-0805', '0805 贴片 LED；1 = 阴极 K，2 = 阳极 A'),
  'SOD-123': () => ({
    id: 'SOD-123',
    description: 'SOD-123 贴片二极管；1 = 阴极 K，2 = 阳极 A',
    pads: [smd(1, -1.65, 0, 0.9, 1.2), smd(2, 1.65, 0, 0.9, 1.2)],
    body: body(4.7, 2.3),
  }),
  'SOT-23': () => ({
    id: 'SOT-23',
    description: 'SOT-23 三脚；1、2 在左（上、下），3 在右中',
    pads: [smd(1, -0.9375, -0.95, 1.325, 0.6), smd(2, -0.9375, 0.95, 1.325, 0.6), smd(3, 0.9375, 0, 1.325, 0.6)],
    body: body(3.84, 3.3),
  }),
  'SOT-23-5': () => ({
    id: 'SOT-23-5',
    description: 'SOT-23-5；左列自上而下 1、2、3，右列 4（下）、5（上）',
    pads: [
      smd(1, -1.1375, -0.95, 1.325, 0.6),
      smd(2, -1.1375, 0, 1.325, 0.6),
      smd(3, -1.1375, 0.95, 1.325, 0.6),
      smd(4, 1.1375, 0.95, 1.325, 0.6),
      smd(5, 1.1375, -0.95, 1.325, 0.6),
    ],
    body: body(4.1, 3.3),
  }),
  'SOT-23-6': () => ({
    id: 'SOT-23-6',
    description: 'SOT-23-6；左列自上而下 1、2、3，右列自下而上 4、5、6',
    pads: [
      smd(1, -1.1375, -0.95, 1.325, 0.6),
      smd(2, -1.1375, 0, 1.325, 0.6),
      smd(3, -1.1375, 0.95, 1.325, 0.6),
      smd(4, 1.1375, 0.95, 1.325, 0.6),
      smd(5, 1.1375, 0, 1.325, 0.6),
      smd(6, 1.1375, -0.95, 1.325, 0.6),
    ],
    body: body(4.1, 3.3),
  }),
  'SOT-223': () => ({
    id: 'SOT-223',
    description: 'SOT-223；左列自上而下 1、2、3，右侧大焊盘 4（散热片，通常与 2 脚同网络）',
    pads: [smd(1, -3.15, -2.3, 2.0, 1.5), smd(2, -3.15, 0, 2.0, 1.5), smd(3, -3.15, 2.3, 2.0, 1.5), smd(4, 3.15, 0, 2.0, 3.8)],
    body: body(8.8, 7.0),
  }),
  'TQFP-32': () => quad('TQFP-32', 8, 0.8, 1.475, 0.55, 4.1625, 9.8, 'TQFP-32，7×7 mm，0.8 mm 间距'),
  'TQFP-44': () => quad('TQFP-44', 11, 0.8, 1.475, 0.55, 5.6625, 12.8, 'TQFP-44，10×10 mm，0.8 mm 间距'),
  'CP-D5': () => electrolytic('CP-D5', 2.0, 5),
  'CP-D6.3': () => electrolytic('CP-D6.3', 2.5, 6.3),
  'CP-D8': () => electrolytic('CP-D8', 3.5, 8),
  'XTAL-HC49': () => ({
    id: 'XTAL-HC49',
    description: 'HC-49 直插晶振，脚距 4.88 mm',
    pads: [tht(1, -2.44, 0, 1.5, 0.8), tht(2, 2.44, 0, 1.5, 0.8)],
    body: body(11.5, 5.0),
  }),
  'SW-TACT-6MM': () => ({
    id: 'SW-TACT-6MM',
    description: '6×6 mm 直插轻触开关；1、2 在上（左、右）且内部相连，3、4 在下且内部相连，按下时上下导通',
    pads: [tht(1, -3.25, -2.25, 1.8, 1.0), tht(2, 3.25, -2.25, 1.8, 1.0), tht(3, -3.25, 2.25, 1.8, 1.0), tht(4, 3.25, 2.25, 1.8, 1.0)],
    body: body(9.0, 7.0),
  }),
  'LED-5MM': () => ({
    id: 'LED-5MM',
    description: '5 mm 直插 LED；1 = 阴极 K，2 = 阳极 A',
    pads: [tht(1, -1.27, 0, 1.8, 0.9, true), tht(2, 1.27, 0, 1.8, 0.9)],
    body: body(6.2, 6.2),
  }),
  'TO-220': () => ({
    id: 'TO-220',
    description: 'TO-220 立式，三脚水平排列，1 脚在左，2.54 mm 间距',
    pads: [tht(1, -2.54, 0, 1.8, 1.0, true), tht(2, 0, 0, 1.8, 1.0), tht(3, 2.54, 0, 1.8, 1.0)],
    body: body(10.6, 5.0),
  }),
};

/** 写进系统提示的封装目录 */
export const FOOTPRINT_CATALOG = `Chip passives (pads 1 = left, 2 = right): 0402, 0603, 0805, 1206
LEDs / diodes (1 = cathode K, 2 = anode A): LED-0603, LED-0805, SOD-123, LED-5MM (through-hole)
Small-signal packages: SOT-23 (1, 2 on the left top/bottom, 3 on the right), SOT-23-5, SOT-23-6, SOT-223 (1-3 left, 4 = tab on the right)
Dual-row ICs, pin 1 top-left, counter-clockwise (left column top to bottom, then right column bottom to top):
  SOIC-N (N = 8, 14, 16; 1.27 mm pitch), TSSOP-N (N = 8, 14, 16, 20; 0.65 mm pitch),
  DIP-N (even N from 4 to 40; 2.54 mm pitch; rows 7.62 mm apart up to DIP-28, 15.24 mm from DIP-32)
Quad flat packs, pin 1 at the top of the left side, counter-clockwise: TQFP-32, TQFP-44 (0.8 mm pitch)
Pin headers, 2.54 mm pitch, vertical column with pin 1 at the top: HDR-1xN (N = 1..40); HDR-2xN (odd pins in the left column, even pins in the right)
Screw terminals, 5.08 mm pitch, horizontal row with pin 1 on the left: TERM-N (N = 2..8)
Through-hole parts: CP-D5, CP-D6.3, CP-D8 (radial electrolytic, 1 = positive), XTAL-HC49, TO-220 (pin 1 left),
  SW-TACT-6MM (1, 2 on top and internally joined; 3, 4 on the bottom and internally joined)`;

/** 按 id 取封装；找不到返回 null。custom 是设计里自定义的封装 */
export function getFootprint(id: string, custom: PcbFootprintDef[] = []): PcbFootprintDef | null {
  const own = custom.find((f) => f.id === id);
  if (own) return own;
  if (FIXED[id]) return FIXED[id]();
  let m = /^SOIC-(8|14|16)$/.exec(id);
  if (m) return dualSmd(id, Number(m[1]), 1.27, 1.95, 0.6, 2.475, 7.4, `${id}，1.27 mm 间距`);
  m = /^TSSOP-(8|14|16|20)$/.exec(id);
  if (m) return dualSmd(id, Number(m[1]), 0.65, 1.475, 0.4, 2.8625, 7.7, `${id}，0.65 mm 间距`);
  m = /^DIP-(\d+)$/.exec(id);
  if (m) {
    const n = Number(m[1]);
    if (n >= 4 && n <= 40 && n % 2 === 0) return dip(n);
  }
  m = /^HDR-([12])x(\d+)$/.exec(id);
  if (m) {
    const n = Number(m[2]);
    if (n >= 1 && n <= 40) return header(Number(m[1]), n);
  }
  m = /^TERM-(\d)$/.exec(id);
  if (m) {
    const n = Number(m[1]);
    if (n >= 2 && n <= 8) return terminal(n);
  }
  return null;
}
