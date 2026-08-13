/**
 * selset 模板（选项）。
 * 源：hcb_build.py 的 selset：sel_start=0x0003836D / sel_option=0x00057F0D / sel_end=0x0005800B，
 * 分发块按 G[resultGlobal]（默认 103）== i 逐项跳转到 choice.label。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import type { AsmBlock, AsmPattern, Template } from './types.js';

type SelsetNode = Extract<IrNode, { kind: 'selset' }>;

const SEL_START_FN = 0x0003836d;
const SEL_OPTION_FN = 0x00057f0d;
const SEL_END_FN = 0x0005800b;

const signature: readonly AsmPattern[] = [
  { mnemonic: 'push_string' }, // 基底文字
  { repeat: { pattern: { mnemonic: 'push_nil' }, min: 2, max: 3 } },
  { call: true }, // sel_start
  { repeat: { pattern: { anyOf: ['push_string', 'push_nil', 'call'] }, min: 3 } }, // 选项 + sel_end（宽匹配）
];

export const selsetTemplate: Template<SelsetNode> = {
  id: 'fvp.selset',
  signature,
  slots: {
    resultGlobal: { kind: 'global', index: 103, doc: '选项结果全局变量' },
    choices: { kind: 'label', doc: '选项文本 + 目标 label' },
  },
  instantiate(node, _ctx): AsmBlock[] {
    const blocks: AsmBlock[] = [];
    // start（基底文字，IR 未建模，空串）
    blocks.push({
      instructions: [
        { op: 'push_string', text: '' },
        { op: 'push_nil' },
        { op: 'push_nil' },
        { op: 'push_nil' },
        { op: 'call', target: `f_${SEL_START_FN.toString(16).padStart(8, '0')}` },
      ],
    });
    // options
    for (const choice of node.choices) {
      blocks.push({
        instructions: [
          { op: 'push_string', text: choice.text },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'call', target: `f_${SEL_OPTION_FN.toString(16).padStart(8, '0')}` },
        ],
      });
    }
    // end
    blocks.push({
      instructions: [{ op: 'call', target: `f_${SEL_END_FN.toString(16).padStart(8, '0')}` }],
    });
    // dispatch：G[resultGlobal] == i → jump choice.label；内部检查标签作为 block label 落位。
    for (let i = 0; i < node.choices.length; i += 1) {
      const choice = node.choices[i]!;
      blocks.push({
        label: `@sel_check_${i}`,
        instructions: [
          { op: 'push_global', index: node.resultGlobal },
          { op: 'push_i8', value: i + 1 },
          { op: 'set_e' },
          { op: 'jz', target: `@sel_check_${i + 1}` },
          { op: 'jmp', target: choice.label },
        ],
      });
    }
    // 无匹配时的兜底落点（空块，仅提供 label）。
    blocks.push({ label: `@sel_check_${node.choices.length}`, instructions: [] });
    return blocks;
  },
};
