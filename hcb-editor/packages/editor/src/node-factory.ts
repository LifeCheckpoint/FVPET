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
export type BssetNode = Extract<IrNode, { kind: 'bsset' }>;
export type SelsetNode = Extract<IrNode, { kind: 'selset' }>;
export type AudioNode = Extract<IrNode, { kind: 'audio' }>;
export type BranchNode = Extract<IrNode, { kind: 'branch' }>;
export type ThreadNode = Extract<IrNode, { kind: 'thread' }>;
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

export function bssetNode(fields: {
  readonly character: string;
  readonly pose: number;
  readonly costume: number;
  readonly expression: number;
  readonly layout?: number;
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
  opts: { readonly loop?: boolean } = {},
): AudioNode {
  const node: AudioNode = { kind: 'audio', type, channelOrNum };
  if (opts.loop !== undefined) node.loop = opts.loop;
  return node;
}

export function branchNode(cond: CondExpr, thenLabel: string, elseLabel: string): BranchNode {
  return { kind: 'branch', cond, then: thenLabel, else: elseLabel };
}

export function threadNode(slot: number, entry: string): ThreadNode {
  return { kind: 'thread', slot, entry };
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
