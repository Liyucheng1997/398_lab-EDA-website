/**
 * 用 Yosys gatesim 流程真实产出的网表（fixtures/）做端到端检查：
 * 串口发送、串口回显、多路复用数码管 + 板载外设映射。
 */
import { describe, expect, it } from 'vitest';
import type { GateNetlist } from '@webeda/shared';
import { getBoard } from '@webeda/shared';
import { SimRunner } from './runner';
import { muxSegLevels } from '../display';
import uartHello from './fixtures/uart_hello.json';
import uartEcho from './fixtures/uart_echo.json';
import starter from './fixtures/virtual_starter.json';

const text = (bytes: number[]) => String.fromCharCode(...bytes);

describe('real gatesim netlists', () => {
  it('uart_hello prints its greeting at 115200 baud from a 12 MHz clock', () => {
    const r = new SimRunner(uartHello as GateNetlist, getBoard('icebreaker'), { freqHz: 12e6, baud: 115200 });
    expect(r.map.uartTx?.name).toBe('tx');
    expect(r.map.buttons[0].activeLow).toBe(true);
    const led = r.map.leds[0];
    expect(led.activeLow).toBe(true);
    expect(led.color).toBe('green');
    let out: number[] = [];
    let ledOnSeen = false;
    for (let i = 0; i < 40; i++) {
      r.runCycles(500);
      const s = r.snapshot();
      out = out.concat(s.uart);
      expect(s.uartErrors).toBe(0);
      if (s.duty[led.ref.index] < 0.5) ledOnSeen = true;
    }
    expect(text(out)).toBe('Hello, WebEDA!\r\n');
    expect(ledOnSeen).toBe(true);
  });

  it('uart_echo echoes typed bytes (and upper-cases them with sw[0])', () => {
    const r = new SimRunner(uartEcho as GateNetlist, undefined, { freqHz: 12e6, baud: 115200 });
    expect(r.map.uartRx?.ref.name).toBe('rx');
    expect(r.map.resets[0].activeLow).toBe(true);
    expect(r.map.rgbs).toHaveLength(1);
    expect(r.map.genericInputs.map((g) => g.label)).toEqual(['mode[0]', 'mode[1]', 'mode[2]', 'mode[3]']);
    r.uartSend(Array.from(new TextEncoder().encode('abc')));
    r.runCycles(4500);
    let s = r.snapshot();
    expect(text(s.uart)).toBe('abc');
    // led = 最后一个字节
    const led = r.map.leds.slice().sort((a, b) => a.ref.bit - b.ref.bit);
    expect(led.reduce((acc, l, i) => acc | (s.values[l.ref.index] << i), 0)).toBe(0x63);
    r.setInput(r.map.switches[0].ref.index, 1);
    r.uartSend([0x78, 0x79]);
    r.runCycles(3500);
    s = r.snapshot();
    expect(text(s.uart)).toBe('XY');
    // RGB PWM：r = cnt<200，g = cnt<40，b = cnt<8（8 位计数器）
    const rgb = r.map.rgbs[0];
    r.snapshot();
    r.runCycles(256 * 10);
    s = r.snapshot();
    expect(s.duty[rgb.r!.index]).toBeCloseTo(200 / 256, 3);
    expect(s.duty[rgb.g!.index]).toBeCloseTo(40 / 256, 3);
    expect(s.duty[rgb.b!.index]).toBeCloseTo(8 / 256, 3);
  });

  it('virtual_starter shows the switch value on the multiplexed display', () => {
    const r = new SimRunner(starter as GateNetlist, undefined, { freqHz: 1000, baud: 9600 });
    const mux = r.map.segMux!;
    expect(mux.digits).toHaveLength(4);
    expect(mux.segActiveLow).toBe(true);
    expect(mux.anActiveLow).toBe(true);
    expect(r.map.leds).toHaveLength(16);
    expect(r.map.buttons).toHaveLength(5);
    const value = 0x2b7e;
    r.map.switches.forEach((s) => r.setInput(s.ref.index, (value >> s.ref.bit) & 1));
    r.snapshot();
    r.runCycles(400);
    const s = r.snapshot();
    const lv = muxSegLevels(mux, s.segJoint, s.duty, mux.anActiveLow, mux.segActiveLow);
    const PATTERNS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];
    const shown: number[] = [];
    for (let d = 0; d < 4; d++) {
      let pat = 0;
      for (let seg = 0; seg < 7; seg++) if (lv[d * 8 + seg] > 0.5) pat |= 1 << seg;
      shown.push(PATTERNS.indexOf(pat));
    }
    expect(shown).toEqual([0xe, 0x7, 0xb, 0x2]);
    // LED = 开关
    for (const l of r.map.leds) expect(s.values[l.ref.index]).toBe((value >> l.ref.bit) & 1);
    // 按住 BTNC（btn[0]）→ LED 取反
    r.setInput(r.map.buttons[0].ref.index, 1);
    const s2 = r.snapshot();
    for (const l of r.map.leds) expect(s2.values[l.ref.index]).toBe(((value >> l.ref.bit) & 1) ^ 1);
  });
});
