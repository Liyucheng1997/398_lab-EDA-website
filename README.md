# WebEDA

网页版 HDL 仿真与 FPGA 设计平台：一半像 EDA Playground，一半像在线 Vivado。全部工具链都是开源的，Yosys / nextpnr 以 WebAssembly 形式随 npm 安装。

在线页面：https://liyucheng1997.github.io/398_lab-EDA-website/

> GitHub Pages 只托管前端：可以浏览界面、编辑代码，但仿真、综合、布局布线、示例列表都需要 WebEDA 服务端。完整功能请按下面的步骤在本机运行，或参考「部署」一节连接自己的服务端。

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

**PCB**（AI 电路板设计）

- 用一句话描述需求（如「NE555 闪灯板，5 V 排针供电」），Claude Fable 5.2 自己完成电路设计、元件选型、布局、布线和 DRC，过程中不需要人参与
- AI 通过一组工具操作电路板：定义板框、放置元件、定义网络、自动布线、手工走线、打过孔、运行 DRC；收工时 DRC 仍有错误会被自动要求继续修复
- 内置双层板 A* 自动布线器、设计规则检查（连通性、间距、短路、元件重叠、板框、安装孔）和参数化封装库（阻容、SOT、SOIC、TSSOP、TQFP、DIP、排针、端子等，AI 也可以自定义封装）
- 板图查看器：图层开关、按网络高亮、飞线与 DRC 标记；可在现有设计上继续用自然语言修改
- 导出板图 SVG、物料清单 CSV、设计数据 JSON

这个功能需要 Claude API 凭据（见下文「AI 电路板设计」）。没有凭据时仍可加载内置示例板查看界面。

> 思路来自 Anthropic 2026 年 11 月的研究文章 [Claude can design electronic prototypes from start to finish](https://www.anthropic.com/research/claude-electronics-design)。那是一项研究实验，没有对应的现成 API；这里是用 Claude API 的工具调用自行实现的简化版。生成的是原型设计：不做电气仿真，封装为标称尺寸，没有铺铜，暂不支持导出 KiCad / Gerber，投板前需要人工核对。

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

## AI 电路板设计

在启动服务端之前设置 Claude API 密钥（在 [Claude Console](https://platform.claude.com/) 创建）：

```bash
export ANTHROPIC_API_KEY=你的密钥   # PowerShell：$env:ANTHROPIC_API_KEY = "你的密钥"
npm run dev
```

然后打开 http://localhost:5173/pcb 。

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Claude API 密钥；只在服务端使用，不会发给浏览器 |
| `WEBEDA_AI_MODEL` | `claude-fable-5-2` | 使用的模型（需要支持自适应思考的当前模型，如 `claude-opus-5-5`） |
| `WEBEDA_AI_EFFORT` | `high` | 推理力度：`low` / `medium` / `high` / `xhigh` / `max` |
| `WEBEDA_AI_MAX_TURNS` | `40` | 单次设计最多调用模型的轮数 |

注意：

- 每次设计都会消耗 API 额度（Fable 5.2 为每百万 token 输入 $8、输出 $40），复杂的板子一次可能要运行几分钟。界面左下角会显示本次用掉的 token 数。
- 请求默认开启了服务端回退（`fallbacks: "default"`）：安全分类器误拒时由 Anthropic 换模型重跑同一请求，实际作答的模型会显示在界面上。
- `/api/pcb/runs` 没有鉴权，任何能访问服务端的人都能消耗你的额度。不要在没有访问控制的公网服务端上配置密钥。

## 部署

推送到 `main` 后，GitHub Actions（`.github/workflows/pages.yml`）会自动构建前端并发布到 GitHub Pages。

如果想让 Pages 上的页面能用完整功能，需要把服务端部署到一台有公网地址的机器上，然后：

1. 在服务端设置环境变量 `WEBEDA_CORS_ORIGIN=https://liyucheng1997.github.io`，允许 Pages 页面跨域访问。
2. 在仓库 Settings → Secrets and variables → Actions → Variables 添加 `WEBEDA_API_BASE`，值为服务端地址（如 `https://eda.example.com`），再重新运行 Pages 工作流。

构建时可用的环境变量：

| 变量 | 作用 |
| --- | --- |
| `VITE_BASE` | 前端部署的子路径，Pages 上为 `/398_lab-EDA-website/` |
| `VITE_API_BASE` | 后端地址；为空时与前端同源 |

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
