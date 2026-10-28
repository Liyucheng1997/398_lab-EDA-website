# WebEDA

网页版 HDL 仿真与 FPGA 设计平台：一半像 EDA Playground，一半像在线 Vivado。全部工具链都是开源的，Yosys / nextpnr 以 WebAssembly 形式随 npm 安装。

## 功能

**Playground**（类 EDA Playground）

- 测试平台 + 设计代码双栏编辑（Monaco，Verilog / SystemVerilog 高亮），多文件
- Icarus Verilog 仿真，Ctrl+Enter 运行，日志实时推送
- 波形查看器（类 EPWave）：信号树、缩放平移、光标与标记、多种进制、总线展开
- Yosys + netlistsvg 生成 RTL 原理图
- 保存、分享链接、复制；内置 22 个示例

**Studio**（类 Vivado）

- 工程管理：Flow Navigator、源文件树、Project Summary、Tcl Console（Yosys）、Messages、Reports、Design Runs
- RTL 分析 → 综合 → 布局布线 → 生成比特流
- 资源利用率与时序报告（Fmax、WNS、关键路径）
- 器件视图：FPGA 网格上的布局与布线
- 虚拟开发板：在浏览器里做门级仿真，带 LED、开关、按键、数码管、串口终端
- 板卡模板：iCEBreaker、iCEstick、iCE40-HX8K、ULX3S、Basys3、Tang Nano 9K、虚拟开发板

| 器件系列 | 综合 | 布局布线 + 比特流 |
| --- | --- | --- |
| Lattice iCE40（HX1K / HX8K / UP5K） | ✓ | ✓ |
| Lattice ECP5（25F / 85F） | ✓ | ✓ |
| Xilinx Artix-7 | ✓ | — |
| Gowin GW1NR-9 | ✓ | — |

Xilinx 和 Gowin 的布局布线开源工具链暂不支持，只提供综合与资源估算。

## 运行

依赖：

- Node.js ≥ 22
- Icarus Verilog（Windows：`choco install iverilog`；macOS：`brew install icarus-verilog`；Linux：`apt install iverilog`），也可以用 `IVERILOG_BIN` 环境变量指定目录

```bash
npm install
npm run dev
```

打开 http://localhost:5173 。服务端在 3001 端口，前端开发服务器把 `/api` 代理过去。

生产模式：

```bash
npm run build
npm start
```

服务端会直接托管 `client/dist`，访问 http://localhost:3001 。

## 测试

```bash
npm test                              # 服务端 + 前端单元/集成测试
npx tsx server/src/examples/verify.ts # 逐个验证内置示例的仿真、综合、布局布线、比特流
```

## 安全说明

用户提交的 HDL 会在服务器上编译运行。目前有超时、日志与产物大小上限、编译参数白名单和路径检查，但没有进程级隔离。适合本机或可信的小范围使用；如需公网部署，请把任务放进容器沙箱里执行。

## 结构

见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 许可

各 EDA 工具遵循各自的开源许可（Icarus Verilog：GPL；Yosys / nextpnr：ISC；netlistsvg：MIT）。
