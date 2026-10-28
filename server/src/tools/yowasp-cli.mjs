#!/usr/bin/env node
// 在子进程中运行 YoWASP（WebAssembly 版 Yosys / nextpnr / icepack / ecppack）。
// 用法：node --experimental-wasm-exnref yowasp-cli.mjs <tool> [args...]
// 当前工作目录中的全部文件会映射进 WASM 虚拟文件系统，运行结束后把新建/修改的文件写回磁盘。
import fs from 'node:fs';
import path from 'node:path';

const TOOLS = {
  yosys: ['@yowasp/yosys', 'runYosys'],
  'nextpnr-ice40': ['@yowasp/nextpnr-ice40', 'runNextpnrIce40'],
  icepack: ['@yowasp/nextpnr-ice40', 'runIcepack'],
  icepll: ['@yowasp/nextpnr-ice40', 'runIcepll'],
  'nextpnr-ecp5': ['@yowasp/nextpnr-ecp5', 'runNextpnrEcp5'],
  ecppack: ['@yowasp/nextpnr-ecp5', 'runEcppack'],
};

const [tool, ...args] = process.argv.slice(2);
if (!TOOLS[tool]) {
  process.stderr.write(`yowasp-cli: unknown tool "${tool}"\n`);
  process.exit(2);
}

function readTree(dir) {
  const tree = {};
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) tree[ent.name] = readTree(p);
    else if (ent.isFile()) tree[ent.name] = new Uint8Array(fs.readFileSync(p));
  }
  return tree;
}

function writeTree(dir, tree, before) {
  for (const [name, value] of Object.entries(tree ?? {})) {
    const p = path.join(dir, name);
    if (value instanceof Uint8Array || typeof value === 'string') {
      const old = before?.[name];
      const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
      if (old instanceof Uint8Array && Buffer.compare(Buffer.from(old), bytes) === 0) continue;
      fs.writeFileSync(p, bytes);
    } else if (value && typeof value === 'object') {
      fs.mkdirSync(p, { recursive: true });
      writeTree(p, value, before?.[name]);
    }
  }
}

const [pkg, fn] = TOOLS[tool];
const mod = await import(pkg);
const cwd = process.cwd();
const input = readTree(cwd);
const write = (stream) => (bytes) => {
  if (bytes) stream.write(bytes);
};

let exitCode = 0;
let output;
try {
  output = await mod[fn](args, input, {
    stdout: write(process.stdout),
    stderr: write(process.stderr),
    decodeASCII: false,
    fetchProgress: () => {},
  });
} catch (e) {
  if (e && typeof e.code === 'number' && e.files) {
    exitCode = e.code;
    output = e.files;
  } else {
    process.stderr.write(`yowasp-cli: ${e?.stack ?? e}\n`);
    exitCode = 1;
  }
}
if (output) writeTree(cwd, output, input);
process.exitCode = exitCode;
