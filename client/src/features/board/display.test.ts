import { describe, expect, it } from 'vitest';
import {
  activeDuty,
  appendTerminalText,
  bytesToHex,
  encodeUartText,
  formatCount,
  formatHz,
  formatPortValue,
  formatSimTime,
  hzToSlider,
  ledLevel,
  muxSegLevels,
  niceHz,
  parseHexBytes,
  parsePortValue,
  sliderToHz,
  staticSegLevels,
} from './display';
import type { BitRef } from './sim/peripherals';

const ref = (index: number): BitRef => ({ port: 0, bit: index, net: index + 2, index, name: `b${index}` });

describe('brightness', () => {
  it('maps duty to LED level', () => {
    expect(ledLevel(0)).toBe(0);
    expect(ledLevel(0.001)).toBe(0);
    expect(ledLevel(1)).toBe(1);
    expect(ledLevel(0.25)).toBeCloseTo(0.56);
    expect(ledLevel(Number.NaN)).toBe(0);
    expect(activeDuty(0.2, true)).toBeCloseTo(0.8);
    expect(activeDuty(1.2, false)).toBe(1);
  });

  it('computes multiplexed segment levels for every polarity', () => {
    // 两位：digit0 位选在 t∈[0,0.5)，digit1 在 [0.5,1)；段 a 只在 digit0 时亮
    // 原始电平（高有效时）：an0 占 0.5，an1 占 0.5，segA 占 0.5，joint(an0,a)=0.5，joint(an1,a)=0
    const mux = { segs: [ref(0), null, null, null, null, null, null, null], digits: [ref(1), ref(2)] };
    const duty = new Float32Array([0.5, 0.5, 0.5]);
    const joint = new Float32Array(16);
    joint[0] = 0.5;
    const hh = muxSegLevels(mux, joint, duty, false, false);
    expect(hh[0]).toBeCloseTo(1); // 归一化到最亮位
    expect(hh[8]).toBe(0);
    expect(hh[1]).toBe(0); // 缺失段
    // 同样的波形取反后（全部低有效）结果一致：raw an0'=1-an0 等
    // 低有效 raw：an0 raw = 0 当 digit0 选中 → raw duty 0.5；segA raw = 0 当亮 → 0.5；joint raw(an0=1 & a=1) = 0.5
    const ll = muxSegLevels(mux, new Float32Array([0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), duty, true, true);
    // f = 1 - A - S + J = 1 - .5 - .5 + .5 = .5 → ×2 = 1（an0 raw=1 且 a raw=1 的时段即 digit1 且段灭——此处构造仅检验公式）
    expect(ll[0]).toBeCloseTo(1);
    const hl = muxSegLevels(mux, joint, duty, false, true);
    expect(hl[0]).toBeCloseTo(0); // A - J = 0
    expect(hl[8]).toBeCloseTo(1); // A - J = 0.5 → ×2
    const lh = muxSegLevels(mux, joint, duty, true, false);
    expect(lh[0]).toBeCloseTo(0); // S - J
    expect(lh[8]).toBeCloseTo(1);
  });

  it('handles no digits, no data and all-off anodes', () => {
    const mux = { segs: [ref(0), ref(1), null, null, null, null, null, null], digits: [] as BitRef[] };
    const single = muxSegLevels(mux, null, new Float32Array([1, 0]), false, false);
    expect(Array.from(single.slice(0, 3))).toEqual([1, 0, 0]);
    const mux2 = { segs: mux.segs, digits: [ref(2)] };
    expect(Array.from(muxSegLevels(mux2, null, new Float32Array(3), false, false))).toEqual(new Array(8).fill(0));
    expect(Array.from(muxSegLevels(mux2, new Float32Array(8).fill(1), new Float32Array(3), false, false))).toEqual(new Array(8).fill(0));
    expect(Array.from(staticSegLevels(mux.segs, new Float32Array([0, 1]), true).slice(0, 3))).toEqual([1, 0, 0]);
  });
});

describe('formatting', () => {
  it('formats rates, times and counts', () => {
    expect(formatHz(0)).toBe('0 Hz');
    expect(formatHz(1)).toBe('1 Hz');
    expect(formatHz(512)).toBe('512 Hz');
    expect(formatHz(12_340)).toBe('12.3 kHz');
    expect(formatHz(1_234_567)).toBe('1.23 MHz');
    expect(formatHz(100e6)).toBe('100 MHz');
    expect(formatSimTime(0)).toBe('0 s');
    expect(formatSimTime(120e-9)).toBe('120 ns');
    expect(formatSimTime(0.0123)).toBe('12.3 ms');
    expect(formatSimTime(75)).toBe('1 min 15 s');
    expect(formatSimTime(7300)).toBe('2 h 1 min');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(12_345)).toBe('12.3k');
    expect(formatCount(2_500_000)).toBe('2.5M');
  });

  it('maps the log speed slider both ways with nice values', () => {
    expect(sliderToHz(0)).toBe(1);
    expect(sliderToHz(1000)).toBe(1e8);
    expect(sliderToHz(500)).toBe(10_000);
    expect(hzToSlider(10_000)).toBe(500);
    expect(hzToSlider(0)).toBe(0);
    expect(niceHz(1234)).toBe(1000);
    expect(niceHz(4600)).toBe(5000);
    for (let x = 0; x <= 1000; x += 37) expect(Math.abs(hzToSlider(sliderToHz(x)) - x)).toBeLessThan(40);
  });

  it('formats and parses port values', () => {
    const v = [1, 0, 1, 1, 0, 0, 0, 1]; // 0b10001101 = 0x8D
    expect(formatPortValue(v, 0, 8, 'hex')).toBe('8D');
    expect(formatPortValue(v, 0, 8, 'bin')).toBe('1000_1101');
    expect(formatPortValue(v, 0, 8, 'dec')).toBe('141');
    expect(formatPortValue(v, 0, 3, 'hex')).toBe('5');
    const wide = new Array(70).fill(1);
    expect(formatPortValue(wide, 0, 70, 'hex')).toBe('3FFFFFFFFFFFFFFFFF');
    expect(parsePortValue('8d', 8)).toEqual(v);
    expect(parsePortValue('0x8D', 8)).toEqual(v);
    expect(parsePortValue("8'h8d", 8)).toEqual(v);
    expect(parsePortValue('0b1000_1101', 8)).toEqual(v);
    expect(parsePortValue('141', 8, 'dec')).toEqual(v);
    expect(parsePortValue("'d141", 8)).toEqual(v);
    expect(parsePortValue('1ff', 8)).toBeNull();
    expect(parsePortValue('xyz', 8)).toBeNull();
    expect(parsePortValue('', 8)).toBeNull();
  });
});

describe('uart helpers', () => {
  it('encodes text with line endings and parses hex', () => {
    expect(encodeUartText('Hi', 'crlf')).toEqual([0x48, 0x69, 13, 10]);
    expect(encodeUartText('é', 'none')).toEqual([0xc3, 0xa9]);
    expect(parseHexBytes('48 65,0x6C')).toEqual([0x48, 0x65, 0x6c]);
    expect(parseHexBytes('123')).toBeNull();
    expect(parseHexBytes('  ')).toBeNull();
    expect(bytesToHex([1, 255])).toBe('01 FF ');
  });

  it('appends terminal text with control handling and trimming', () => {
    expect(appendTerminalText('', 'ab\r\ncd\x08e\x01')).toBe('ab\nce');
    const long = appendTerminalText('', 'line1\nline2\nline3\n', 10);
    expect(long.length).toBeLessThanOrEqual(10);
    expect(long.endsWith('line3\n')).toBe(true);
  });
});
