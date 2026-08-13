/**
 * bsset 模板（立绘设定）。
 * 源：hcb_build.py 的 bsset，function_offset = 0x00043F97。
 *
 * 入参顺序（10 个自由入参）：cha/pose/cloth/face(4×i8) + layout + loc + nil + z + x + y + nil + layer + alpha×2。
 * 负值（layout/x/y）编码为 push_i8|push_i16 + neg。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import type { AsmInstruction, AsmPattern, Template } from './types.js';

type BssetNode = Extract<IrNode, { kind: 'bsset' }>;

const BSSET_FN = 0x00043f97;

function signedI16(value: number): AsmInstruction[] {
  if (value < 0) {
    return [{ op: 'push_i16', value: -value }, { op: 'neg' }];
  }
  return [{ op: 'push_i16', value }];
}

function signedI8(value: number): AsmInstruction[] {
  if (value < 0) {
    return [{ op: 'push_i8', value: -value }, { op: 'neg' }];
  }
  return [{ op: 'push_i8', value }];
}

const signature: readonly AsmPattern[] = [
  { mnemonic: 'push_i8' }, // cha
  { mnemonic: 'push_i8' }, // pose
  { mnemonic: 'push_i8' }, // costume
  { mnemonic: 'push_i8' }, // expression
  { anyOf: ['push_i8', 'neg'] }, // layout（负值带 neg）
  { mnemonic: 'push_i8' }, // 站位
  { mnemonic: 'push_nil' }, // 未知
  { mnemonic: 'push_i16' }, // z
  { anyOf: ['push_i16', 'neg'] }, // x
  { anyOf: ['push_i16', 'neg'] }, // y
  { mnemonic: 'push_nil' }, // 未知
  { mnemonic: 'push_i8' }, // layer
  { mnemonic: 'push_nil' }, // alpha
  { mnemonic: 'push_nil' }, // alpha2
  { call: true }, // f_00043F97
];

export const bssetTemplate: Template<BssetNode> = {
  id: 'fvp.bsset',
  signature,
  slots: {
    cha: { kind: 'i8', doc: '角色编号（查 tables.characters.chaNum）' },
    pose: { kind: 'i8', doc: '姿势' },
    costume: { kind: 'i8', doc: '服装' },
    expression: { kind: 'i8', doc: '表情' },
    layout: { kind: 'i8', doc: '构图状态 0/-1/1/2' },
    layer: { kind: 'i8', doc: '层次' },
  },
  instantiate(node, ctx): { label?: string; instructions: readonly AsmInstruction[] }[] {
    const chaNum = ctx.tables.characters[node.character]?.chaNum;
    if (chaNum === undefined) {
      throw new Error(`unknown character for bsset: ${node.character}`);
    }
    const ins: AsmInstruction[] = [
      { op: 'push_i8', value: chaNum },
      { op: 'push_i8', value: node.pose },
      { op: 'push_i8', value: node.costume },
      { op: 'push_i8', value: node.expression },
      ...signedI8(node.layout),
      { op: 'push_i8', value: 1 }, // 站位默认 m（IR 未建模，取默认）
      { op: 'push_nil' }, // 未知
      { op: 'push_i16', value: 0 }, // z 默认
      ...signedI16(node.position.x),
      ...signedI16(node.position.y),
      { op: 'push_nil' }, // 未知
      { op: 'push_i8', value: node.layer },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'call', target: `f_${BSSET_FN.toString(16).padStart(8, '0')}` },
    ];
    return [{ instructions: ins }];
  },
};
