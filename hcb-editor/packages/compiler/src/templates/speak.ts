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

/** Sakura 旁白文本函数（f_00038347；与 hcb_build.py 的 diaset 一致）。 */
const DIA_FN = 0x00038347;

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

function speakCallAsm(node: SpeakNode, ctx: TemplateCtx): AsmInstruction[] {
  const char = ctx.tables.characters[node.speaker];
  if (!char || char.speakFn === undefined) {
    throw new Error(`unknown speaker: ${node.speaker}`);
  }
  const ins: AsmInstruction[] = [];
  // 语音：有 → push_i32；无 → push_nil（hcb_build.py chaset 第一入参）。
  if (node.voice !== undefined) {
    ins.push({ op: 'push_i32', value: node.voice });
  } else {
    ins.push({ op: 'push_nil' });
  }
  // 名义（别名）：预设别名编号 → push_i8；？？？ → push_i8 1 + neg（-1）；否则本名 push_nil。
  if (node.alias !== undefined && node.alias !== '') {
    if (node.alias === '？？？') {
      ins.push({ op: 'push_i8', value: 1 }, { op: 'neg' });
    } else {
      const aliasNum = char.alias?.[node.alias];
      ins.push(aliasNum !== undefined ? { op: 'push_i8', value: aliasNum } : { op: 'push_nil' });
    }
  } else {
    ins.push({ op: 'push_nil' });
  }
  // 尾巴 nil：大雅 3 个，普通角色 1 个（hcb_build.py chaset 后续入参）。
  const extra = char.extraArgs ?? 1;
  for (let i = 0; i < extra; i += 1) {
    ins.push({ op: 'push_nil' });
  }
  ins.push({ op: 'call', target: `f_${char.speakFn.toString(16).padStart(8, '0')}` });
  return ins;
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
      { instructions: speakCallAsm(node, ctx) },
      { instructions: diaAsm(node.text) },
    ];
  },
};
