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
| M2-3 rfvp-cli（Rust）+ Electron 薄壳 | ✅ 完整闭环 | rfvp 以 git submodule 集成（[`vendor/rfvp`](hcb-editor/vendor/rfvp/README.md:1)）；rfvp-cli 可 boot + tick 编译产物（portable VM 未实现 syscall 已 no-op 兜底）；contextBridge + RfvpProcessManager + RfvpClient + PreviewPanel 接入完成，compileWithBase 打通可运行导出 |
| M2-4 预览面板（Pixi） | 🟡 基本完成 | Pixi 自绘 prim + 文本覆盖 + G[] 面板 + 点击推进 + 跳过 + label 断点；立绘占位带角色名、画布自适应右栏宽度；缺真实 Event 回放 |
| M3-S1 editor 包（命令集/状态层） | ✅ 完成 | 文档模型（START/END + startNodeId）+ 资源表 + 底座注册表 + 命令集 + 连线校验 + undo/redo + 可达性投影 + 工程文件序列化，30 单测 |
| M3-S2 ui 包（React Flow） | 🟡 主体完成 | 主题/三栏 AppShell（左右栏加宽）/FlowCanvas/NodeCard/属性面板(全节点)/剧本文本/时间线/调色板(图标化)/资源管理器(卡片可视化)/新建向导/设置/保存打开/空画布引导，11 单测 |
| M4 投影 / 补丁 / 迁移 | 🟡 大部分完成 | 剧本文本 + 时间线投影、raw 只读占位、IR 序列化 + schemaVersion 迁移、工程文件契约已落地；缺 raw 补丁 / 导出编译 |
| 测试基建（Storybook + Playwright） | ✅ 完成 | ui 组件库 8 stories + e2e 冒烟 6 用例（chromium，FakeEngine 兜底） |
| Electron 薄壳（desktop） | ✅ 真实引擎桥已接 | 主进程加载 Vite 演示壳 + preload 暴露 `window.rfvp`；`dev` 一键拉起 vite + electron；真实引擎经 rfvp-cli 惰性拉起，渲染层缺桥/编译失败/引擎报错时自动回退 FakeEngine |

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

### rfvp-cli（✅ 真实引擎，Rust）+ 引擎桥（✅ 接入 / ⚠️ tick 待补底座）
- rfvp 以 **git submodule** 集成到 [`hcb-editor/vendor/rfvp`](hcb-editor/vendor/rfvp/README.md:1)（上游 https://github.com/xmoezzz/rfvp），本地补丁：`lib.rs` 暴露 `pub mod portable` + 修复 portable 模块两处 `audio().play()` 缺 `fade_in_ms` 参数。
- 新 crate [`hcb-editor/crates/rfvp-cli`](hcb-editor/crates/rfvp-cli/Cargo.toml:1)：封装 `PortableRuntime`，stdio 行分隔 JSON（hcb-editor 协议），no-op host + 渲染器捕获 `draw_solid` 作为 prim。
- 已构建并冒烟验证：`handshake → load → dump_prims → shutdown` 全通；boot 真实 Sakura.hcb 得到标题与 1280×720 分辨率。
- Electron 主进程：新 [`rfvp-process-manager.ts`](hcb-editor/packages/apps/desktop/src/rfvp-process-manager.ts:1)（惰性 spawn rfvp-cli + 行分隔 JSON IO + `load` 落盘临时 .hcb 并等待 ready/error）＋ [`ipc.ts`](hcb-editor/packages/apps/desktop/src/ipc.ts:1)（`rfvp:load/advance/step/skip/dump-prims/shutdown` handle + 事件广播）＋ [`preload.ts`](hcb-editor/packages/apps/desktop/src/preload.ts:1)（`window.rfvp` 桥）。
- 渲染层：新 [`RfvpClient.ts`](hcb-editor/packages/ui/src/preview/RfvpClient.ts:1) + [`rfvpBridge.ts`](hcb-editor/packages/ui/src/preview/rfvpBridge.ts:1)；[`PreviewPanel.tsx`](hcb-editor/packages/ui/src/preview/PreviewPanel.tsx:1) 编译 IR→HCB 后经桥装载，prim 事件驱动 Pixi，缺桥/编译失败/引擎报错自动回退 FakeEngine；文本队列始终由投影提供。
- ⚠️ **tick 实测结论（2026-08-13）**：用编辑器 `compileProject` 产出的小脚本（ハル speak + dia）经 rfvp-cli **boot 成功**（`ready` + title + screenSize `[1280,720]`），但 `advance` 触发 `call target 0xb86(=speakFn 2950) outside code area` → tick `Backend` 失败。根因：`compileProject` 走 `compile`（仅脚本代码区，入口 4），而 speak 模板 `call` 指向底座库函数（角色表 speakFn），该库代码不在产物内；需 `compileWithBase`（patchBase 拼接底座库）或引擎侧提供底座库，方可真实 tick。桥接层已就绪，真实执行留待补底座库。

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

## 2. 差距总盘点（按优先级 P0→P3）

> 口径：`✅ 已落地` / `🟡 部分` / `⬜ 待做`。P0 = 阻断创作闭环，P1 = 主工作流体验，P2 = 补全与精度，P3 = 锦上添花。

### P0 —— 阻断「新建 → 编辑 → 预览 → 导出」闭环

| # | 差距 | 状态 | 说明 |
|---|---|---|---|
| G1 | **可运行导出 + 真实引擎执行** | ✅ | [`compileProject`](hcb-editor/packages/compiler/src/base/index.ts:119) 支持 `{ baseData }` → 走 [`compileWithBase`](hcb-editor/packages/compiler/src/passes/compile.ts:27)（底座库代码逐字节保留 + 新脚本追加、入口指向新脚本）；[`compileEditorState`](hcb-editor/packages/ui/src/preview/compileFromState.ts:1) 统一编排导出与预览。实测小脚本（ハル speak+dia）与新增角色脚本均 boot + tick 到 done、零 error |
| G1a | **底座库二进制加载桥** | ✅ | Electron 主进程 [`registerBaseGameIpc`](hcb-editor/packages/apps/desktop/src/ipc.ts:24) 读本地原版 HCB（默认 auto-discovery `.reference_repo/...`，可传 `path`），preload 暴露 `window.baseGame`；渲染层 [`loadBaseBinary`](hcb-editor/packages/ui/src/preview/baseBinary.ts:1) 无桥时返回 null（浏览器退化脚本-only） |
| G2 | **新增资源函数定义体 `emitFunctionDef`** | ✅ | [`function-gen.ts`](hcb-editor/packages/compiler/src/base/function-gen.ts:1) 克隆模板角色 SPEAK 函数体、替换名字与 styleIndex、按绝对地址重编码；[`compileProject`](hcb-editor/packages/compiler/src/base/index.ts:140) 对 `extraCharacters` 生成函数并注册地址；背景走共享加载器仅分配编号。实测新角色「小明」脚本 boot + tick 到 done |
| G8 | **资源引用校验 + 名字选择器** | ✅ | 属性面板 speak/bsset 角色、bgset 背景改为 `<input list>` + `<datalist>`（底座角色/背景 + 工程资源合并候选，仍可自由输入）；[`PropertyPanel.tsx`](hcb-editor/packages/ui/src/components/PropertyPanel.tsx:1) 用 `availableBaseCharacters/Backgrounds` 提供候选 |
| G10 | **资源管理器新增条目与编译联动** | ✅ | [`compileEditorState`](hcb-editor/packages/ui/src/preview/compileFromState.ts:1) 将资源表中 `speakFn/bgFn === null` 的条目作为 `extraCharacters/extraBackgrounds` 传入编译（新增角色生成函数体、新增背景分配编号） |

### P1 —— 主工作流体验

| # | 差距 | 状态 | 说明 |
|---|---|---|---|
| G3 | **背景表数据化 + 背景真实名称** | 🟡 阻塞 | 调研结论：`.reference_repo` 的 `hcb_build.py bg_list` 编号与 `extract-base` 从真实 Sakura.hcb 扫出的资源编号（240/241/…）**不一致**，真实背景名需外部资源清单（游戏档案文件列表），当前无干净来源；资源管理器已可手工改名兜底 |
| G6 | **validate 层（编译前诊断）** | ✅ | [`validate.ts`](hcb-editor/packages/hcb/src/validate/index.ts:1) `validateIr`（重复 label + branch/thread/jump/selset 悬空引用）；[`compileEditorState`](hcb-editor/packages/ui/src/preview/compileFromState.ts:1) 编译前校验并抛结构化错误，3 单测 |
| G9 | **jump 节点** | ✅ | IrNode 增加 `jump{target}` + EdgeKind `jump` + [`lower`](hcb-editor/packages/compiler/src/passes/lower.ts:1) 发 `jmp` + 调色板/FlowCanvas/PropertyPanel/DSL 全链 + 连线端点校验，2 单测 |
| G18 | **Electron 原生文件对话框** | ✅ | [`registerFileDialogIpc`](hcb-editor/packages/apps/desktop/src/ipc.ts:25)（saveTextFile/saveBinaryFile/openTextFile）+ preload `window.fileDialog` + [`fileDialog.ts`](hcb-editor/packages/ui/src/fileDialog.ts:1)（Electron 原生对话框，浏览器 Blob/input 兜底）+ AppShell 接入 |
| G11 | **真实引擎预览启用** | ✅ | 桥接层已接（RfvpProcessManager + contextBridge + RfvpClient + PreviewPanel，缺桥自动回退）；G1 完成后 tick 已通。⚠️ 额外打通了一个隐藏阻断：portable VM 原生桥对未实现演出类 syscall（TextPrint/TextClear/ColorSet/Motion* 等）已改为 no-op 兜底（[`native_bridge.rs`](hcb-editor/vendor/rfvp/crates/rfvp/src/portable/native_bridge.rs:176)），否则 tick 会以 `Unsupported` 中断线程 |

### P2 —— 补全与精度

| # | 差距 | 状态 | 说明 |
|---|---|---|---|
| G4 | **95% 剩余 5.5%** | 🟡 | 孤立算术/立即数 + bgset 精确签名（背景表数据化待补）。bgset 精确签名依赖 G3 |
| G5 | **演出块专用模板（cgset/msgset/wait/Motion/Prim/GraphLoad）** | 🟡 | 当前部分落入 raw 逃生舱；cgset/msgset 是常见剧情块，宜升为专用模板 |
| G12 | **预览真实表现扩展（音频/选项/CG/文本事件）** | ⬜ | FakeEngine 仅投影文本+立绘占位；rfvp-cli 不产出 `text`/`audio` 事件（PortableRuntime 只暴露 prim/thread），真实 WYSIWYG 需引擎侧补文本/音频事件捕获 |
| G13 | **时间线线性化精度** | ⬜ | 当前为拓扑排序 + 孤立节点附加，未严格沿 then/else/thread 路径展开 |
| G15 | **未保存脏标记（dirty indicator）** | ⬜ | UI 原则要求「未保存脏标记明确」，当前无（撤销栈之外无脏状态追踪） |
| G17 | **预览 label 断点真实引擎 jump** | ⬜ | 协议有 `jump` op，rfvp-cli 未实现；label 断点目前只 locate 流程图 |
| G19 | **RfvpProcessManager 健壮性** | ⬜ | 计划 §7.2 要求「崩溃自动重启 + handshake 校验 protocolVersion」，当前无（刻意跳过了 handshake） |
| G20 | **rfvp-cli 协议补全（jump/get_g/set_g）** | ⬜ | 协议已定义但 [`main.rs`](hcb-editor/crates/rfvp-cli/src/main.rs:283) 未实现；G[] 面板调试与 label 跳转依赖 |
| G21 | **CI（每日合成工程 IR→编译→假引擎跑通 + golden diff）** | ⬜ | 计划测试矩阵要求，当前无 CI 配置 |
| G23 | **模板级 golden** | 🟡 | roundtrip golden 有；「instantiate(decompile(样板)) === 样板」字节级模板 golden 不完整 |

### P3 —— 锦上添花 / 不阻塞

| # | 差距 | 状态 | 说明 |
|---|---|---|---|
| G7 | **fast-check property test（hcb/core 随机指令）** | ⬜ | 计划测试矩阵要求，当前无 fast-check 依赖 |
| G14 | **自动编译开关设置项** | ⬜ | 需求文档要求，当前 Settings 无此项 |
| G16 | **界面语言切换 i18n** | ⬜ | 需求文档「可扩展但不优先」 |
| G22 | **真实 Event 流录制回放回归** | ⬜ | `FakeEngine.replay` 已备，缺真实会话录制回放测试 |
| G24 | **G[] 符号名数据化展示** | ⬜ | 预览 G[] 面板显示数字索引，无符号名 |

### 依赖关系

```text
G11（真实预览） ← G1 ← G1a（底座库快照）
G10（资源联动） ← G2（emitFunctionDef）+ G8（名字选择器）
G17（label 跳转） ← G20（rfvp-cli jump op）
G4（bgset 精确签名） ← G3（背景表）
```

### 建议实施顺序

1. **P0 冲刺**：G1a 底座库快照 → G1 可运行导出/真实执行 → G8 名字选择器/校验 → G2 emitFunctionDef → G10 资源联动。完成后「原创剧本 → 真实预览 → 可运行导出」闭环打通。
2. **P1**：G18 原生对话框、G6 validate、G3 背景表、G9 jump 节点。
3. **P2/P3**：按需穿插（G13/G15/G19/G20 低成本，可随 P1 顺手做）。

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
  → S4（rfvp-cli + Electron）✅ 桥接 + 可运行导出 + 真实 tick（P0 全部打通）
```

剩余非阻塞小项：演出块签名精确化、时间线线性化精度、背景真实名称（需外部资源表）。

> P0 全部落地：底座库二进制桥（G1a）→ 可运行导出/真实执行（G1）→ 名字选择器（G8）→ emitFunctionDef（G2）→ 资源联动（G10），**「原创剧本 → 真实预览 → 可运行导出」闭环已打通**（小脚本与新增角色脚本均经 rfvp-cli 实测 boot + tick 到 done、零 error）。下一步进入 P1（原生对话框、validate、背景表、jump 节点）与 P2/P3 按需穿插。
