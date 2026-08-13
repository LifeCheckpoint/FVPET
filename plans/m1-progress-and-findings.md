# 实现进展与关键发现（供审阅）

> 状态：Code 模式持续实现中。本文档记录 M1 的核心验证结果、Sakura 真实结构发现、需要拍板的验收口径澄清，以及 M2 协议层进展。

---

## 1. 已达成（决定性验证）

**Sakura.hcb（5,002,575 字节）反编译 → 重编译，字节级 100% 一致**：

```
instructions=966366  functions=5457  identical=yes（in=5002575, out=5002575）
```

- `hcb` 包（opcode 表含 0x25=set_ge/0x27=set_le 修正、二进制读写、NLS、头部、指令流、CFG、syscalls 数据、IR schema）与 Python `hcb_ir_core.py` 100% 复现。
- `compiler` 的 `encodeFromFlat`（layout+relocate+encode 融合，对应 `assemble_ir`）与 Python 100% 复现。
- tsc typecheck 全绿，vitest 全部通过，CLI `decompile`/`roundtrip`/`compile` 三命令可用。

## 2. Sakura 真实结构（签名精确化的依据）

对 [`Sakura.lua`](.reference_repo/fvpanalysis/hcbtool_test/Sakura_hcb_ir/Sakura.lua:1)（101 万行）的统计揭示了与"摸鱼版" `hcb_build.py` 完全不同的调用结构：

| 语义 | Sakura 实际 | 频次 |
|---|---|---|
| 对话文本（dia） | `push_string + nil×4 + call f_0004CEFD` | 56,865 |
| 说话人名栏（speak） | `[push 类 ×3~5] + call <SPEAK 函数族>` | ~14,000（34 份函数） |
| 演出（立绘/背景/CG） | `Motion* / Prim* / GraphLoad` + helper 函数封装 | ~8,000 |
| 线程 | `push_i32 + push_i32 + syscall ThreadStart` | 99 |

**关键结论**：Sakura 的对话不是 `TextPrint` syscall（仅 49 次），而是 `f_0004CEFD` 函数封装；SPEAK 函数族 = 34 份同构函数（起始 `0x00000004`，步长 `0xD8`）。模板签名必须按"底座游戏"的实际函数地址数据化，`hcb_build.py` 的摸鱼版地址对 Sakura 无效。

## 3. 模板识别精确化现状

- 匹配器已修复关键 bug：覆盖率统计从"扫描找匹配"改为"在 cursor 精确匹配"（`matchSignatureAt`）。
- `AsmPattern` 新增 `callTo` / `callToAny`（按函数地址精确匹配）。
- 当前真实命中（全文件口径）：`fvp.dia` 54,955、`fvp.speak` 8,220；指令覆盖率 37.6%（真实值）。

## 4. compile 完整管线（M1 收尾）

- `lower`（IR → AsmBlock）+ `assemble`（AsmBlock → 扁平指令，label/符号解析）+ `encode` 已落地，`compile` 五段式入口在 [`compile.ts`](hcb-editor/packages/compiler/src/passes/compile.ts)。
- CLI `compile <ir.json> --base <base.hcb> -o out.hcb` 走通。
- **合成测试固化**：[`compile.test.ts`](hcb-editor/packages/compiler/test/compile.test.ts) 用最小合成 sysdesc + IR 验证 compile → decode → re-encode 字节一致，CI 不依赖参考仓库。

## 5. 发现并修复的关键 bug：CFG 栈深度 worklist 无界环死循环

合成测试暴露了 [`cfg.ts`](hcb-editor/packages/hcb/src/decompile/cfg.ts) 的栈深度 worklist 对"无界环"会无限循环——Python `hcb_ir_core.py` 的 `build_cfg_for_insts` 同样存在该隐患（Sakura 未触发是因为其循环都有界）。

修复：① worklist 加迭代上限；② [`lower.ts`](hcb-editor/packages/compiler/src/passes/lower.ts) 函数末尾补 `ret` 保证 CFG 有出口。

## 6. M2 协议层进展

- [`protocol.ts`](hcb-editor/packages/rfvp/src/protocol.ts)：rfvp 子进程协议 zod schema（Request/Event + `PROTOCOL_VERSION=1`）。
- [`fake-engine.ts`](hcb-editor/packages/rfvp/src/fake-engine.ts)：FakeEngine，支持脚本驱动 + 事件回放两种模式，3 个单测通过。
- 确认 rfvp 主引擎 `portable/runtime.rs` 的 `PortableRuntime` 可直接封装成 `rfvp-cli`，无需自建 VM。

## 7. 剩余工作（M2-3 之后）

1. **M2-3**：`engine-wrapper/` 写 Rust `rfvp-cli`（基于 rfvp `portable` 模块 + stdio JSON 协议），需 cargo 编译；Electron 主进程 `RfvpProcessManager`。
2. **M2-4**：预览面板（Pixi 自绘 prim + G[] 面板 + label 跳转）。
3. **M3**：流程图编辑 + 命令集 + undo/redo + 资源管理器 + 新建工程向导。
4. **M4**：时间线/剧本文本投影 + raw 只读占位 + 版本迁移。

## 8. 需要拍板的验收口径澄清（疑虑）

当前 37.6% 覆盖率的口径是"**全文件指令**"——但 Sakura.hcb 的 5,457 个函数里，绝大多数是**库函数定义体**，不是"剧情节点"。

建议的 95% 口径（二选一，待确认）：

- **口径 A（剧情节点口径）**：只统计"剧情脚本函数"内的调用点，95% 被识别为语义节点；库函数定义体作为底座（patchBase）原样保留，不计入命中率。
- **口径 B（全文件口径）**：96.6 万条指令中 95% 必须被某类模板覆盖（含"库函数定义"模板）。

我倾向 **口径 A**（与计划 §3 的 `patchBase` 一致）。

## 9. 已记录的关键实现事实

- `push_global/pop_global` 操作数宽度：Python 用 `u16`（非规范文档的 `i16`），TS 已对齐 `u16`，round-trip 100% 证明正确。
- ThreadStart 前的 `push_i32` 地址立即数参与重定位（`addressRole` 标记），round-trip 验证通过。
- 字符串未修改时保留原字节（`rawOrEncoded`）。
