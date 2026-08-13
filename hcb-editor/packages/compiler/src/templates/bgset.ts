/**
 * bgset 模板（背景切换）。
 * Sakura moyu 实测（bgset-probe）：
 *   - 摸鱼版 hcb_build.py 的转场尾块 f_0004115A 在 Sakura 中 0 次出现，不可用。
 *   - 背景/立绘资源加载族：push_i16 <资源编号> + call f_00037421（371 次）。
 *   - CG 显示族：push_i16 + push_string <名> + push_i8 + push_i8 + call f_000373A5（739 次），
 *     归入 cgset 模板（stage.ts）。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import type { AsmInstruction, AsmPattern, Template, TemplateCtx } from './types.js';

type BgsetNode = Extract<IrNode, { kind: 'bgset' }>;

/** Sakura moyu 背景/立绘资源加载函数族（数值编号入参）。 */
const BG_FNS: readonly number[] = [0x00037421];

const signature: readonly AsmPattern[] = [
  { mnemonic: 'push_i16' },
  { callToAny: BG_FNS },
];

export const bgsetTemplate: Template<BgsetNode> = {
  id: 'fvp.bgset',
  signature,
  slots: {
    background: { kind: 'label', doc: '背景编号 → tables.backgrounds.fn' },
    variant: { kind: 'i8', doc: '背景细分编号' },
  },
  instantiate(node, ctx: TemplateCtx): { label?: string; instructions: readonly AsmInstruction[] }[] {
    const bg = ctx.tables.backgrounds[node.background];
    if (!bg || bg.fn === undefined) {
      throw new Error(`unknown background: ${node.background}`);
    }
    return [
      {
        instructions: [
          { op: 'push_i16', value: bg.number ?? node.variant ?? 0 },
          { op: 'call', target: `f_${bg.fn.toString(16).padStart(8, '0')}` },
        ],
      },
    ];
  },
};
