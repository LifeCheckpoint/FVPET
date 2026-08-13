# 角色资源模型设计 —— 内置角色、自定义角色与立绘的统一方案

> 文档定位：回答「台词界面为何能选原角色却选不到自定义角色」「内置与自定义是什么关系」「内置角色怎么导入立绘」「为什么同时有导入立绘和导入表情两套入口」等一组产品级困惑，并给出统一的角色资源模型与实现路线。本文档是**设计决策依据**，落地前需逐条拍板（见 §5）。

---

## 1. 问题的本质：当前存在「两套角色」，且互相割裂

当前代码里，角色被拆成了两个互不知晓的概念：

| 概念 | 位置 | 有什么 | 缺什么 |
|---|---|---|---|
| **底座角色**（31 个：クロ、ハル…） | [`sakura-moyu.ts`](hcb-editor/packages/compiler/src/base/data/sakura-moyu.ts:606) 的 `characters` 表 | `speakFn`（SPEAK 函数地址，编译台词能真实执行） | 无立绘（`chaNum` 缺失）、不出现在资源管理器、不可编辑 |
| **工程资源角色**（用户新增） | [`ProjectResources.characters`](hcb-editor/packages/editor/src/resources.ts:8) | name / 立绘 / 表情集 / `speakFn`(可为 null) | 新增者 `speakFn` 为 null（编译期生成），同样无 `chaNum` |

而台词面板的候选列表是两者名字的**简单拼接**（[`PropertyPanel.tsx`](hcb-editor/packages/ui/src/components/PropertyPanel.tsx:42)）：

```ts
speakerOptions = [...availableBaseCharacters(game), ...resources.characters.map(c => c.name)]
```

于是用户看到的现象就是：**下拉里有一堆「クロ、ハル、奏大雅…」等原版角色，却看不到自己导入的角色；而资源管理器里又只有自己导入的角色，看不到原版角色。** 两套角色各管一半，自然「割裂」。

---

## 2. 五个困惑的逐一回答

### Q1 为什么台词界面能选很多原角色，却没有自定义角色？

**现状**：候选 = 底座角色（31 个）+ 工程角色。工程角色初始为空，所以一开始只看到原版角色。

**根因**：自定义角色必须先在资源管理器「添加角色」才会进入候选；但添加入口藏在模态框里，且与「导入立绘」纠缠，用户不知道「加角色」是选自定义角色的前提。

**正解**：候选应来自**统一的角色列表**（§3），且资源管理器应是该列表的唯一入口；台词面板只是引用，不制造角色。

### Q2 为什么要导入自定义角色？

**回答**：当你想写原创剧情、用原作里没有的角色时，需要一个「新角色」。它的意义是：
- 有名字、有立绘；
- 编译时自动生成一份 SPEAK 函数体（[`emitFunctionDef`](hcb-editor/packages/compiler/src/base/function-gen.ts:1)），让台词能真实执行。

**它和内置角色的唯一区别**：内置角色的 SPEAK 函数在底座库里**已有**（`speakFn` 非 null），自定义角色要**现造**（`speakFn` 为 null）。

### Q3 内置角色和自定义角色究竟是什么关系？

**本质上是同一类东西——「角色」，只是 `speakFn` 的来源不同**：

- 内置角色：`speakFn` 来自底座提取，编译时直接 `call f_00000004` 等。
- 自定义角色：`speakFn` 为 null，编译时从模板角色克隆出一份函数体、分配新地址。

除此之外，二者应当**完全平权**：都能有立绘、都有表情集、都能被台词/立绘节点引用、都在资源管理器里可见可编辑。

### Q4 内置角色是否、如何导入立绘？

**目前不能**：资源管理器只渲染工程角色，底座角色不在其中，所以无法给「クロ」导入立绘。

**正解**：新建工程时把底座角色**预置**进资源表（§3），它们以「内置」身份出现，立绘入口与自定义角色一致。用户点开「クロ」就能导入它的立绘和表情集。

### Q5 为什么同时有「导入立绘」和「导入表情」两种并行入口？

**这是上一轮引入的设计瑕疵，应当合并**：`CharacterResource` 目前同时有单张 `image`（默认立绘）和 `poses`（表情集）两个字段、两个导入按钮。

**正解**：角色只保留**一个立绘集合**：

```text
角色
 └── 立绘集 poses: (pose, costume, face) → 图片
      └── 其中 (0,0,0) 视为「默认立绘」
```

资源管理器只保留一个「添加表情/立绘」入口；`bsset` 节点按 `pose/costume/face` 匹配，匹配不到回退 `(0,0,0)` 默认图。删除单张 `image` 字段。

---

## 3. 统一角色模型（目标态）

### 3.1 数据结构

```ts
interface CharacterPose {
  readonly pose: number;     // 姿势
  readonly costume: number;  // 服装
  readonly face: number;     // 表情
  readonly image: string;    // data URL（编辑器预览用）
}

interface CharacterResource {
  readonly id: string;
  readonly name: string;
  readonly alias?: string;
  /** 内置角色：底座提取的 SPEAK 函数地址；自定义角色：null（编译期生成）。 */
  readonly speakFn: number | null;
  /** 内置标记：底座预置的角色。不可删除其「内置身份」，但可补立绘。 */
  readonly builtin: boolean;
  /** 立绘编号（底座 GraphLoad 用）。底座数据暂缺，自定义角色可为用户手填。 */
  readonly chaNum?: number;
  /** 立绘集（含默认立绘 (0,0,0)）。 */
  readonly poses: CharacterPose[];
}
```

### 3.2 角色来源与初始化

新建工程（[`createProject`](hcb-editor/packages/editor/src/state.ts:50)）时，把底座角色的**名字 + speakFn** 预置进 `resources.characters`：

```ts
resources: {
  characters: availableBaseCharacters(game).map(name => ({
    name, speakFn: baseSpeakFn(name), builtin: true, poses: [],
  })),
  ...
}
```

这样资源管理器一打开就能看到 31 个内置角色 + 用户后续新增的自定义角色，**单一来源**。

### 3.3 立绘的「两层」语义（必须讲清楚）

立绘有两种完全不同的用途，不能混为一谈：

| 层 | 用途 | 数据 | 现状 |
|---|---|---|---|
| **编辑器预览层** | 流程图/预览里显示立绘 | `poses[].image`（data URL） | ✅ 可做（已落地表情集） |
| **真实引擎层** | 编译产物 `bsset` 里的立绘编号 | `chaNum`（整数编号） | ❌ 底座数据缺失，恒为 0 |

- 用户导入的图片，**只能喂给编辑器预览**；它不会、也不可能自动变成真实引擎的 `chaNum`。
- 要让真实引擎显示对应立绘，需要「图片 ↔ chaNum」的映射（§5 决策点 D3）。在此之前，真实引擎预览里的立绘仍是占位矩形。

### 3.4 节点引用

- 台词节点 `speak.speaker`、立绘节点 `bsset.character` 都从**统一角色列表**选（数据源 = `resources.characters`，内置 + 自定义合并）。
- 不再单独拼 `availableBaseCharacters`（底座角色已预置进资源表）。

---

## 4. 与现有实现的差异清单

| # | 现状 | 目标 |
|---|---|---|
| 1 | 底座角色只存在于编译器数据，资源管理器看不到 | 预置进 `resources.characters`（`builtin: true`） |
| 2 | `PropertyPanel` 拼 `availableBaseCharacters` + 工程角色 | 只读 `resources.characters` |
| 3 | `CharacterResource` 同时有 `image` + `poses` 两个立绘入口 | 只保留 `poses`，`(0,0,0)` 为默认 |
| 4 | 自定义角色 `speakFn` null → 编译生成 | 保持不变 |
| 5 | 内置角色 `speakFn` 有值 → 直接 call | 保持不变 |
| 6 | `chaNum` 恒 0 | 允许用户手填 `chaNum`（真实引擎立绘映射，L2 数据化前的手工兜底） |
| 7 | 资源管理器「导入立绘」+「导入表情」双按钮 | 单入口「添加立绘/表情」 |

---

## 5. 需要拍板的决策点

- **D1 内置角色是否允许删除？** 建议：不允许（删除会破坏底座语义），但允许「隐藏」或直接不显示在候选里。
- **D2 内置角色的 `chaNum` 去哪要？** 要么从原版游戏档案清单反推（外部数据），要么允许用户手填。建议先做「用户手填」兜底，数据化后覆盖。
- **D3 用户导入的图片如何变成真实引擎立绘？** 短期：编辑器预览只用 data URL，真实引擎继续占位；中期：让用户把图片绑定到某个 `chaNum`，编译产物直接引用该编号（绕开底座资源文件）。
- **D4 `pose/costume/face` 的语义要不要暴露给普通用户？** 建议：默认折叠为「表情」一个维度（face），高级用户展开三键；避免用户被三个数字吓退。

---

## 6. 实现路线（按依赖排序）

1. **R1（纯 editor）**：`createProject` 预置内置角色到资源表（`builtin: true`，`poses: []`）；`resources.ts` 加 `builtin`/`chaNum` 字段，移除单 `image`。
2. **R2（纯 ui）**：资源管理器渲染内置角色（灰标「内置」+ 只读 speakFn），统一「添加立绘/表情」单入口；`PropertyPanel` 候选只读 `resources.characters`。
3. **R3（编译）**：`compileFromState` 的 `extraCharacters` 逻辑不变（只对 `speakFn === null` 生成）；`bsset` 的 `chaNum` 改为读 `CharacterResource.chaNum`（手填兜底）。
4. **R4（预览）**：`buildPreviewScript` 立绘匹配统一走 `poses`（默认 `(0,0,0)`），移除 `image` 分支。

> 本轮结论：先把「内置角色预置 + 单入口立绘集 + 节点引用统一」这条 L1 链路做通（R1/R2/R4），「真实引擎立绘编号」（R3 的 chaNum）依赖 D2/D3 拍板后再动。
