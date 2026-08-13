# FVP 剧情编辑器 —— 推进计划与进度盘点

> 文档状态：持续推进中。本文档是唯一的进度盘点与推进依据。
> 姊妹文档：总体计划 [`fvp-hcb-editor-plan.md`](plans/fvp-hcb-editor-plan.md:1)、需求/工作流/UI 设计 [`editor-requirements-and-workflow.md`](plans/editor-requirements-and-workflow.md:1)、M1 关键发现 [`m1-progress-and-findings.md`](plans/m1-progress-and-findings.md:1)。

---

## 0. 当前进度总览

| 层 | 状态 | 说明 |
|---|---|---|
| 计划 / 设计文档 | ✅ 完成 | 总体计划 + 需求/工作流/UI 设计 + 进展记录 |
| M1 领域层（hcb / compiler / CLI） | ✅ 完成 | Sakura.hcb round-trip 字节级 100%；`lower → assemble → encode(融合 layout+relocate)` 走通；合成测试固化 |
| M4-1 底座表数据化 + 导出编译 | 🟡 基本完成 | `extract-base` 提取 sysdesc(148 syscalls)+31 角色；`loadBaseGame/compileProject`；AppShell「导出 .hcb」；待背景表 + raw 补丁 |
| M2-1 协议 schema | ✅ 完成 | [`protocol.ts`](hcb-editor/packages/rfvp/src/protocol.ts:1) zod 定义 + `PROTOCOL_VERSION=1` |
| M2-2 FakeEngine | ✅ 完成 | [`fake-engine.ts`](hcb-editor/packages/rfvp/src/fake-engine.ts:1) 脚本驱动 + 事件回放，3 单测 |
| M2-3 rfvp-cli（Rust）+ Electron 薄壳 | 🟡 rfvp-cli 已建 / 桥接待接 | rfvp 以 git submodule 集成（[`vendor/rfvp`](hcb-editor/vendor/rfvp/README.md:1)）；rfvp-cli（Rust）已构建、可 boot 真实 HCB 并输出 prim；contextBridge + RfvpProcessManager + UI 接入待做 |
| M2-4 预览面板（Pixi） | 🟡 基本完成 | Pixi 自绘 prim + 文本覆盖 + G[] 面板 + 点击推进 + 跳过 + label 断点；立绘占位带角色名、画布自适应右栏宽度；缺真实 Event 回放 |
| M3-S1 editor 包（命令集/状态层） | ✅ 完成 | 文档模型（START/END + startNodeId）+ 资源表 + 底座注册表 + 命令集 + 连线校验 + undo/redo + 可达性投影 + 工程文件序列化，30 单测 |
| M3-S2 ui 包（React Flow） | 🟡 主体完成 | 主题/三栏 AppShell（左右栏加宽）/FlowCanvas/NodeCard/属性面板(全节点)/剧本文本/时间线/调色板(图标化)/资源管理器(卡片可视化)/新建向导/设置/保存打开/空画布引导，11 单测 |
| M4 投影 / 补丁 / 迁移 | 🟡 大部分完成 | 剧本文本 + 时间线投影、raw 只读占位、IR 序列化 + schemaVersion 迁移、工程文件契约已落地；缺 raw 补丁 / 导出编译 |
| 测试基建（Storybook + Playwright） | ✅ 完成 | ui 组件库 8 stories + e2e 冒烟 6 用例（chromium，FakeEngine 兜底） |
| Electron 薄壳（desktop） | ✅ 可预览 | 主进程加载 Vite 演示壳，`dev` 一键拉起 vite + electron；真实引擎（rfvp-cli + contextBridge）留待 S4 |

**核心研判不变**：最险的领域部分（HCB 可逆转换）已 100% 达成，剩余风险集中在前端收尾、真实引擎封装与底座数据化。

---

## 1. 已落地明细

### M1（✅）—— 领域层
- `packages/hcb`：opcode 表（含 0x25=set_ge / 0x27=set_le 修正）、二进制读写、NLS、头部、指令流、CFG、反编译、syscalls 数据、IR 类型。
- IR 契约与序列化：[`types.ts`](hcb-editor/packages/hcb/src/ir/types.ts:1)（zod + `IR_SCHEMA_VERSION=1`）、[`serialize.ts`](hcb-editor/packages/hcb/src/ir/serialize.ts:1)（raw bytes ↔ base64）、[`migrate.ts`](hcb-editor/packages/hcb/src/ir/migrate.ts:1)（schemaVersion 门禁）。
- `packages/compiler`：五段式入口 [`compile.ts`](hcb-editor/packages/compiler/src/passes/compile.ts:1)（实际为 `lower → assemble → encode(融合)`）、模板 [`speak/bgset/bsset/selset`](hcb-editor/packages/compiler/src/templates/)。
- `packages/apps/cli`：`decompile / compile / roundtrip` 三命令。
- 验收：Sakura.hcb（5,002,575 字节，966,366 指令）decode→encode 字节级一致；compiler 3 单测。

### M2（✅ 协议 / FakeEngine；🟡 预览；⬜ 真实引擎延后）
- 协议 zod 定义 + FakeEngine（脚本驱动 + 事件回放）。
- 预览面板：[`PreviewPanel.tsx`](hcb-editor/packages/ui/src/preview/PreviewPanel.tsx:1)（Pixi 懒加载自绘 prim，z/alpha/scale/rotate 一一对应）、[`buildPreviewScript.ts`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:1)（文档 → FakeScript 纯函数）。
- 可运行演示壳：[`vite.config.ts`](hcb-editor/packages/ui/vite.config.ts:1) + [`index.html`](hcb-editor/packages/ui/index.html:1) + [`main.tsx`](hcb-editor/packages/ui/src/demo/main.tsx:1)（`pnpm --filter @hcb-editor/ui dev`）。
- Electron 薄壳：新包 [`@hcb-editor/desktop`](hcb-editor/packages/apps/desktop/package.json:1)（主进程 [`main.ts`](hcb-editor/packages/apps/desktop/src/main.ts:1) + 启动器 [`launch.cjs`](hcb-editor/packages/apps/desktop/scripts/launch.cjs:1)），`pnpm --dir packages/apps/desktop run dev` 一键拉起 Vite + Electron。启动器会清除环境变量 `ELECTRON_RUN_AS_NODE`（本机该变量默认置 1，否则 electron 退化为纯 Node、`require('electron')` 返回 npm 包路径）。

### M3-S1（✅）—— editor 包
- [`state.ts`](hcb-editor/packages/editor/src/state.ts:1)：`EditorState = header + document(节点图) + resources + selection + nextId`；[`createProject()`](hcb-editor/packages/editor/src/state.ts:45)。
- [`base-games.ts`](hcb-editor/packages/editor/src/base-games.ts:1)：底座游戏注册表（默认 sakura moyu）。
- [`resources.ts`](hcb-editor/packages/editor/src/resources.ts:1)：角色/背景/音频三表模型。
- [`commands.ts`](hcb-editor/packages/editor/src/commands.ts:1)：节点 + 资源两类命令，`validateConnect/validateReconnect` 连线约束，`applyCommand` 纯函数。
- [`store.ts`](hcb-editor/packages/editor/src/store.ts:1)：Immer patches undo/redo + `subscribe/load/canUndo/canRedo`。
- [`projection.ts`](hcb-editor/packages/editor/src/projection.ts:1)：`projectToIr` / `projectScript` / `projectTimeline` / `renderCond`。
- [`project-file.ts`](hcb-editor/packages/editor/src/project-file.ts:1)：工程文件 zod 契约 + `serializeProject/deserializeProject`。

### M3-S2（🟡）—— ui 包
- 主题系统：[`tokens.css`](hcb-editor/packages/ui/src/theme/tokens.css:1)（深色默认/浅色，中性冷灰 + 单一冷色 accent）+ [`meta.ts`](hcb-editor/packages/ui/src/theme/meta.ts:1)。
- 状态绑定：[`useEditorStore.ts`](hcb-editor/packages/ui/src/store/useEditorStore.ts:1) + [`usePreferences.ts`](hcb-editor/packages/ui/src/preferences/usePreferences.ts:1)（localStorage）。
- 视图：流程图 [`FlowCanvas.tsx`](hcb-editor/packages/ui/src/flow/FlowCanvas.tsx:1)（拖拽/连线推断/删除/选中/定位）、属性面板、剧本文本、时间线、调色板、资源管理器、新建向导、设置、保存/打开工程。
- 样式：[`ui.css`](hcb-editor/packages/ui/src/styles/ui.css:1)。

### M4（🟡）—— 收尾
- ✅ 剧本文本投影（DSL 只读 + 点击定位）、时间线投影（沿当前路径线性化）、raw 只读占位块、IR schemaVersion 迁移、工程文件序列化。
- ✅ 底座表数据化 + 导出编译（sysdesc + 31 角色表；`loadBaseGame/compileProject`；AppShell「导出 .hcb」）。
- ⬜ raw 补丁模式（patchBase 拼接）、背景表数据化。

### 测试基建（✅）—— Storybook + Playwright
- Storybook：[`.storybook/main.ts`](hcb-editor/packages/ui/.storybook/main.ts:1) + [`preview.ts`](hcb-editor/packages/ui/.storybook/preview.ts:1)（react-vite 框架 + essentials）；8 个组件 story（NodeCard 全节点种类 / Palette / ScriptTextView / TimelineView / Settings / NewProjectWizard / PropertyPanel / ResourceManager），共享夹具 [`storyFixtures.ts`](hcb-editor/packages/ui/src/components/storyFixtures.ts:1)。
- Playwright：新包 [`@hcb-editor/e2e`](hcb-editor/packages/apps/e2e/package.json:1)，[`playwright.config.ts`](hcb-editor/packages/apps/e2e/playwright.config.ts:1) webServer 拉起 ui 演示壳（`dev:test` 固定 5199），[`app.spec.ts`](hcb-editor/packages/apps/e2e/src/app.spec.ts:1) 6 冒烟用例（向导创建→添加节点→属性编辑→撤销重做→切视图→资源/设置→主题）。

### UI 收尾（✅ 所见即所得补强）
- 布局：左右栏加宽（`252px / 1fr / 376px`），预览画布自适应右栏宽度不再溢出。
- 调色板：单列图标化（共享 [`KindIcon`](hcb-editor/packages/ui/src/components/KindIcon.tsx:1)），标签 + 提示不再被挤压。
- 空画布引导：新建后画布显示四步指引（[`AppShell`](hcb-editor/packages/ui/src/components/AppShell.tsx:1)）。
- 资源管理器：三表由纯表格改为卡片（头像占位 / 背景缩略图 / 音频类型徽章），技术字段（SPEAK 函数/pose/costume/face/bgFn）折叠为次要小字（[`ResourceManager.tsx`](hcb-editor/packages/ui/src/components/ResourceManager.tsx:1)）。
- 预览立绘：`FakePrim.label` 携带角色名，Pixi 占位矩形下方标注（[`PreviewPanel.tsx`](hcb-editor/packages/ui/src/preview/PreviewPanel.tsx:1)）。

### rfvp-cli（🟡 真实引擎，Rust）
- rfvp 以 **git submodule** 集成到 [`hcb-editor/vendor/rfvp`](hcb-editor/vendor/rfvp/README.md:1)（上游 https://github.com/xmoezzz/rfvp），本地补丁：`lib.rs` 暴露 `pub mod portable` + 修复 portable 模块两处 `audio().play()` 缺 `fade_in_ms` 参数。
- 新 crate [`hcb-editor/crates/rfvp-cli`](hcb-editor/crates/rfvp-cli/Cargo.toml:1)：封装 `PortableRuntime`，stdio 行分隔 JSON（hcb-editor 协议），no-op host + 渲染器捕获 `draw_solid` 作为 prim。
- 已构建并冒烟验证：`handshake → load → dump_prims → shutdown` 全通；boot 真实 Sakura.hcb 得到标题与 1280×720 分辨率。
- ⚠️ 已知限制：`PortableRuntime` 的 VM 对**完整 Sakura 脚本 tick 会失败**（`parser read_u8 out of bounds @0x36a79`，portable VM 为实验性实现）；对编辑器编译的小脚本是否可 tick 尚未验证（待用 `compileProject` 输出实测）。

### 流程图交互（✅ 删除/连线 + START/END 模型）
- 节点删除：`FlowCanvas` 补 `onNodesDelete` 派发 `remove_node`；START 节点 `deletable:false`，命令层也拒绝删除（[`commands.ts`](hcb-editor/packages/editor/src/commands.ts:117)）。属性面板新增「删除」按钮。
- 连线把手：自定义节点接入 `Handle`（[`FlowCanvas.tsx`](hcb-editor/packages/ui/src/flow/FlowCanvas.tsx:1)）——branch 有 then/else 两个源把手，thread 有 thread 源把手，其余为 next，连线才能真正拖出。
- START/END：`EditorDocument` 增加 `startNodeId`；[`createProject`](hcb-editor/packages/editor/src/state.ts:48) 自带不可删除 START + 可删 END 标记；[`projectToIr`](hcb-editor/packages/editor/src/projection.ts:100) 只纳从 START 沿所有边可达的节点并剥离 START（纯入口标记，不产出指令）。

### 测试现状（全绿）
| 包 | 测试文件 | 用例数 |
|---|---|---|
| editor | projection / store / resources / commands / project-file | 30 |
| ui | nodeSummary / buildPreviewScript / useEditorStore | 11 |
| compiler | compile / roundtrip / base / function | 9 |
| rfvp | fake-engine | 3 |
| e2e | app.spec（Playwright chromium） | 6 |
| hcb / cli | 无（`--passWithNoTests`） | 0 |

`pnpm typecheck` 12/12、`pnpm test` 12/12（含 e2e 6 用例）、`pnpm lint` 8/8、`vite build` 成功、`storybook build` 成功（148 模块）。

---

## 2. 剩余差距（按优先级）

| # | 差距 | 说明 | 阻塞因素 |
|---|---|---|---|
| 1 | **导出编译 .hcb（收尾）** | ✅ sysdesc(148)+31 角色+背景表（共享加载器 f_00037421 + 编号）已数据化，bgset 签名修正为 `push_i16 + call f_00037421`（309 命中）；UI 已接「导出 .hcb」。背景名仍为占位 `bg_<num>` | 背景真实名称需外部资源表或手工命名 |
| 2 | **raw 补丁模式** | ✅ 完成：raw 字节透传 + 重定位重算（`assembleFlat`/`encodeFlatItems`）+ patchBase 拼接（`compileWithBase`，底座库代码逐字节保留、入口指向新脚本），7 单测覆盖 | — |
| 3 | **增量编译** | ✅ 函数级编译原语已落地（[`splitIrFunctions/compileFunctionSegment`](hcb-editor/packages/compiler/src/passes/function.ts:1)，2 单测）；⬜ 地址保持式局部重编（HCB 地址连续，需 patchBase 两段拼接，实用性低）延后 | — |
| 4 | **95% 命中率（剧情节点口径）重测** | ✅ 已补 audio/thread/wait/stage(演出)/branch/call/jump/control/input 模板 + 修正 SPEAK 函数族（数据驱动自角色表），可达指令覆盖率 **41.38% → 94.49%**（hits：dia 54955 / speak 19542 / stage 5181 / call 42310 / jump 4435 / control 38662 / branch 266 / input 192 / audio 117 / thread 92 / wait 49 / selset 3 / bgset 1）。剩余 5.5% 为孤立算术/立即数及 bgset 精确签名（背景表数据化待补） | — |
| 5 | **S4 真实引擎 + Electron** | ✅ Electron 薄壳已建（desktop 包）；✅ rfvp-cli（Rust）已构建并可 boot/输出 prim；⬜ RfvpProcessManager + contextBridge + UI 接入；⬜ 小脚本 tick 验证（portable VM 对完整 Sakura tick 失败） | — |
| 6 | **Storybook + Playwright** | ✅ 完成：组件库 8 stories + e2e 冒烟 6 用例（chromium 已下载、webServer 自动拉起演示壳） | — |
| 7 | **演出块签名精确化** | Motion/Prim/GraphLoad 等签名未精确化，落入 raw 逃生舱 | 不阻塞主链路 |
| 8 | **时间线线性化精度** | 当前为拓扑排序 + 孤立节点附加，未严格沿 then/else/thread 路径展开 | 小项，需时再精确化 |

---

## 3. 已拍板决策

1. **95% 口径**：✅ 剧情节点口径（A）——只统计剧情脚本函数内调用点，库函数定义体作为底座（patchBase）原样保留。
2. **S4**：✅ 按计划延后（cargo 1.83 已确认、rfvp 源码在 `.reference_repo/rfvp/`；FakeEngine 兜底，UI 全链路可先行）。
3. **底座游戏**：✅ sakura moyu（さくら、もゆ。），新建向导可自由选择；注册表 [`base-games.ts`](hcb-editor/packages/editor/src/base-games.ts:1)，换游戏 = 加一条数据。
4. **开始/结束节点**：✅ 新建工程自带不可删除的 START（剧情入口）+ 可增删的 END 标记；剧情 = 从 START 沿所有边（next/then/else/thread）可达的节点（不强制终点、不过滤悬空分支），START 为纯标记、编译前剥离。

---

## 4. 下一步建议顺序

```text
导出编译（底座表数据化）✅
  → raw 补丁 / patchBase 拼接 ✅
  → 增量编译 ✅（地址保持式延后）
  → 95% 命中率重测（口径 A）✅ 94.49%
  → Storybook + Playwright ✅
  → S4（rfvp-cli + Electron，解冻后）⬜（Electron 薄壳已就绪，仅欠真实引擎 rfvp-cli + contextBridge）
```

剩余非阻塞小项：演出块签名精确化、时间线线性化精度、背景真实名称（需外部资源表）。

> 建议顺序内的硬骨头均已攻克（底座表数据化、raw 补丁、增量编译、95% 命中率、Storybook/Playwright）；Electron 薄壳已可打开做界面预览。剩余唯一大项是解冻后的 S4 真实引擎封装（rfvp-cli + contextBridge），其余为不阻塞主链路的收尾小项（演出块签名精确化、时间线线性化精度、背景真实名称）。
