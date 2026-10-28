# WebEDA 架构

网页版 HDL 仿真与 FPGA 设计平台：**Playground**（类 EDA Playground：写 Verilog/SV + 测试平台 → Icarus 仿真 → 波形）和 **Studio**（类 Vivado：工程 → RTL 分析 → 综合 → 实现 → 比特流 → 虚拟开发板）。

## 目录

```
shared/src/        前后端共享类型（唯一契约）
  api.ts           REST/SSE 接口、Job 请求与结果、报告结构
  devices.ts       器件、板卡、约束生成
  netlist.ts       门级网表格式（虚拟开发板仿真）
server/src/        Node 24 + Express 5，tsx 直接运行 TS
  config.ts        路径与限额
  tools/exec.ts    运行原生 iverilog/vvp 与 WASM 工具（YoWASP yosys/nextpnr/icepack/ecppack，子进程隔离）
  tools/yowasp-cli.mjs  WASM 工具的子进程入口（把 cwd 映射进虚拟文件系统）
  jobs/            任务队列、SSE 推送、JobContext（flow 只通过它运行工具、写日志、登记产物）
  flows/           每种 JobKind 一个 flow（simulate / elaborate / synthesize / implement / gatesim / yosys）+ 解析器
  routes/          REST 路由
  storage/         JSON 文件存储（data/playgrounds、data/projects）
  examples/        内置示例与工程模板
client/src/        React 19 + Vite + Monaco
  lib/             api 客户端、useJob、monaco 配置、主题
  ui/              通用 UI：SplitPane、Modal、toast、StatusDot
  features/editor  CodeEditor（Monaco 封装）、LogConsole、DiagnosticList
  features/waveform  波形查看器（VCD 解析 + Canvas）
  features/schematic 原理图查看器（netlistsvg SVG 平移缩放）+ 器件视图
  features/board     虚拟开发板（浏览器内门级仿真）
  pages/home | playground | studio
```

## 关键约定

- 前后端只通过 `@webeda/shared` 中的类型通信。
- 每个功能模块只通过 `features/<x>/index.tsx` 对外导出组件；页面只从 index 引入。
- 样式：苹果式简约设计语言（`client/src/styles/tokens.css` + `app.css`，组件写法见 `docs/design-components.md`）。只有一个主题色 `--primary`，红/橙/绿只表达状态；颜色只引用 CSS 变量；深色模式靠 `html[data-theme=dark]` 切换变量。模块私有样式放各自目录，类名带前缀。
- 图标统一用 `lucide-react`，`strokeWidth={1.75}`。
- 界面文字用中文，EDA 专业术语保留英文（Fmax、LUT、WNS 等）。
- Node 运行 WASM 工具需要 `--experimental-wasm-exnref`（exec.ts 已处理）。

## 运行

```bash
npm install
npm run dev        # server :3001 + client :5173（/api 代理到 server）
```

依赖：Node ≥ 22、Icarus Verilog（`iverilog`/`vvp`，Windows 可 `choco install iverilog`，或设置 `IVERILOG_BIN`）。Yosys / nextpnr 以 WebAssembly 形式随 npm 安装，无需额外安装。
