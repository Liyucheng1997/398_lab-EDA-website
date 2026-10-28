/**
 * 按顶层端口名把设计连接到虚拟开发板外设（约定见 shared/src/devices.ts 的注释）。
 * 纯函数：Worker 与 UI 用同一份映射，保证下标一致。
 */
import type { BoardInfo, GateNetlist, GatePort } from '@webeda/shared';

/** 某个端口的某一位 */
export interface BitRef {
  port: number;
  bit: number;
  net: number;
  /** 在「所有端口位」扁平数组中的下标（快照的 values/duty 用这个下标） */
  index: number;
  /** 显示名，如 sw[3] 或 btn_n */
  name: string;
}

export type InputKind = 'clock' | 'reset' | 'switch' | 'button' | 'uart_rx' | 'generic';

export interface InputCtl {
  kind: InputKind;
  ref: BitRef;
  /** 低电平有效（按键按下 = 0 / 复位按下 = 0） */
  activeLow: boolean;
  /** 板上标签，如 "SW3"、"BTN0"、"C"、"RST" */
  label: string;
  /** 键盘快捷键（单个字符，小写） */
  key?: string;
  /** 释放/默认状态下的电平 */
  idle: 0 | 1;
}

export type LedColor = 'green' | 'red' | 'blue' | 'yellow';

export interface LedCtl {
  ref: BitRef;
  activeLow: boolean;
  color: LedColor;
  label: string;
}

export interface RgbCtl {
  r: BitRef | null;
  g: BitRef | null;
  b: BitRef | null;
  activeLow: boolean;
  label: string;
}

/** 多路复用的数码管组：一组段选 + 若干位选 */
export interface SegMux {
  /** 段 a..g, dp（下标 0..7），缺失的段为 null */
  segs: (BitRef | null)[];
  /** 位选，digits[0] 显示在最右侧 */
  digits: BitRef[];
  segActiveLow: boolean;
  anActiveLow: boolean;
  segName: string;
  anName: string | null;
}

/** 静态数码管（每个端口直接驱动一位，如 hex0[6:0]） */
export interface SegStatic {
  segs: (BitRef | null)[];
  activeLow: boolean;
  label: string;
}

export interface OutputCtl {
  ref: BitRef;
  label: string;
}

export interface BoardMap {
  ports: GatePort[];
  /** port 下标 → 第 0 位在扁平数组中的下标 */
  portOffset: number[];
  totalBits: number;
  /** 所有端口位（扁平，按端口顺序、每个端口 LSB→MSB） */
  bits: BitRef[];
  /** 由仿真循环驱动的时钟输入 */
  clocks: BitRef[];
  /** 主时钟端口名（显示用） */
  clockName: string | null;
  inputs: InputCtl[];
  switches: InputCtl[];
  buttons: InputCtl[];
  resets: InputCtl[];
  genericInputs: InputCtl[];
  uartRx: InputCtl | null;
  uartTx: BitRef | null;
  leds: LedCtl[];
  rgbs: RgbCtl[];
  segMux: SegMux | null;
  segStatics: SegStatic[];
  genericOutputs: OutputCtl[];
  /** 端口下标 → 外设说明（逻辑探针显示） */
  portRole: string[];
}

interface NameInfo {
  /** 归一化后的基础名（去掉 i_/o_ 前缀、_i/_o 后缀、_n 低有效后缀） */
  base: string;
  activeLow: boolean;
}

/** 归一化端口名 */
export function analyzeName(raw: string): NameInfo {
  let n = raw.toLowerCase().replace(/^\\/, '').trim();
  n = n.replace(/^(i|o|io|in|out)_/, '');
  n = n.replace(/_(i|o|io|in|out|pad|pin)$/, '');
  let activeLow = false;
  if (/_n$/.test(n) && n.length > 2) {
    activeLow = true;
    n = n.slice(0, -2);
  } else if (/^n_/.test(n)) {
    activeLow = true;
    n = n.slice(2);
  }
  return { base: n, activeLow };
}

const CLOCK_RE = /^(clk|clock|clk_?\d+(m|mhz|k|khz)?|clk_?\d*m(hz)?|sys_?clk|clk_?sys|sysclk|osc|osc_?clk|clk_?in|mclk|clki|clko?|clk_?ref|ref_?clk|clk_?main|main_?clk|clk100mhz)$/;
const RESET_RE = /^(rst|reset|rstn|resetn|nrst|nreset|areset|arst|sys_?rst|rst_?sys|ext_?rst|rst_?ext|cpu_?reset|rst_?btn|reset_?btn)$/;
const SWITCH_RE = /^(sw|sws|switch|switches|dip|dip_?sw|dipsw|slide_?sw|sw\d+|switch\d+)$/;
const BUTTON_RE = /^(btn|btns|button|buttons|key|keys|pb|pbs|push|push_?btn|user_?btn|btn\d+|key\d+|button\d+|btn_?[a-z]|btn[a-z]|btn_?(up|down|left|right|center|centre|ok|mid))$/;
const RX_RE = /^(rx|rxd|uart_?rx|uart_?rxd|serial_?rx|ser_?rx|ftdi_?rx|usb_?rx|rs232_?rx|rs_?rx)$/;
const TX_RE = /^(tx|txd|uart_?tx|uart_?txd|serial_?tx|ser_?tx|ftdi_?tx|usb_?tx|rs232_?tx|rs_?tx)$/;
const SEG_RE = /^(seg|segs|seg_?out|sseg|seven_?seg|segment|segments|seg_?led|led_?seg|cathode|cathodes|hex)$/;
const SEG_STATIC_RE = /^(hex|seg|sseg|digit)_?(\d+)$/;
const AN_RE = /^(an|ano|anode|anodes|dig|digit|digits|digit_?sel|dig_?sel|seg_?sel|sel|com|seg_?an|an_?out|seg_?com)$/;
const DP_RE = /^(dp|seg_?dp|dot|decimal_?point)$/;
const RGB_PORT_RE = /^(rgb|rgb_?led|led_?rgb|rgb\d+)$/;
const RGB_CH_RE = /^(.*?)_?(r|g|b|red|green|blue)$/;
const LED_RE = /^(led|leds|ledr|ledg|user_?led|user_?leds|status_?led|led\d+|led_.*|.*_led|.*_leds)$/;

const SWITCH_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const BUTTON_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
const RESET_KEY = 'z';

function channelOf(s: string): 'r' | 'g' | 'b' {
  return s[0] as 'r' | 'g' | 'b';
}

function ledColorOf(base: string): LedColor {
  if (/(^|_)(r|red)$/.test(base) || /^ledr/.test(base) || /(^|_)(r|red)(\d+)?$/.test(base)) return 'red';
  if (/(^|_)(b|blue)$/.test(base)) return 'blue';
  if (/(^|_)(y|yellow|amber|orange)$/.test(base)) return 'yellow';
  return 'green';
}

function bitName(p: GatePort, bit: number): string {
  return p.bits.length === 1 ? p.name : `${p.name}[${bit}]`;
}

/** 7 段/8 段的默认极性：hex 端口（DE 系列板卡）默认低有效 */
function segDefaultLow(base: string, activeLow: boolean): boolean {
  return activeLow || /^hex/.test(base);
}

/** 从端口表推断外设映射 */
export function mapBoard(netlist: Pick<GateNetlist, 'ports'>, board?: BoardInfo): BoardMap {
  const ports = netlist.ports;
  const portOffset: number[] = [];
  const bits: BitRef[] = [];
  ports.forEach((p, pi) => {
    portOffset.push(bits.length);
    p.bits.forEach((net, b) => bits.push({ port: pi, bit: b, net, index: bits.length, name: bitName(p, b) }));
  });
  const ref = (pi: number, b: number) => bits[portOffset[pi] + b];
  const role: string[] = ports.map(() => '');

  const map: BoardMap = {
    ports,
    portOffset,
    totalBits: bits.length,
    bits,
    clocks: [],
    clockName: null,
    inputs: [],
    switches: [],
    buttons: [],
    resets: [],
    genericInputs: [],
    uartRx: null,
    uartTx: null,
    leds: [],
    rgbs: [],
    segMux: null,
    segStatics: [],
    genericOutputs: [],
    portRole: role,
  };

  const boardClock = board?.clock.signal.toLowerCase();
  const infos = ports.map((p) => analyzeName(p.name));

  /* ───── 输入 ───── */
  const clockCandidates: number[] = [];
  ports.forEach((p, pi) => {
    if (p.direction !== 'input' || p.bits.length !== 1) return;
    const { base } = infos[pi];
    if (CLOCK_RE.test(base) || (boardClock && p.name.toLowerCase() === boardClock)) clockCandidates.push(pi);
  });
  // 板卡主时钟优先
  clockCandidates.sort((a, b) => {
    const ab = boardClock && ports[a].name.toLowerCase() === boardClock ? 0 : 1;
    const bb = boardClock && ports[b].name.toLowerCase() === boardClock ? 0 : 1;
    return ab - bb;
  });
  for (const pi of clockCandidates) {
    map.clocks.push(ref(pi, 0));
    role[pi] = '时钟';
  }
  map.clockName = clockCandidates.length ? ports[clockCandidates[0]].name : null;

  let swKey = 0;
  let btnKey = 0;
  ports.forEach((p, pi) => {
    if (p.direction !== 'input' || role[pi]) return;
    const { base, activeLow } = infos[pi];
    if (p.bits.length === 1 && RESET_RE.test(base)) {
      const low = activeLow || /^(rstn|resetn|nrst|nreset)$/.test(base);
      const ctl: InputCtl = { kind: 'reset', ref: ref(pi, 0), activeLow: low, label: 'RST', key: map.resets.length === 0 ? RESET_KEY : undefined, idle: low ? 1 : 0 };
      map.resets.push(ctl);
      role[pi] = low ? '复位按键（低有效）' : '复位按键';
      return;
    }
    if (p.bits.length === 1 && RX_RE.test(base) && !map.uartRx) {
      map.uartRx = { kind: 'uart_rx', ref: ref(pi, 0), activeLow: false, label: 'RX', idle: 1 };
      role[pi] = '串口 RX';
      return;
    }
    if (SWITCH_RE.test(base)) {
      const m = /(\d+)$/.exec(base);
      for (let b = 0; b < p.bits.length; b++) {
        const idx = p.bits.length === 1 && m ? Number(m[1]) : b;
        map.switches.push({
          kind: 'switch',
          ref: ref(pi, b),
          activeLow,
          label: `SW${p.bits.length === 1 && !m ? map.switches.length : idx}`,
          key: SWITCH_KEYS[swKey++],
          idle: 0,
        });
      }
      role[pi] = activeLow ? '拨码开关（低有效）' : '拨码开关';
      return;
    }
    if (BUTTON_RE.test(base)) {
      const m = /^(?:btn|button|key|pb)_?([a-z]+|\d+)$/.exec(base);
      for (let b = 0; b < p.bits.length; b++) {
        let label: string;
        if (p.bits.length > 1) label = `${base.startsWith('key') ? 'KEY' : 'BTN'}${b}`;
        else if (m && /^\d+$/.test(m[1])) label = `${base.startsWith('key') ? 'KEY' : 'BTN'}${m[1]}`;
        else if (m) label = m[1].length <= 2 ? m[1].toUpperCase() : m[1].charAt(0).toUpperCase() + m[1].slice(1);
        else label = base.startsWith('key') ? 'KEY' : 'BTN';
        map.buttons.push({ kind: 'button', ref: ref(pi, b), activeLow, label, key: BUTTON_KEYS[btnKey++], idle: activeLow ? 1 : 0 });
      }
      role[pi] = activeLow ? '按键（低有效）' : '按键';
      return;
    }
    for (let b = 0; b < p.bits.length; b++) {
      map.genericInputs.push({ kind: 'generic', ref: ref(pi, b), activeLow: false, label: bitName(p, b), idle: 0 });
    }
    role[pi] = '通用输入';
  });
  // 快捷键只分配给前 10 个开关 / 前 10 个按键
  map.inputs = [...map.resets, ...map.switches, ...map.buttons, ...map.genericInputs];
  if (map.uartRx) map.inputs.push(map.uartRx);

  /* ───── 输出 ───── */
  const outputs = ports.map((p, pi) => ({ p, pi })).filter(({ p }) => p.direction !== 'input');

  // 1. 串口 TX
  for (const { p, pi } of outputs) {
    if (p.bits.length === 1 && TX_RE.test(infos[pi].base) && !map.uartTx) {
      map.uartTx = ref(pi, 0);
      role[pi] = '串口 TX';
    }
  }

  // 2. 数码管
  let segPort = -1;
  let anPort = -1;
  let dpPort = -1;
  for (const { p, pi } of outputs) {
    if (role[pi]) continue;
    const { base } = infos[pi];
    if (segPort < 0 && SEG_RE.test(base) && p.bits.length >= 7 && p.bits.length <= 8) segPort = pi;
    else if (anPort < 0 && AN_RE.test(base) && p.bits.length >= 1 && p.bits.length <= 16) anPort = pi;
    else if (dpPort < 0 && DP_RE.test(base) && p.bits.length === 1) dpPort = pi;
  }
  if (segPort >= 0) {
    const sp = ports[segPort];
    const si = infos[segPort];
    const segs: (BitRef | null)[] = [];
    for (let s = 0; s < 8; s++) segs.push(s < sp.bits.length ? ref(segPort, s) : null);
    if (!segs[7] && dpPort >= 0) {
      segs[7] = ref(dpPort, 0);
      role[dpPort] = '数码管小数点';
    }
    const digits: BitRef[] = [];
    let anLow = false;
    let anName: string | null = null;
    if (anPort >= 0) {
      const ai = infos[anPort];
      for (let b = 0; b < ports[anPort].bits.length; b++) digits.push(ref(anPort, b));
      // Basys3 风格：an 默认低有效；dig/digit/com 等默认高有效，_n 结尾为低有效
      anLow = ai.activeLow || /^(an|ano|anode|anodes|an_?out|seg_?an)$/.test(ai.base);
      anName = ports[anPort].name;
      role[anPort] = `数码管位选（${anLow ? '低' : '高'}有效）`;
    }
    const segLow = segDefaultLow(si.base, si.activeLow);
    map.segMux = { segs, digits, segActiveLow: segLow, anActiveLow: anLow, segName: sp.name, anName };
    role[segPort] = `数码管段选（${segLow ? '低' : '高'}有效）`;
  }
  for (const { p, pi } of outputs) {
    if (role[pi]) continue;
    const { base, activeLow } = infos[pi];
    if (SEG_STATIC_RE.test(base) && p.bits.length >= 7 && p.bits.length <= 8) {
      const segs: (BitRef | null)[] = [];
      for (let s = 0; s < 8; s++) segs.push(s < p.bits.length ? ref(pi, s) : null);
      const low = segDefaultLow(base, activeLow);
      map.segStatics.push({ segs, activeLow: low, label: p.name });
      role[pi] = `数码管（${low ? '低' : '高'}有效）`;
    }
  }
  // 静态数码管按编号排序：hex0 在最右
  map.segStatics.sort((a, b) => {
    const na = Number(/(\d+)$/.exec(a.label)?.[1] ?? 0);
    const nb = Number(/(\d+)$/.exec(b.label)?.[1] ?? 0);
    return na - nb;
  });

  // 3. RGB：rgb 多位端口（每 3 位 {R,G,B} = [3k+2,3k+1,3k]）
  for (const { p, pi } of outputs) {
    if (role[pi]) continue;
    const { base, activeLow } = infos[pi];
    if (RGB_PORT_RE.test(base) && p.bits.length % 3 === 0) {
      const n = p.bits.length / 3;
      for (let k = 0; k < n; k++) {
        map.rgbs.push({ r: ref(pi, 3 * k + 2), g: ref(pi, 3 * k + 1), b: ref(pi, 3 * k), activeLow, label: n === 1 ? p.name : `${p.name}${k}` });
      }
      role[pi] = 'RGB 灯 {R,G,B}';
    }
  }
  // RGB：同前缀的 _r/_g/_b 三个 1 位端口
  const chanGroups = new Map<string, { r?: number; g?: number; b?: number; low: boolean }>();
  for (const { p, pi } of outputs) {
    if (role[pi] || p.bits.length !== 1) continue;
    const { base, activeLow } = infos[pi];
    const m = RGB_CH_RE.exec(base);
    if (!m) continue;
    const prefix = m[1];
    if (!/(led|rgb)/.test(prefix)) continue;
    const key = `${prefix}|${activeLow ? 1 : 0}`;
    const g = chanGroups.get(key) ?? { low: activeLow };
    g[channelOf(m[2])] = pi;
    chanGroups.set(key, g);
  }
  for (const [key, g] of chanGroups) {
    if (g.r === undefined || g.g === undefined || g.b === undefined) continue;
    const prefix = key.split('|')[0];
    map.rgbs.push({ r: ref(g.r, 0), g: ref(g.g, 0), b: ref(g.b, 0), activeLow: g.low, label: prefix.toUpperCase() || 'RGB' });
    for (const pi of [g.r, g.g, g.b]) role[pi] = g.low ? 'RGB 灯（低有效）' : 'RGB 灯';
  }

  // 4. LED
  for (const { p, pi } of outputs) {
    if (role[pi]) continue;
    const { base, activeLow } = infos[pi];
    if (!LED_RE.test(base)) continue;
    const color = ledColorOf(base);
    for (let b = 0; b < p.bits.length; b++) {
      const m = /(\d+)$/.exec(base);
      const label = p.bits.length > 1 ? String(b) : m ? m[1] : base.replace(/^led_?/, '').toUpperCase() || String(map.leds.length);
      map.leds.push({ ref: ref(pi, b), activeLow, color, label });
    }
    role[pi] = activeLow ? 'LED（低有效）' : 'LED';
  }

  // 5. 其他输出 → 通用指示灯
  for (const { p, pi } of outputs) {
    if (role[pi]) continue;
    for (let b = 0; b < p.bits.length; b++) map.genericOutputs.push({ ref: ref(pi, b), label: bitName(p, b) });
    role[pi] = p.direction === 'inout' ? '双向（只读）' : '通用输出';
  }

  return map;
}

/** 输入的初始电平表（扁平下标 → 电平） */
export function defaultInputLevels(map: BoardMap): Map<number, 0 | 1> {
  const m = new Map<number, 0 | 1>();
  for (const c of map.inputs) m.set(c.ref.index, c.idle);
  return m;
}
