# 组件写法

所有片段都基于 [tokens.css](tokens.css) 的变量。类名只是示例，可按项目习惯改名，但数值保持一致。

## 目录

- 布局：页面骨架、顶栏、侧栏、页面大标题
- 容器：卡片、浮动工具栏、侧边窗格
- 控件：按钮、分段控件、输入框、标签页
- 列表与状态：列表行、状态标记、空状态、数字卡
- 弹层：对话框、大面板、菜单、提示
- 首页：问候大标题、搜索胶囊、新建卡片、横向卡片流、流体背景
- Tailwind 对照、深色模式

## 布局

**页面骨架**：背景 `--bg`（#f5f5f7），内容放在白卡片里，卡片之间留 12–16px。编辑器类应用：顶栏 54px → 浮动工具栏（左右 12px 外边距）→ 主体 → 30px 透明状态栏。

**顶栏**（背景同页面，无边框）：
```css
.titlebar { height: 54px; display: flex; align-items: center; gap: 14px; padding: 0 14px; background: var(--bg); }
.logo-mark { width: 30px; height: 30px; border-radius: 9px; background: var(--ink); color: var(--ink-text);
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 17px; letter-spacing: -.04em; }
/* Logo 旁两行字：上 15px/600 名称，下 11px 灰色副名 */
.tb-round { width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--panel); box-shadow: var(--shadow-card); }
.tb-round:hover { box-shadow: var(--shadow-lift); }
```

**侧栏**（macOS 风格）：宽 224–232px，背景 `#fbfbfd`，右侧 1px `--line`；分组标题 12px/500 `--text-3`；项 38px 高、10px 圆角、14px 字。
```css
.nav-item:hover  { background: var(--hover); }
.nav-item.active { background: var(--primary-soft); color: var(--primary); font-weight: 500; }
/* 计数徽标：红底白字胶囊 min-width 20px，只用于"待处理"这种状态 */
```

**页面大标题**：32px / 600 / `letter-spacing: -.03em`；说明文字 15px `--text-2`，最多两行；操作按钮放右侧对齐底部。

## 容器

```css
.card { background: var(--panel); border-radius: var(--r-lg); box-shadow: var(--shadow-card); }   /* 无边框 */
.card-header { padding: 20px 24px 16px; }  .card-title { font-size: 17px; font-weight: 600; letter-spacing: -.02em; }
.card-body { padding: 0 24px 24px; }
/* 浮动工具栏（Ribbon）：同卡片，margin: 8px 12px 0；分组之间用 1px 短竖线，不用整高边框 */
/* 侧边窗格：width 284px; margin: 10px 12px 10px 0; 同卡片；进场 translateX(16px)→0 */
```
文档纸张（A4）在 `--canvas`（#f0f0f3）上，纸张 3px 圆角、柔和投影 `0 14px 40px -18px rgba(0,0,0,.28)`。

## 控件

```css
/* 按钮：胶囊。主要=蓝，次要=灰底，幽灵=蓝字，危险=红字 */
.btn         { height: 32px; padding: 0 18px; border: 0; border-radius: 99px; font-weight: 500; background: var(--fill); }
.btn:hover   { background: var(--fill-hover); }
.btn-primary { background: var(--primary); color: #fff; }  .btn-primary:hover { background: var(--primary-hover); }
.btn-ghost   { background: transparent; color: var(--primary); }  .btn-ghost:hover { background: var(--primary-soft); }
.btn-danger  { background: transparent; color: var(--danger); }   .btn-danger:hover { background: var(--danger-bg); }

/* 分段控件：灰槽 + 白块 */
.seg { display: inline-flex; padding: 3px; border-radius: 99px; background: var(--fill); }
.seg button { height: 28px; padding: 0 14px; border: 0; border-radius: 99px; background: transparent; color: var(--text-2); font-weight: 500; }
.seg button.active { background: var(--panel); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.12); }

/* 输入框：浅灰描边，聚焦蓝色光圈 */
.input { height: 32px; padding: 0 12px; border: 1px solid #d2d2d7; border-radius: 10px; }
.input:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(0,113,227,.15); }

/* 工具栏页签：选中 = 浅蓝底 + 蓝字；"文件"类入口 = 蓝色胶囊 */
.tab.active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
/* 工具按钮开关态同上；图标用 lucide，strokeWidth 1.75，颜色 --text-2，悬停变 --text */
```
多文档标签栏 = 分段控件的放大版：灰槽里放胶囊标签，当前标签为白块；每个标签前 18px 纯色小方块图标。

## 列表与状态

```css
.row { height: 54px; padding: 0 12px; border-radius: 12px; display: grid; align-items: center; }
.row:hover { background: var(--panel-2); }
.row .actions { opacity: 0; } .row:hover .actions { opacity: 1; }   /* 操作按钮悬停才出现 */
.app-ico { width: 34px; height: 34px; border-radius: 10px; color: #fff; }  /* 纯色小方块，无阴影 */
```
- **状态标记**：7px 小圆点 + 13px/500 文字，颜色用状态色，不用色块背景。
- **空状态**：居中图标（34px，strokeWidth 1.4，透明度 .6）+ 一句 14px `--text-3` 文案。
- **数字卡**：13px/500 灰标签 → 28px/600 数字（`-.03em`，tabular-nums）→ 13px 灰说明。
- 表头：小号灰字 `--text-3`、500 字重；行之间 1px `--line`。

## 弹层

```css
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.3); backdrop-filter: blur(3px); }
.dialog  { background: var(--panel); border-radius: 22px; box-shadow: var(--shadow); animation: popIn .18s ease-out; }
.dialog-title { font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
.close-x { width: 28px; height: 28px; border-radius: 50%; background: var(--fill); }
```
- **确认框**：居中 380px；顶部 48px 圆形图标（浅蓝底蓝图标，危险操作用 `--danger-bg` + `--danger`）；底部两个等宽按钮（取消=灰，确定=蓝/红）。回车确定，Esc/点遮罩取消。
- **大面板**（如"文件"菜单）：960×620 白卡片，左侧 224px 侧栏（`#fbfbfd`），右侧内容；小标题用 11px/600 灰色大写英文标签 + 28px/600 中文标题。
- **菜单**：白卡片 14px 圆角，`--shadow-pop`，项 32px 高 8px 圆角，**悬停整行蓝底白字**（macOS）。
- **提示 toast**：顶部居中深色胶囊 `rgba(29,29,31,.92)` 白字，左侧 7px 状态圆点，弹性弹入。

## 首页

- **问候 + 大标题**：问候 18px/500 灰 + 挥手 emoji；标题 clamp(32px,5vw,52px)/600/`-.03em`，其中一个关键词用 `color: var(--primary)` 点亮（不要渐变文字）。
- **搜索胶囊**：620px 宽白卡片、99px 圆角；左搜索图标，右侧 `/` 快捷键提示 + 蓝色胶囊主按钮。
- **新建卡片**：三列网格；50px 纯色图标方块（14px 圆角）+ 17px/600 名称 + 13px 灰说明 + 右侧灰色圆形加号（悬停变蓝并旋转 90°）。
- **横向卡片流**：`overflow-x:auto` 隐藏滚动条，两端 `mask-image` 渐隐，鼠标可拖动；卡片悬停上浮 3px。
- **分节标题**：11px/600 灰色英文标签（`letter-spacing:.12em`）+ 22px/600 中文标题，右侧放分段控件筛选。
- **背景**：可选 [assets/fluid.js](assets/fluid.js) 单色蓝雾流体 + 底部超大 2.5% 透明度的英文水印字。
  ```js
  import { createFluid } from './fluid.js';
  const canvas = h('canvas', { class: 'home-fluid' });          // position:absolute; inset:0; pointer-events:none
  const fluid = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : createFluid(canvas, homeRoot);
  fluid?.start();   // 离开首页时 fluid.stop()，节省性能
  ```

## Tailwind 对照（React / Next 项目）

```txt
卡片      rounded-[20px] bg-white shadow-[var(--shadow-card)]
主要按钮  rounded-full bg-[var(--primary)] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[var(--primary-hover)]
次要按钮  rounded-full bg-[var(--fill)] text-[#1d1d1f] hover:bg-[#dedee3]
选中导航  bg-[var(--primary-soft)] text-[var(--primary)] font-medium rounded-[10px]
分段控件  rounded-full bg-[var(--fill)] p-[3px]；选中项 bg-white shadow-[0_1px_3px_rgba(0,0,0,.12)]
大标题    text-[32px] font-semibold tracking-[-0.03em]
弹窗遮罩  bg-black/30 backdrop-blur-[3px]；弹窗 rounded-[22px] bg-white
```
把 tokens.css 的 `:root` 变量放进 `globals.css`，用 `@theme inline` 映射字体即可。

## 深色模式

只切 `<html data-theme="dark">`，组件不写任何 `dark:` 特例（个别白色内容区如文档纸张、表格网格、幻灯片保持白色）。切换按钮放顶栏右侧圆形按钮，图标 moon/sun，状态存 localStorage。
