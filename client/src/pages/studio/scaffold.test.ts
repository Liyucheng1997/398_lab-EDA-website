import { describe, expect, it } from 'vitest';
import type { BoardInfo, Example } from '@webeda/shared';
import { BOARDS, DEVICES, getDevice } from '@webeda/shared';
import { boardPorts, buildEmptyProject, buildTemplateProject, counterWidth, generateTestbench, generateTopModule } from './scaffold';
import { moduleInfo, parseModules } from './model';

const fakeBoard: BoardInfo = {
  id: 'fake',
  name: 'Fake Board',
  vendor: 'X',
  device: 'ecp5-25k-cabga256',
  clock: { signal: 'clk25', pin: 'P3', freqMHz: 25 },
  pins: [
    { signal: 'led[0]', pin: 'A1', peripheral: 'led' },
    { signal: 'led[1]', pin: 'A2', peripheral: 'led' },
    { signal: 'led[2]', pin: 'A3', peripheral: 'led' },
    { signal: 'clk25', pin: 'P3', peripheral: 'clock' },
    { signal: 'sw[0]', pin: 'B1', peripheral: 'switch' },
    { signal: 'btn_n', pin: 'B2', peripheral: 'button' },
    { signal: 'rst_n', pin: 'B3', peripheral: 'button' },
    { signal: 'seg_n[6]', pin: 'C7', peripheral: 'seg' },
    { signal: 'uart_tx', pin: 'D1', peripheral: 'uart_tx' },
    { signal: 'gpio[1]', pin: 'E1', peripheral: 'pmod' },
  ],
  virtual: { leds: 3, switches: 1, buttons: 1, sevenSegDigits: 1, rgb: 0 },
};

describe('boardPorts', () => {
  it('merges buses, maps directions, puts clock first', () => {
    const ports = boardPorts(fakeBoard);
    expect(ports.map((p) => `${p.dir} ${p.name}[${p.width}]`)).toEqual([
      'input clk25[1]',
      'output led[3]',
      'input sw[1]',
      'input btn_n[1]',
      'input rst_n[1]',
      'output seg_n[7]',
      'output uart_tx[1]',
      'inout gpio[2]',
    ]);
  });

  it('summarizes bus labels in comments', () => {
    const ports = boardPorts(fakeBoard);
    expect(ports.find((p) => p.name === 'led')!.comment).toBe('3 位');
    const labeled = boardPorts({
      ...fakeBoard,
      pins: [
        { signal: 'led[0]', pin: 'A', peripheral: 'led', label: 'LD0' },
        { signal: 'led[1]', pin: 'B', peripheral: 'led', label: 'LD1' },
      ],
    });
    expect(labeled.find((p) => p.name === 'led')!.comment).toBe('LD0 … LD1');
  });

  it('adds a clock port when the pin list lacks it', () => {
    const b = { ...fakeBoard, pins: fakeBoard.pins.filter((p) => p.peripheral !== 'clock') };
    expect(boardPorts(b)[0]).toMatchObject({ name: 'clk25', dir: 'input', peripheral: 'clock' });
  });
});

describe('generated sources', () => {
  it('top module declares every board port', () => {
    const ports = boardPorts(fakeBoard);
    const src = generateTopModule({ ports, freqMHz: 25, title: 'Fake' });
    expect(parseModules(src)).toEqual(['top']);
    for (const p of ports) expect(src).toMatch(new RegExp(`\\b${p.name}\\b`));
    expect(src).toContain("if (!rst_n) blink_cnt <= '0;");
    expect(src).toContain("assign seg_n = '1;");
    expect(src).toContain("assign uart_tx = 1'b1;");
    expect(src).toContain('assign led = blink_cnt[CNT_W-1 -: 3];');
  });

  it('testbench instantiates top and drives inputs', () => {
    const ports = boardPorts(fakeBoard);
    const tb = generateTestbench({ ports, freqMHz: 25 });
    expect(moduleInfo([{ name: 'tb_top.sv', content: tb }], ['testbench']).tops).toEqual(['tb_top']);
    expect(tb).toContain('always #20 clk25 = ~clk25;');
    expect(tb).toContain("logic btn_n = 1'b1;");
    expect(tb).toContain("logic rst_n = 1'b0;");
    expect(tb).toContain('wire  [1:0] gpio;');
    expect(tb).toContain('.uart_tx(uart_tx)');
  });

  it('counter width blinks around 1 Hz', () => {
    expect(counterWidth(12, 1)).toBe(24);
    expect(counterWidth(100, 1)).toBe(27);
    expect(counterWidth(0.001, 20)).toBe(22);
  });
});

describe('project builders', () => {
  it('builds an empty board project', () => {
    const board = BOARDS[0];
    const device = getDevice(board.device)!;
    const p = buildEmptyProject({ name: 'demo', device, board });
    expect(p.files.map((f) => f.name)).toEqual(['top.sv', `${board.id}${device.constraintExt}`, 'tb_top.sv']);
    expect(p.settings).toMatchObject({
      device: board.device,
      board: board.id,
      top: 'top',
      simTop: 'tb_top',
      constraintFile: `${board.id}${device.constraintExt}`,
      freqMHz: board.clock.freqMHz,
      synth: { flatten: true },
      simulate: { standard: '2012' },
    });
    expect(p.settings.gatesimParams?.CNT_W).toBeGreaterThanOrEqual(16);
  });

  it('builds bare-device projects for every device', () => {
    for (const device of DEVICES) {
      const p = buildEmptyProject({ name: 'x', device });
      expect(p.settings.board).toBeUndefined();
      expect(p.files[1].name).toBe(`top${device.constraintExt}`);
      expect(p.files[0].content).toMatch(/output logic \[3:0\]\s+led/);
    }
  });

  it('builds from a template, filling missing settings', () => {
    const ex: Example = {
      id: 't',
      title: 'Blinky',
      description: 'desc',
      category: 'board',
      scope: 'studio',
      board: 'icebreaker',
      files: [
        { name: 'blinky.v', content: 'module blinky(input clk); sub s(.a(clk)); endmodule\nmodule sub(input a); endmodule' },
        { name: 'blinky_tb.v', content: 'module blinky_tb; blinky b(.clk(1\'b0)); endmodule' },
        { name: 'icebreaker.pcf', content: 'set_io clk 35' },
      ],
    };
    const p = buildTemplateProject({ name: 'n', example: ex });
    expect(p.settings).toMatchObject({
      device: 'ice40-up5k-sg48',
      board: 'icebreaker',
      top: 'blinky',
      simTop: 'blinky_tb',
      constraintFile: 'icebreaker.pcf',
      freqMHz: 12,
    });
    expect(p.description).toBe('desc');
    expect(p.files.every((f) => f.role)).toBe(true);
    const withSettings = buildTemplateProject({
      name: 'n',
      example: { ...ex, project: { device: 'ecp5-25k-cabga256', freqMHz: 50, synth: { flatten: false }, simulate: {}, top: 'sub' } },
    });
    expect(withSettings.settings).toMatchObject({ device: 'ecp5-25k-cabga256', top: 'sub', freqMHz: 50, synth: { flatten: false } });
    expect(withSettings.settings.board).toBeUndefined();
  });
});
