import { describe, expect, it } from 'vitest';
import { bitsState, bitsToNumber, formatBits, formatFs, formatReal, pickUnit, trimNumber } from './format';

describe('formatBits', () => {
  it('binary passes through', () => {
    expect(formatBits('10x1z', 'bin')).toBe('10x1z');
  });
  it('hex pads to width and uppercases', () => {
    expect(formatBits('10100101', 'hex')).toBe('A5');
    expect(formatBits('00000101', 'hex')).toBe('05');
    expect(formatBits('101', 'hex')).toBe('5');
    expect(formatBits('100000000', 'hex')).toBe('100');
  });
  it('hex handles x/z per nibble', () => {
    expect(formatBits('xxxx0011', 'hex')).toBe('x3');
    expect(formatBits('xx010011', 'hex')).toBe('X3');
    expect(formatBits('zzzz1111', 'hex')).toBe('zF');
    expect(formatBits('z0011111', 'hex')).toBe('ZF');
    expect(formatBits('zzzzzzzz', 'hex')).toBe('zz');
    expect(formatBits('x1zz', 'hex')).toBe('X');
  });
  it('octal', () => {
    expect(formatBits('111101', 'oct')).toBe('75');
    expect(formatBits('1000', 'oct')).toBe('10');
    expect(formatBits('xxx101', 'oct')).toBe('x5');
  });
  it('unsigned and signed decimal', () => {
    expect(formatBits('11111111', 'dec')).toBe('255');
    expect(formatBits('11111111', 'sdec')).toBe('-1');
    expect(formatBits('10000000', 'sdec')).toBe('-128');
    expect(formatBits('01111111', 'sdec')).toBe('127');
    expect(formatBits('1x', 'dec')).toBe('x');
    expect(formatBits('zz', 'sdec')).toBe('z');
    expect(formatBits('z1', 'dec')).toBe('x');
  });
  it('wide values use BigInt', () => {
    const b = '1'.repeat(64);
    expect(formatBits(b, 'dec')).toBe('18446744073709551615');
    expect(formatBits(b, 'sdec')).toBe('-1');
    expect(formatBits(b, 'hex')).toBe('FFFFFFFFFFFFFFFF');
    expect(formatBits(`1${'0'.repeat(63)}`, 'sdec')).toBe('-9223372036854775808');
    expect(formatBits(`1${'0'.repeat(52)}`, 'sdec')).toBe(String(-(2 ** 52)));
  });
  it('ascii', () => {
    const s = 'Hi!'
      .split('')
      .map((c) => c.charCodeAt(0).toString(2).padStart(8, '0'))
      .join('');
    expect(formatBits(`${'0'.repeat(16)}${s}`, 'ascii')).toBe('Hi!');
    expect(formatBits('00000001', 'ascii')).toBe('.');
    expect(formatBits('xxxxxxxx01000001', 'ascii')).toBe('?A');
  });
  it('single bit returns raw state', () => {
    expect(formatBits('1', 'hex')).toBe('1');
    expect(formatBits('x', 'sdec')).toBe('x');
    expect(formatBits('', 'hex')).toBe('');
  });
});

describe('bitsState / bitsToNumber', () => {
  it('classifies', () => {
    expect(bitsState('0101')).toBe('ok');
    expect(bitsState('01z1')).toBe('z');
    expect(bitsState('0xz1')).toBe('x');
  });
  it('converts numbers', () => {
    expect(bitsToNumber('1111', false)).toBe(15);
    expect(bitsToNumber('1111', true)).toBe(-1);
    expect(bitsToNumber('0111', true)).toBe(7);
    expect(Number.isNaN(bitsToNumber('1x', false))).toBe(true);
    expect(bitsToNumber('1'.repeat(60), true)).toBe(-1);
  });
});

describe('formatReal', () => {
  it('formats compactly', () => {
    expect(formatReal(0)).toBe('0');
    expect(formatReal(2.5)).toBe('2.5');
    expect(formatReal(1 / 3)).toBe('0.3333333333');
    expect(formatReal(1e-9)).toBe('1e-9');
    expect(formatReal(Number.NaN)).toBe('NaN');
    expect(formatReal(-Infinity)).toBe('-Inf');
    expect(formatReal(42)).toBe('42');
  });
});

describe('time formatting', () => {
  it('picks units', () => {
    expect(pickUnit(125e6)).toBe('ns');
    expect(pickUnit(1.25e9)).toBe('us');
    expect(pickUnit(999)).toBe('fs');
    expect(pickUnit(0)).toBe('ns');
    expect(pickUnit(2e15)).toBe('s');
  });
  it('formats', () => {
    expect(formatFs(125e6)).toBe('125 ns');
    expect(formatFs(1.25e9)).toBe('1.25 μs');
    expect(formatFs(40e6, 'ps')).toBe('40000 ps');
    expect(formatFs(0)).toBe('0 ns');
    expect(trimNumber(1.5000001, 3)).toBe('1.5');
    expect(trimNumber(-0.0000001, 3)).toBe('0');
  });
});
