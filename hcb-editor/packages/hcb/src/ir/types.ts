/**
 * 语义 IR 类型定义 + zod schema（契约即类型）。
 *
 * 设计要点：
 * - 语义层可辨识联合，命名字段，不出现栈编号。
 * - `speak` 在编辑器语义上代表"一句台词"（名字 + 文本 + 语音），
 *   编译时展开为「SPEAK 名栏显示 + dia/TextPrint 文本」两条 HCB 块。
 * - `raw` 是逃生舱：声明进出边界 / 触碰 G[] / 字符串引用，编译器字节透传 + 重定位重算。
 * - JSON 序列化时 `raw.bytes` 以 base64 表示（见 serialize/deserialize 模块）。
 */

import { z } from 'zod';

// 条件表达式（栈机比较的语义化投影）
export const CondExpr = z.discriminatedUnion('op', [
  z.object({ op: z.literal('eq'), a: z.union([z.number(), z.string()]), b: z.union([z.number(), z.string()]) }),
  z.object({ op: z.literal('ne'), a: z.union([z.number(), z.string()]), b: z.union([z.number(), z.string()]) }),
  z.object({ op: z.literal('gt'), a: z.number(), b: z.number() }),
  z.object({ op: z.literal('ge'), a: z.number(), b: z.number() }),
  z.object({ op: z.literal('lt'), a: z.number(), b: z.number() }),
  z.object({ op: z.literal('le'), a: z.number(), b: z.number() }),
  z.object({ op: z.literal('global_eq'), global: z.number(), value: z.number() }), // G[idx] == value
  z.object({ op: z.literal('flag_get'), flag: z.number() }),
]);
export type CondExpr = z.infer<typeof CondExpr>;

export const Relocation = z.object({
  kind: z.enum(['call', 'jmp', 'jz', 'thread_start_fn', 'string_ref']),
  offset: z.number(), // raw 块内字节偏移
  target: z.string(), // label / 函数 / 字符串池身份
});
export type Relocation = z.infer<typeof Relocation>;

export const SideEffect = z.object({
  touchesGlobals: z.array(z.number()), // 读写的 G[] 索引
  refsStrings: z.array(z.string()), // 字符串池引用身份
});
export type SideEffect = z.infer<typeof SideEffect>;

export const IrNode = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('label'), name: z.string() }),
  z.object({
    kind: z.literal('speak'),
    speaker: z.string(), // 角色名，'？？？' 表示未知说话人
    alias: z.string().optional(), // 别名/其他名义（索尔->一磨/遠矢）
    text: z.string(), // 台词文本
    voice: z.number().optional(), // 语音编号
  }),
  z.object({ kind: z.literal('dia'), text: z.string() }), // 旁白/无名字文本
  z.object({
    kind: z.literal('bgset'),
    background: z.string(),
    variant: z.number().optional(), // 背景细分编号
    transition: z.enum(['cross', 'fade', 'none']).optional(),
  }),
  z.object({
    kind: z.literal('cgset'), // 事件 CG 显示（base.chb 中每个 CG 对应一个 6 参数专属函数）
    name: z.string(), // CG 资源名（大写，如 ASAHI_E011A1）
    /** 旧版共享函数模型遗留字段：为工程向后兼容保留，新编译器不再据此调用 0x373a5。 */
    slot: z.number(),
    mode: z.number(),
    flag: z.number(),
    /** 自定义画面参数；任一缺省时使用 CG 专属函数内置设定。 */
    x: z.number().optional(),
    y: z.number().optional(),
    scale: z.number().optional(), // 1 = 原始缩放；底层 zoom = 3000 - scale*1000
    time: z.number().optional(), // 转场时间（毫秒），默认 0
  }),
  z.object({
    kind: z.literal('bsset'),
    character: z.string(),
    pose: z.number(), // 姿势
    costume: z.number(), // 服装
    expression: z.number(), // 表情
    layout: z.number(), // 构图状态 0/-1/1/2
    loc: z.enum(['l', 'm', 'r']).default('m'), // 预设站位（l→2, m→1, r→0）
    z: z.number().default(0), // 立绘 z 坐标（i16）
    position: z.object({ x: z.number(), y: z.number() }),
    layer: z.number(),
  }),
  z.object({
    kind: z.literal('selset'),
    choices: z.array(z.object({ text: z.string(), label: z.string() })),
    resultGlobal: z.number().default(103), // G[103]=选项结果
  }),
  z.object({
    kind: z.literal('audio'),
    type: z.enum(['bgm', 'voice', 'se']),
    channelOrNum: z.number(),
    loop: z.boolean().optional(),
    action: z.enum(['play', 'stop']).optional(), // 播放（默认）/ 停止
    time: z.number().optional(), // loop / end 的时长（毫秒）
  }),
  z.object({
    kind: z.literal('branch'),
    cond: CondExpr,
    then: z.string(), // label 引用
    else: z.string(), // label 引用
  }),
  z.object({ kind: z.literal('thread'), slot: z.number(), entry: z.string() }),
  z.object({ kind: z.literal('jump'), target: z.string() }), // 无条件跳转（目标 label，由 jump 连线解析）
  z.object({ kind: z.literal('wait'), ms: z.number() }), // 等待指定毫秒
  z.object({
    kind: z.literal('msgset'),
    position: z.enum(['middle', 'normal', 'boxin', 'boxout']), // 对话栏位置
  }),
  z.object({ kind: z.literal('eyecatch') }), // 转场（eyecatch）
  z.object({ kind: z.literal('bsfade') }), // 消除当前立绘
  z.object({ kind: z.literal('white') }), // 背景调白 / 白屏特效
  z.object({
    kind: z.literal('raw'), // 逃生舱：模板覆盖不到的 5%
    bytes: z.instanceof(Uint8Array),
    relocations: z.array(Relocation),
    sideEffects: SideEffect,
  }),
  z.object({ kind: z.literal('comment'), text: z.string() }), // 编译时丢弃
]);
export type IrNode = z.infer<typeof IrNode>;

export const IrHeader = z.object({
  schemaVersion: z.literal(1),
  engine: z.literal('fvp'),
  game: z.string(), // 例如 'sakura-moyu'
  nls: z.enum(['sjis', 'gbk', 'utf8']).default('sjis'),
});
export type IrHeader = z.infer<typeof IrHeader>;

export const IrScript = z.object({
  header: IrHeader,
  nodes: z.array(IrNode),
});
export type IrScript = z.infer<typeof IrScript>;

/** 当前 IR schema 版本。 */
export const IR_SCHEMA_VERSION = 1 as const;
