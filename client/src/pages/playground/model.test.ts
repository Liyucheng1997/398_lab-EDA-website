import { describe, expect, it } from 'vitest';
import type { Example, Playground } from '@webeda/shared';
import {
  classifyError,
  cleanSimulateOptions,
  clampTimeout,
  DEFAULT_TITLE,
  docFromExample,
  docFromPlayground,
  docReducer,
  docSignature,
  formatBytes,
  formatDuration,
  inferRoleFromName,
  layoutOf,
  neighborAfterDelete,
  normalizeFileName,
  normalizeSettings,
  resolveActive,
  roleFor,
  sanitizeDoc,
  starterContent,
  templateDoc,
  toInput,
  uniqueFileName,
  validateFileName,
  type PgDoc,
  type PgFile,
} from './model';

const file = (id: string, name: string, pane: PgFile['pane'], content = ''): PgFile => ({ id, name, pane, content });

function doc(files: PgFile[]): PgDoc {
  return { ...templateDoc(), files };
}

describe('roles and panes', () => {
  it('derives role from pane for HDL files', () => {
    expect(roleFor('a.sv', 'tb')).toBe('testbench');
    expect(roleFor('a.sv', 'design')).toBe('design');
    expect(roleFor('rtl/a.v', 'design')).toBe('design');
  });
  it('keeps extension-based roles for non-HDL files', () => {
    expect(roleFor('rom.hex', 'tb')).toBe('memory');
    expect(roleFor('init.mem', 'design')).toBe('memory');
    expect(roleFor('defs.svh', 'tb')).toBe('include');
    expect(roleFor('notes.txt', 'design')).toBe('other');
  });
  it('infers role like the server when missing', () => {
    expect(inferRoleFromName('testbench.sv')).toBe('testbench');
    expect(inferRoleFromName('tb_counter.v')).toBe('testbench');
    expect(inferRoleFromName('counter_tb.sv')).toBe('testbench');
    expect(inferRoleFromName('design.sv')).toBe('design');
    expect(inferRoleFromName('top.pcf')).toBe('constraint');
    expect(inferRoleFromName('a.hex')).toBe('memory');
  });
});

describe('file names', () => {
  it('normalizes names and adds default extension', () => {
    expect(normalizeFileName('  alu ')).toBe('alu.sv');
    expect(normalizeFileName('alu', '.v')).toBe('alu.v');
    expect(normalizeFileName('rtl\\alu.sv')).toBe('rtl/alu.sv');
    expect(normalizeFileName('./x.v')).toBe('x.v');
    expect(normalizeFileName('')).toBe('');
  });
  it('validates names', () => {
    const existing = ['design.sv', 'testbench.sv'];
    expect(validateFileName('alu.sv', existing)).toBeNull();
    expect(validateFileName('rom.hex', existing)).toBeNull();
    expect(validateFileName('rtl/alu.v', existing)).toBeNull();
    expect(validateFileName('', existing)).toMatch(/不能为空/);
    expect(validateFileName('Design.SV', existing)).toMatch(/同名/);
    expect(validateFileName('design.sv', existing, 'design.sv')).toBeNull();
    expect(validateFileName('../x.sv', existing)).not.toBeNull();
    expect(validateFileName('/x.sv', existing)).not.toBeNull();
    expect(validateFileName('C:/x.sv', existing)).not.toBeNull();
    expect(validateFileName('a//b.sv', existing)).not.toBeNull();
    expect(validateFileName('a/b/c.sv', existing)).toMatch(/一级/);
    expect(validateFileName('中文.sv', existing)).not.toBeNull();
    expect(validateFileName('x.exe', existing)).toMatch(/扩展名/);
    expect(validateFileName(`${'a'.repeat(120)}.sv`, existing)).toMatch(/不能超过/);
  });
  it('generates unique names', () => {
    expect(uniqueFileName('file', '.sv', [])).toBe('file.sv');
    expect(uniqueFileName('file', '.sv', ['FILE.sv', 'file1.sv'])).toBe('file2.sv');
  });
  it('produces starter content', () => {
    expect(starterContent('alu.sv', 'design')).toContain('module alu');
    expect(starterContent('tb_alu.sv', 'tb')).toContain('module tb_alu;');
    expect(starterContent('1bad.v', 'design')).toContain('module new_module');
    expect(starterContent('rom.hex', 'design')).toBe('');
  });
});

describe('settings', () => {
  it('fills defaults and drops junk', () => {
    const s = normalizeSettings({ simulate: { standard: 'bogus', timeoutSec: 999, top: 5 }, openWaveform: false });
    expect(s.simulate.standard).toBe('2012');
    expect(s.simulate.timeoutSec).toBe(120);
    expect(s.simulate.top).toBeUndefined();
    expect(s.openWaveform).toBe(false);
    expect(s.showSchematic).toBe(false);
    expect(normalizeSettings(undefined).simulate.autoDump).toBe(true);
  });
  it('clamps timeout', () => {
    expect(clampTimeout('abc')).toBe(30);
    expect(clampTimeout(0)).toBe(30);
    expect(clampTimeout(0.4)).toBe(30);
    expect(clampTimeout(1.4)).toBe(1);
    expect(clampTimeout(500)).toBe(120);
  });
  it('cleans simulate options', () => {
    expect(cleanSimulateOptions({ standard: '2005', top: '  ', compileFlags: ' -DX=1 ', runFlags: '', timeoutSec: 10 })).toEqual({
      standard: '2005',
      autoDump: true,
      timeoutSec: 10,
      compileFlags: '-DX=1',
    });
  });
});

describe('conversions', () => {
  it('builds a doc from a playground with layout overrides', () => {
    const p: Playground = {
      id: 'x',
      createdAt: '',
      updatedAt: '',
      title: '',
      files: [
        { name: 'design.sv', content: 'module d; endmodule', role: 'design' },
        { name: 'tb.sv', content: 'module tb; endmodule' },
        { name: 'rom.hex', content: '00', role: 'memory' },
        { name: 'lut.mem', content: '00', role: 'memory' },
      ],
      settings: undefined as never,
    };
    const d = docFromPlayground(p, { 'rom.hex': 'tb', 'design.sv': 'tb' });
    expect(d.title).toBe(DEFAULT_TITLE);
    expect(d.files.map((f) => [f.name, f.pane])).toEqual([
      ['design.sv', 'design'],
      ['tb.sv', 'tb'],
      ['rom.hex', 'tb'],
      ['lut.mem', 'design'],
    ]);
    expect(layoutOf(d)).toEqual({ 'rom.hex': 'tb' });
    const input = toInput(d);
    expect(input.files.map((f) => f.role)).toEqual(['design', 'testbench', 'memory', 'memory']);
    expect(input.description).toBeUndefined();
  });
  it('builds a doc from an example', () => {
    const ex: Example = {
      id: 'e',
      title: 'Ex',
      description: 'desc',
      category: 'basics',
      scope: 'playground',
      files: [{ name: 'testbench.sv', content: '' }],
      simulate: { standard: '2001' },
    };
    const d = docFromExample(ex);
    expect(d.settings.simulate.standard).toBe('2001');
    expect(d.settings.simulate.timeoutSec).toBe(30);
    expect(d.files[0].pane).toBe('tb');
    expect(d.description).toBe('desc');
  });
  it('signature reflects content, title, settings and layout but not ids', () => {
    const a = doc([file('1', 'design.sv', 'design', 'x'), file('2', 'rom.hex', 'design')]);
    const b = { ...a, files: a.files.map((f) => ({ ...f, id: f.id + 'z' })) };
    expect(docSignature(a)).toBe(docSignature(b));
    expect(docSignature(a)).not.toBe(docSignature(docReducer(a, { type: 'content', fileId: '1', content: 'y' })));
    expect(docSignature(a)).not.toBe(docSignature(docReducer(a, { type: 'title', title: 'T' })));
    expect(docSignature(a)).not.toBe(docSignature(docReducer(a, { type: 'simulate', patch: { standard: '2001' } })));
    expect(docSignature(a)).not.toBe(docSignature({ ...a, files: [a.files[0], { ...a.files[1], pane: 'tb' }] }));
  });
});

describe('docReducer', () => {
  const base = doc([file('1', 'testbench.sv', 'tb', 'tb'), file('2', 'design.sv', 'design', 'd')]);
  it('returns the same object for no-op edits', () => {
    expect(docReducer(base, { type: 'content', fileId: '1', content: 'tb' })).toBe(base);
    expect(docReducer(base, { type: 'content', fileId: 'nope', content: 'x' })).toBe(base);
    expect(docReducer(base, { type: 'title', title: base.title })).toBe(base);
  });
  it('adds, renames and deletes files with validation', () => {
    const added = docReducer(base, { type: 'addFile', file: file('3', 'alu.sv', 'design') });
    expect(added.files).toHaveLength(3);
    expect(docReducer(added, { type: 'addFile', file: file('4', 'ALU.sv', 'tb') })).toBe(added);
    const renamed = docReducer(added, { type: 'renameFile', fileId: '3', name: 'alu2.sv' });
    expect(renamed.files[2].name).toBe('alu2.sv');
    expect(docReducer(renamed, { type: 'renameFile', fileId: '3', name: 'design.sv' })).toBe(renamed);
    const deleted = docReducer(renamed, { type: 'deleteFile', fileId: '1' });
    expect(deleted.files.map((f) => f.id)).toEqual(['2', '3']);
  });
  it('truncates long titles and patches settings', () => {
    expect(docReducer(base, { type: 'title', title: 'x'.repeat(500) }).title).toHaveLength(200);
    const s = docReducer(base, { type: 'settings', patch: { showSchematic: true } });
    expect(s.settings.showSchematic).toBe(true);
    const t = docReducer(s, { type: 'simulate', patch: { top: 'tb' } });
    expect(t.settings.simulate.top).toBe('tb');
    expect(t.settings.simulate.standard).toBe('2012');
  });
});

describe('active tab helpers', () => {
  const files = [file('1', 'a.sv', 'tb'), file('2', 'b.sv', 'design'), file('3', 'c.sv', 'design'), file('4', 'd.sv', 'design')];
  it('resolves the active file', () => {
    expect(resolveActive(files, 'design', '3')).toBe('3');
    expect(resolveActive(files, 'design', '1')).toBe('2');
    expect(resolveActive(files, 'tb', null)).toBe('1');
    expect(resolveActive([], 'tb', '1')).toBeNull();
  });
  it('picks a neighbour after delete', () => {
    expect(neighborAfterDelete(files, '3')).toBe('4');
    expect(neighborAfterDelete(files, '4')).toBe('3');
    expect(neighborAfterDelete(files, '1')).toBeNull();
  });
});

describe('sanitizeDoc', () => {
  it('rejects malformed data', () => {
    expect(sanitizeDoc(null)).toBeNull();
    expect(sanitizeDoc({ files: 'x' })).toBeNull();
    expect(sanitizeDoc({ files: [{ name: 1 }] })).toBeNull();
    expect(sanitizeDoc({ files: [{ name: 'a.sv', content: '' }, { name: 'A.sv', content: '' }] })).toBeNull();
  });
  it('repairs missing fields', () => {
    const d = sanitizeDoc({ files: [{ name: 'a.sv', content: 'x', pane: 'weird' }] });
    expect(d?.files[0].pane).toBe('design');
    expect(d?.files[0].id).toBeTruthy();
    expect(d?.title).toBe(DEFAULT_TITLE);
    expect(d?.settings.simulator).toBe('icarus');
  });
});

describe('misc', () => {
  it('classifies errors', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('offline');
    expect(classifyError(new Error('502 Bad Gateway'))).toBe('offline');
    expect(classifyError(new Error('Playground 不存在'))).toBe('notfound');
    expect(classifyError(new Error('404 Not Found'))).toBe('notfound');
    expect(classifyError(new Error('文件名重复'))).toBe('other');
  });
  it('formats durations and bytes', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(1234)).toBe('1.23 s');
    expect(formatDuration(12_345)).toBe('12.3 s');
    expect(formatDuration(125_000)).toBe('2:05');
    expect(formatBytes(10)).toBe('10 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
  it('template is a valid two-pane doc', () => {
    const t = templateDoc();
    expect(t.files.map((f) => f.pane).sort()).toEqual(['design', 'tb']);
    for (const f of t.files) expect(validateFileName(f.name, [])).toBeNull();
  });
});
