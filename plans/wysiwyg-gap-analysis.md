# 所见即所得（WYSIWYG）断裂点与困难点诊断

> 文档定位：从**一个普通用户**的视角，逐步走通「建工程 → 导入立绘 → 给角色配表情 → 导入音频 → 放进剧情 → 预览看效果」这条主链路，把每一步踩到的断裂点、背后的代码事实、以及更深层的困难点记录下来。它是下一阶段「补资源语义 + 真所见即所得」的施工依据。

> **进展（第一批已落地，2026-08-13）**：P0-A「立绘表情集」、P0-B「背景预览投影」、P0-C「音频节点从资源选」已完成，详见文末 §6。

---

## 0. 结论先行（TL;DR）

编辑器已经能「画流程图 → 写台词 → 编译出可运行的 HCB」，但**资源侧是断裂的**：

1. **立绘是「一角色一张图」**，没有「角色 → 表情/姿势/服装 → 多张图」的层级。导入的立绘无法分配到具体表情。
2. **音频导入后只能试听**，剧情节点（`audio` / `speak.voice`）只存一个数字编号，和资源表里的音频没有任何引用关系。
3. **预览只覆盖「台词 + 立绘占位」**：背景不投影、音频不播放、选项不显示；真实引擎侧只回放灰色矩形，看不到任何真实图片。

这三个问题共同导致：**用户在资源管理器里花力气导入的东西，在剧情画布和预览里几乎都「用不上、看不见」。** 根因不是 UI 不够漂亮，而是**资源模型缺一层语义**、**底座资源数据化不完整**、**无头引擎资源系统未接入**三件事叠加。

---

## 1. 用户旅程逐站走查

### 场景 A：导入一张立绘，希望它出现在角色台词旁

用户操作：资源管理器 → 角色 → 添加角色 → 导入立绘（选一张 PNG）→ 回画布拖一个「台词」节点 → 预览。

- ✅ 能做的：`ResourceManager` 用 `FileReader` 把图片转成 data URL，存进 [`CharacterResource.image`](hcb-editor/packages/editor/src/resources.ts:18)，卡片左上角出现缩略图。
- ❌ 断裂：**台词节点根本不引用这张图**。`speak` 节点只有 `speaker`（角色名）+ `text`（文本），预览时 [`buildPreviewScript`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:22) 只把台词推进文本队列，**不画立绘**。立绘只在「立绘」节点（`bsset`）里出现，且和「台词」是两种互不相干的节点。
- 用户感受：**「我导入了立绘，但说话的时候它不出现。」**

### 场景 B：导入多张表情图，想给同一个角色配「微笑 / 生气 / 惊讶」

用户操作：角色 → 导入立绘（只有一张的入口）→ 想再导入第二张当「表情」。

- ❌ 断裂：**没有「为一个角色导入多张图」的入口**。`CharacterResource` 只有一个 `image` 字段（[`resources.ts`](hcb-editor/packages/editor/src/resources.ts:18)），而 `pose`/`costume`/`face` 是三个**孤立的数字输入框**（[`ResourceManager.tsx`](hcb-editor/packages/ui/src/components/ResourceManager.tsx:191)），和图片没有任何关联。
- ❌ 断裂：`bsset` 节点里「表情 face」也是**纯数字输入**（[`PropertyPanel.tsx`](hcb-editor/packages/ui/src/components/PropertyPanel.tsx:252)），预览里 [`buildPreviewScript`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:42) 只用 `char.image` 那一张，**不管 face 是多少**。
- 用户感受：**「表情/姿势/服装这些数字是什么？我导入的图怎么对应到它们？」**

### 场景 C：导入音频，想在某个节点播放它

用户操作：资源管理器 → 音频 → 添加音频 → 导入 mp3 → 卡片上出现 `<audio>` 试听条。

- ✅ 能做的：试听（[`ResourceManager.tsx`](hcb-editor/packages/ui/src/components/ResourceManager.tsx:270)）。
- ❌ 断裂：回到画布拖「音频」节点，属性面板里是「类型 + 编号」两个**数字输入**（[`PropertyPanel.tsx`](hcb-editor/packages/ui/src/components/PropertyPanel.tsx:270)），**不能从资源表里选**。导入的音频的 `src`（data URL）在预览和编译里**从头到尾没人读**。
- ❌ 断裂：台词节点的「语音编号」同样是一个**裸数字**（[`PropertyPanel.tsx`](hcb-editor/packages/ui/src/components/PropertyPanel.tsx:104)），编译模板 [`speakCallAsm`](hcb-editor/packages/compiler/src/templates/speak.ts:47) 里明确写着「语音变体后续按 IR 字段展开」，当前**直接把 `voice` 忽略**。
- 用户感受：**「音频导入了，但剧情里怎么用它？编号填多少？填了有声音吗？」** —— 填了也不会响。

### 场景 D：拖入「背景」节点，想在预览里看到背景切换

用户操作：背景 → 导入背景图 → 画布拖「背景」节点 → 预览。

- ❌ 断裂：`buildPreviewScript` 只处理 `speak`/`dia`/`bsset` 三种节点（[`buildPreviewScript.ts`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:22)），**`bgset` 根本不进预览**。背景图导入后只出现在资源管理器缩略图里。
- 用户感受：**「背景节点切了跟没切一样。」**

### 场景 E：切到「真实引擎」，想看到真正游戏画面

用户操作：Electron 下预览自动切真实引擎（右上角标「真实引擎」）。

- ❌ 断裂：真实引擎 rfvp-cli 的渲染器 [`CliRenderer`](hcb-editor/crates/rfvp-cli/src/main.rs:57) 只捕获 `draw_solid` 矩形，`GraphLoad`/纹理加载在无头环境是 no-op。预览里只有**灰色占位矩形**（[`PreviewPanel.tsx`](hcb-editor/packages/ui/src/preview/PreviewPanel.tsx:69)），看不到任何真实立绘/背景。
- 用户感受：**「所谓的真实引擎，也是几块灰矩形。」**

---

## 2. 断裂点清单（现象 → 根因 → 位置）

### GAP-1 立绘「一角色一图」vs「一角色多表情」

- 现象：无法为一个角色导入多张表情图，也无法把图分配给 pose/costume/face。
- 根因：`CharacterResource` 数据模型只有单张 `image`；`pose/costume/face` 是脱离图片的数字。
- 位置：[`resources.ts`](hcb-editor/packages/editor/src/resources.ts:8)、[`ResourceManager.tsx`](hcb-editor/packages/ui/src/components/ResourceManager.tsx:175)、[`bsset.ts`](hcb-editor/packages/compiler/src/templates/bsset.ts:48)。

### GAP-2 立绘与预览/编译脱节

- 现象：预览里 `bsset` 永远显示 `char.image` 一张图，`pose/expression` 无效果；编译产物 `chaNum` 恒为 0。
- 根因：
  - 预览：[`buildPreviewScript`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:42) 只取 `char.image`。
  - 编译：[`bsset.ts`](hcb-editor/packages/compiler/src/templates/bsset.ts:61) 的 `chaNum = tables.characters[name]?.chaNum ?? 0`，而底座数据 [`sakura-moyu.ts`](hcb-editor/packages/compiler/src/base/data/sakura-moyu.ts:606) 的 `characters` 只有 `speakFn`，**没有 `chaNum`**，于是恒为 0。

### GAP-3 音频「导入的 src」与「节点使用」完全脱节

- 现象：音频节点只填数字编号，不引用资源表；导入的 `src` 在预览/编译无人使用。
- 根因：
  - 节点：[`audio`](hcb-editor/packages/hcb/src/ir/types.ts:71) 只有 `type` + `channelOrNum` + `loop`。
  - 资源：`AudioResource.src` 只在 [`ResourceManager.tsx`](hcb-editor/packages/ui/src/components/ResourceManager.tsx:270) 试听。
  - 编译：[`audioAsm`](hcb-editor/packages/compiler/src/templates/stage.ts:85) 直接把 `channelOrNum` 编码进 syscall，和 `src` 无关。

### GAP-4 台词语音 `voice` 被静默丢弃

- 现象：`speak` 节点填了语音编号，编译和预览都不生效。
- 根因：[`speakCallAsm`](hcb-editor/packages/compiler/src/templates/speak.ts:47) 注释明确「语音变体后续展开」，当前忽略 `node.voice`。

### GAP-5 预览只覆盖三种节点

- 现象：背景不投影、音频不播放、选项不显示。
- 根因：[`buildPreviewScript`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:22) 只处理 `speak`/`dia`/`bsset`。

### GAP-6 真实引擎预览只有灰矩形

- 现象：真实引擎预览看不到图片/音频，只有 `draw_solid` 矩形。
- 根因：[`CliRenderer`](hcb-editor/crates/rfvp-cli/src/main.rs:57) 只实现 `draw_solid`，`GraphLoad`/纹理/音频解码在无头 host 全为 no-op；`PortableSubsystem` 的 [`graph_load`](hcb-editor/vendor/rfvp/crates/rfvp/src/portable/subsystem.rs:365) 依赖 `read_resource(host, path)` 读文件，而 [`CliFs`](hcb-editor/crates/rfvp-cli/src/main.rs:42) 的 `open` 永远返回 `NotFound`。

### GAP-7 资源引用用「名字」而非「id」

- 现象：改名一个角色/背景，所有引用它的节点（`speak.speaker`、`bsset.character`、`bgset.background`）静默失效，无提示。
- 根因：节点存的是字符串名字，不是资源 `id`；`validateIr` 只查 label，不查资源存在性。

### GAP-8 新增资源的真实运行数据缺失

- 现象：新增角色能生成 SPEAK 函数体，但没有 `chaNum`（立绘编号）；新增背景只有 `variant`，没有真实背景名。
- 根因：底座资源数据化只完成了 sysdesc + 31 角色 speakFn（[`extract-base`](hcb-editor/packages/apps/cli/src/main.ts:256)），立绘编号、背景清单、音频编号表都未提取（此前盘点 G3 已阻塞）。

---

## 3. 困难点分层（真正的根因）

按「越往下越难啃、越往下越决定成败」排列：

### L1 资源模型缺语义层级（纯前端/editor 层，可控）

现在的三张资源表是「扁平卡片」。正确模型应是：

```text
角色 Character
 └── 表情/姿势/服装集 Expressions
      └── (pose, costume, face) → 图片
音频 Audio
 └── 被节点引用（audio 节点 / speak.voice 都指向它）
背景 Background
 └── 被 bgset 节点引用
```

需要：`CharacterResource` 从「一张 image」升级为「pose/costume/face → image 的多映射」，节点从「存数字」升级为「引用资源对象（id）」。

### L2 底座资源数据化不完整（domain 层，需外部数据）

`chaNum`（立绘编号）、真实背景名、音频编号表都缺失。`bsset` 的 `chaNum ?? 0` 只是「不让它崩」的兜底，**不代表能正确显示立绘**。这条要么从原版游戏档案清单反推，要么允许用户自定义映射（脱离原版底座）。

### L3 无头引擎资源系统未接入（Rust 层，最重）

真实引擎要「所见即所得」，需要让 rfvp-cli 能：

- `GraphLoad` 真的加载图片（把编辑器导入的 data URL / 文件喂给 `CliFs`）；
- 音频真的解码播放（`CliAudio` 目前全 no-op）；
- 文本事件真的回传（当前文本由编辑器投影兜底）。

这本质是把 rfvp-cli 从「无头探测工具」升级成「有资源的轻量运行时」。

---

## 4. 修复路线建议（按投入产出排序）

| 优先级 | 动作 | 解决 | 层 |
|---|---|---|---|
| P0 | 资源模型升级：角色「多表情图映射」、音频「节点引用资源」、节点存资源 id | GAP-1/3/7 | L1 |
| P0 | `buildPreviewScript` 补 `bgset`（背景图投影）+ `selset`（选项渲染）+ `audio`（试听触发） | GAP-5 | L1 |
| P1 | `bsset` 预览按 `pose/face` 取对应图；`speak` 预览可带立绘 | GAP-2 | L1 |
| P1 | `speak.voice` 编译展开（语音 syscall）或至少校验引用 | GAP-4 | L1 |
| P2 | 真实引擎预览喂图：`CliFs` 支持编辑器导入的资源文件，`GraphLoad` 加载 | GAP-6 | L3 |
| P2 | 底座 `chaNum` / 音频编号数据化（或允许用户自定义编号映射） | GAP-2/8 | L2 |
| P3 | 真实音频播放（`CliAudio` 解码）+ 文本事件回传 | GAP-3/6 | L3 |

---

## 5. 一句话总结

**编辑器的「骨架」（流程图、编译、引擎桥）是通的，缺的是「血肉」（资源的语义层级、底座资源数据、引擎资源回放）。** 下一步应该优先做 L1 的资源模型升级和预览补全——这两件事不依赖任何外部数据，能把「导入的东西用得上、看得见」先闭环起来；L2/L3 再逐步啃底座数据与无头引擎资源系统。

---

## 6. 进展记录（第一批已落地）

### 6.1 P0-A 立绘表情集 ✅

- 资源模型：[`CharacterResource`](hcb-editor/packages/editor/src/resources.ts:8) 新增 `poses?: CharacterPose[]`（`pose/costume/face → image` 多映射），保留单张 `image` 兜底。
- 工程序列化：[`project-file.ts`](hcb-editor/packages/editor/src/project-file.ts:13) 增加 `CharacterPoseSchema`，反序列化剥离可选字段。
- 资源管理器：[`ResourceManager.tsx`](hcb-editor/packages/ui/src/components/ResourceManager.tsx:194) 角色卡片新增「表情集」编辑区——每条表情可设 pose/costume/face 三个数字并导入对应图片，支持增删。
- 预览匹配：[`buildPreviewScript.ts`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:13) 的 [`characterImageAt`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:14) 按 `pose/costume/face` 精确匹配，未命中回退默认立绘；[`PropertyPanel`](hcb-editor/packages/ui/src/components/PropertyPanel.tsx:237) 的 bsset 缩略图同步按组合匹配。

### 6.2 P0-B 背景预览投影 ✅

- [`buildPreviewScript.ts`](hcb-editor/packages/ui/src/preview/buildPreviewScript.ts:34) 新增 `bgset` 分支：按背景名取 [`BackgroundResource.image`](hcb-editor/packages/editor/src/resources.ts:28) 投影为全屏 prim（`fullscreen: true`，z 最低）。
- [`FakePrim`](hcb-editor/packages/rfvp/src/fake-engine.ts:12) 新增 `fullscreen` 字段；[`drawPrims`](hcb-editor/packages/ui/src/preview/PreviewPanel.tsx:45) 铺满舞台。

### 6.3 P0-C 音频节点从资源选 ✅

- [`PropertyPanel`](hcb-editor/packages/ui/src/components/PropertyPanel.tsx:280) 的 `audio` 节点「编号」旁新增「从资源选…」下拉：按节点 type 过滤资源表音频，选中后自动填入 `channelOrNum`。

### 6.4 仍未解决（下一批）

- GAP-3 音频**预览播放**（导入的 `src` 仍只在资源管理器试听，预览/编译不触发）。
- GAP-4 `speak.voice` 编译展开。
- GAP-5 `selset` 选项预览渲染。
- GAP-6/8 真实引擎图片/音频回放、底座 `chaNum` 数据化（L2/L3）。
