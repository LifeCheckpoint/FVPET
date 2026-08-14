/**
 * 节点构造器：为每种 IR 节点提供类型化、字段齐全的构造函数。
 * UI 与命令构造器（commands.ts）通过这里创建节点，避免散落各处手写对象字面量。
 *
 * 注意：项目开启 exactOptionalPropertyTypes，可选字段只能在有值时显式赋值，
 * 因此构造器对可选字段做 `!== undefined` 守卫后再赋值。
 */

import type {
  CondExpr,
  IrNode,
  Relocation,
  SideEffect,
} from '@hcb-editor/hcb/ir';

// 每个语义节点的精确类型（从 IrNode 可辨识联合中提取）。
export type SpeakNode = Extract<IrNode, { kind: 'speak' }>;
export type DiaNode = Extract<IrNode, { kind: 'dia' }>;
export type LabelNode = Extract<IrNode, { kind: 'label' }>;
export type BgsetNode = Extract<IrNode, { kind: 'bgset' }>;
export type CgsetNode = Extract<IrNode, { kind: 'cgset' }>;
export type BssetNode = Extract<IrNode, { kind: 'bsset' }>;
export type SelsetNode = Extract<IrNode, { kind: 'selset' }>;
export type AudioNode = Extract<IrNode, { kind: 'audio' }>;
export type BranchNode = Extract<IrNode, { kind: 'branch' }>;
export type ThreadNode = Extract<IrNode, { kind: 'thread' }>;
export type JumpNode = Extract<IrNode, { kind: 'jump' }>;
export type WaitNode = Extract<IrNode, { kind: 'wait' }>;
export type MsgsetNode = Extract<IrNode, { kind: 'msgset' }>;
export type EyecatchNode = Extract<IrNode, { kind: 'eyecatch' }>;
export type BsfadeNode = Extract<IrNode, { kind: 'bsfade' }>;
export type WhiteNode = Extract<IrNode, { kind: 'white' }>;
export type RawNode = Extract<IrNode, { kind: 'raw' }>;
export type CommentNode = Extract<IrNode, { kind: 'comment' }>;

export function labelNode(name: string): LabelNode {
  return { kind: 'label', name };
}

export function speakNode(
  speaker: string,
  text: string,
  opts: { readonly alias?: string; readonly voice?: number } = {},
): SpeakNode {
  const node: SpeakNode = { kind: 'speak', speaker, text };
  if (opts.alias !== undefined) node.alias = opts.alias;
  if (opts.voice !== undefined) node.voice = opts.voice;
  return node;
}

export function diaNode(text: string): DiaNode {
  return { kind: 'dia', text };
}
export function bgsetNode(
  background: string,
  opts: { readonly variant?: number; readonly transition?: 'cross' | 'fade' | 'none' } = {},
): BgsetNode {
  const node: BgsetNode = { kind: 'bgset', background };
  if (opts.variant !== undefined) node.variant = opts.variant;
  if (opts.transition !== undefined) node.transition = opts.transition;
  return node;
}

export function cgsetNode(
  name: string,
  opts: {
    readonly slot?: number;
    readonly mode?: number;
    readonly flag?: number;
    readonly x?: number;
    readonly y?: number;
    readonly scale?: number;
    readonly time?: number;
  } = {},
): CgsetNode {
  const node: CgsetNode = {
    kind: 'cgset',
    name,
    // 旧工程兼容字段：新模板不再用它们调用无效的共享函数。
    slot: opts.slot ?? 0,
    mode: opts.mode ?? 5,
    flag: opts.flag ?? 2,
  };
  if (opts.x !== undefined) node.x = opts.x;
  if (opts.y !== undefined) node.y = opts.y;
  if (opts.scale !== undefined) node.scale = opts.scale;
  if (opts.time !== undefined) node.time = opts.time;
  return node;
}

export function bssetNode(fields: {
  readonly character: string;
  readonly pose: number;
  readonly costume: number;
  readonly expression: number;
  readonly layout?: number;
  readonly loc?: 'l' | 'm' | 'r';
  readonly z?: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly layer: number;
}): BssetNode {
  return {
    kind: 'bsset',
    character: fields.character,
    pose: fields.pose,
    costume: fields.costume,
    expression: fields.expression,
    layout: fields.layout ?? 0,
    loc: fields.loc ?? 'm',
    z: fields.z ?? 0,
    position: { x: fields.position.x, y: fields.position.y },
    layer: fields.layer,
  };
}

export function selsetNode(
  choices: readonly { readonly text: string; readonly label: string }[],
  resultGlobal = 103,
): SelsetNode {
  return {
    kind: 'selset',
    choices: choices.map((c) => ({ text: c.text, label: c.label })),
    resultGlobal,
  };
}

export function audioNode(
  type: 'bgm' | 'voice' | 'se',
  channelOrNum: number,
  opts: { readonly loop?: boolean; readonly action?: 'play' | 'stop'; readonly time?: number } = {},
): AudioNode {
  const node: AudioNode = { kind: 'audio', type, channelOrNum };
  if (opts.loop !== undefined) node.loop = opts.loop;
  if (opts.action !== undefined) node.action = opts.action;
  if (opts.time !== undefined) node.time = opts.time;
  return node;
}

export function branchNode(cond: CondExpr, thenLabel: string, elseLabel: string): BranchNode {
  return { kind: 'branch', cond, then: thenLabel, else: elseLabel };
}

export function threadNode(slot: number, entry: string): ThreadNode {
  return { kind: 'thread', slot, entry };
}

export function jumpNode(target: string): JumpNode {
  return { kind: 'jump', target };
}

export function waitNode(ms: number): WaitNode {
  return { kind: 'wait', ms };
}

export function msgsetNode(position: MsgsetNode['position']): MsgsetNode {
  return { kind: 'msgset', position };
}

export function eyecatchNode(): EyecatchNode {
  return { kind: 'eyecatch' };
}

export function bsfadeNode(): BsfadeNode {
  return { kind: 'bsfade' };
}

export function whiteNode(): WhiteNode {
  return { kind: 'white' };
}

export function commentNode(text: string): CommentNode {
  return { kind: 'comment', text };
}

export function rawNode(
  bytes: RawNode['bytes'],
  relocations: readonly Relocation[] = [],
  sideEffects: SideEffect = { touchesGlobals: [], refsStrings: [] },
): RawNode {
  return {
    kind: 'raw',
    bytes,
    relocations: [...relocations],
    sideEffects,
  };
}
