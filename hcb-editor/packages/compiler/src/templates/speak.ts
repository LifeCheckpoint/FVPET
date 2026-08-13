/**
 * SPEAK / dia 模板（数据驱动，基于 Sakura 实际反汇编校准）。
 *
 * Sakura 的真实结构（经 hcb_to_ir 输出核实）：
 *   - 对话文本（dia）：push_string text + push_nil×4 + call f_0004CEFD
 *   - 说话人名栏（speak）：[语音/名义参数 3~5 条 push 类] + call <SPEAK 函数族>
 *
 * SPEAK 函数族 = 34 份同构函数（每份 0xD8 字节，起始 0x00000004，styleIndex 1..34）。
 * 换游戏 = 替换 DIA_FN 与 SPEAK_FNS 数据。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import { sakuraMoyuBaseData } from '../base/data/sakura-moyu.js';
import type { AsmBlock, AsmInstruction, AsmPattern, Template, TemplateCtx } from './types.js';

type DiaNode = Extract<IrNode, { kind: 'dia' }>;
type SpeakNode = Extract<IrNode, { kind: 'speak' }>;

/** Sakura 对话文本函数（f_0004CEFD，调用 56865 次）。 */
const DIA_FN = 0x0004cefd;

/** SPEAK 函数族：数据驱动自底座角色表（每角色的 speakFn）。 */
const SPEAK_FNS: readonly number[] = Object.values(sakuraMoyuBaseData.characters).map((c) => c.speakFn);

const diaSignature: readonly AsmPattern[] = [
  { mnemonic: 'push_string' },
  { repeat: { pattern: { mnemonic: 'push_nil' }, min: 4, max: 4 } },
  { callTo: DIA_FN },
];

const speakSignature: readonly AsmPattern[] = [
  { repeat: { pattern: { anyOf: ['push_i32', 'push_i8', 'push_nil', 'neg'] }, min: 3, max: 5 } },
  { callToAny: SPEAK_FNS },
];

function diaAsm(text: string): AsmInstruction[] {
  return [
    { op: 'push_string', text },
    { op: 'push_nil' },
    { op: 'push_nil' },
    { op: 'push_nil' },
    { op: 'push_nil' },
    { op: 'call', target: `f_${DIA_FN.toString(16).padStart(8, '0')}` },
  ];
}

function speakCallAsm(speaker: string, ctx: TemplateCtx): AsmInstruction[] {
  const char = ctx.tables.characters[speaker];
  if (!char || char.speakFn === undefined) {
    throw new Error(`unknown speaker: ${speaker}`);
  }
  // 本名 + 无语音的简化调用（别名/？？？/语音变体后续按 IR 字段展开）
  return [
    { op: 'push_nil' },
    { op: 'push_nil' },
    { op: 'push_nil' },
    { op: 'call', target: `f_${char.speakFn.toString(16).padStart(8, '0')}` },
  ];
}

export const diaTemplate: Template<DiaNode> = {
  id: 'fvp.dia',
  signature: diaSignature,
  slots: {
    text: { kind: 'string', doc: '台词文本' },
  },
  instantiate(node, _ctx): AsmBlock[] {
    return [{ instructions: diaAsm(node.text) }];
  },
};

export const speakTemplate: Template<SpeakNode> = {
  id: 'fvp.speak',
  signature: speakSignature,
  slots: {
    speakerGlobal: { kind: 'global', index: 227, doc: '说话人样式编号' },
    name: { kind: 'string', doc: '名栏显示文本' },
    text: { kind: 'string', doc: '台词文本' },
  },
  instantiate(node, ctx): AsmBlock[] {
    // speak = 名栏调用 + 文本调用
    return [
      { instructions: speakCallAsm(node.speaker, ctx) },
      { instructions: diaAsm(node.text) },
    ];
  },
};
