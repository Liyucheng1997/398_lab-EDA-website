import { describe, expect, it } from 'vitest';
import type { GatePort } from '@webeda/shared';
import { getBoard } from '@webeda/shared';
import { analyzeName, defaultInputLevels, mapBoard } from './peripherals';

let net = 2;
function port(name: string, direction: GatePort['direction'], width = 1): GatePort {
  return { name, direction, bits: Array.from({ length: width }, () => net++) };
}

describe('analyzeName', () => {
  it('strips prefixes/suffixes and detects active-low', () => {
    expect(analyzeName('rst_n')).toEqual({ base: 'rst', activeLow: true });
    expect(analyzeName('o_led_n')).toEqual({ base: 'led', activeLow: true });
    expect(analyzeName('i_clk')).toEqual({ base: 'clk', activeLow: false });
    expect(analyzeName('clk_in')).toEqual({ base: 'clk', activeLow: false });
    expect(analyzeName('BTN')).toEqual({ base: 'btn', activeLow: false });
    expect(analyzeName('an')).toEqual({ base: 'an', activeLow: false });
    expect(analyzeName('led_b')).toEqual({ base: 'led_b', activeLow: false });
  });
});

describe('mapBoard', () => {
  it('maps a Basys3-style design', () => {
    const ports = [
      port('clk', 'input'),
      port('btnC', 'input'),
      port('btnU', 'input'),
      port('sw', 'input', 16),
      port('led', 'output', 16),
      port('seg', 'output', 7),
      port('dp', 'output'),
      port('an', 'output', 4),
      port('RsTx', 'output'),
    ];
    const m = mapBoard({ ports });
    expect(m.clocks.map((c) => c.name)).toEqual(['clk']);
    expect(m.clockName).toBe('clk');
    expect(m.switches).toHaveLength(16);
    expect(m.switches[0].label).toBe('SW0');
    expect(m.switches[0].key).toBe('1');
    expect(m.switches[9].key).toBe('0');
    expect(m.switches[10].key).toBeUndefined();
    expect(m.buttons.map((b) => b.label)).toEqual(['C', 'U']);
    expect(m.buttons.map((b) => b.key)).toEqual(['q', 'w']);
    expect(m.leds).toHaveLength(16);
    expect(m.leds.every((l) => l.color === 'green' && !l.activeLow)).toBe(true);
    expect(m.segMux).not.toBeNull();
    expect(m.segMux!.digits).toHaveLength(4);
    expect(m.segMux!.anActiveLow).toBe(true);
    expect(m.segMux!.segActiveLow).toBe(false);
    expect(m.segMux!.segs[7]?.name).toBe('dp');
    expect(m.uartTx?.name).toBe('RsTx');
    expect(m.genericOutputs).toEqual([]);
    expect(m.totalBits).toBe(1 + 1 + 1 + 16 + 16 + 7 + 1 + 4 + 1);
  });

  it('maps an iCEBreaker-style design with the board clock', () => {
    const board = getBoard('icebreaker');
    const ports = [
      port('clk', 'input'),
      port('btn_n', 'input'),
      port('rx', 'input'),
      port('led_r', 'output'),
      port('led_g', 'output'),
      port('tx', 'output'),
    ];
    const m = mapBoard({ ports }, board);
    expect(m.clocks).toHaveLength(1);
    expect(m.buttons).toHaveLength(1);
    expect(m.buttons[0].activeLow).toBe(true);
    expect(m.buttons[0].idle).toBe(1);
    expect(m.uartRx?.ref.name).toBe('rx');
    expect(m.uartTx?.name).toBe('tx');
    expect(m.leds.map((l) => [l.label, l.color])).toEqual([
      ['R', 'red'],
      ['G', 'green'],
    ]);
    expect(m.rgbs).toHaveLength(0);
    const lv = defaultInputLevels(m);
    expect(lv.get(m.buttons[0].ref.index)).toBe(1);
    expect(lv.get(m.uartRx!.ref.index)).toBe(1);
  });

  it('groups r/g/b channels into RGB LEDs and splits rgb buses', () => {
    const ports = [port('led_r', 'output'), port('led_g', 'output'), port('led_b', 'output'), port('rgb', 'output', 6), port('rgb_n', 'output', 3)];
    const m = mapBoard({ ports });
    expect(m.leds).toHaveLength(0);
    expect(m.rgbs).toHaveLength(4);
    const bus = m.rgbs.filter((r) => r.label.startsWith('rgb') && !r.activeLow);
    expect(bus).toHaveLength(2);
    expect(bus[0].r?.name).toBe('rgb[2]');
    expect(bus[0].b?.name).toBe('rgb[0]');
    expect(m.rgbs.find((r) => r.label === 'rgb_n')?.activeLow).toBe(true);
    expect(m.rgbs.find((r) => r.label === 'LED')?.g?.name).toBe('led_g');
  });

  it('detects resets, active-low LEDs, static hex digits and generic ports', () => {
    const ports = [
      port('clock', 'input'),
      port('resetn', 'input'),
      port('mode', 'input', 2),
      port('led_n', 'output', 4),
      port('hex1', 'output', 7),
      port('hex0', 'output', 7),
      port('data', 'output', 8),
      port('bus', 'inout', 2),
      port('uart_tx', 'output'),
    ];
    const m = mapBoard({ ports });
    expect(m.clocks[0].name).toBe('clock');
    expect(m.resets).toHaveLength(1);
    expect(m.resets[0].activeLow).toBe(true);
    expect(m.resets[0].idle).toBe(1);
    expect(m.resets[0].key).toBe('z');
    expect(m.genericInputs.map((g) => g.label)).toEqual(['mode[0]', 'mode[1]']);
    expect(m.leds).toHaveLength(4);
    expect(m.leds[0].activeLow).toBe(true);
    expect(m.segMux).toBeNull();
    expect(m.segStatics.map((s) => s.label)).toEqual(['hex0', 'hex1']);
    expect(m.segStatics[0].activeLow).toBe(true);
    expect(m.genericOutputs).toHaveLength(10);
    expect(m.uartTx?.name).toBe('uart_tx');
    expect(m.portRole[ports.findIndex((p) => p.name === 'bus')]).toMatch(/双向/);
  });

  it('handles designs without ports', () => {
    const m = mapBoard({ ports: [] });
    expect(m.totalBits).toBe(0);
    expect(m.clocks).toEqual([]);
    expect(m.inputs).toEqual([]);
  });

  it('does not treat a multi-bit "clk" or output clock as a driven clock', () => {
    const ports = [port('clk', 'input', 2), port('clk_out', 'output')];
    const m = mapBoard({ ports });
    expect(m.clocks).toHaveLength(0);
    expect(m.genericInputs).toHaveLength(2);
  });
});
