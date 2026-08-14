/**
 * bgset 模板（预处理 base.chb 背景切换）。
 *
 * 原版 Sakura 分析中的 f_00037421 在 base.chb 不是函数；预处理底座为每个
 * 背景组生成专属函数，且函数 init_stack 参数数存在 5/6/10/11 四种变体。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import type { AsmInstruction, AsmPattern, Template, TemplateCtx } from './types.js';

type BgsetNode = Extract<IrNode, { kind: 'bgset' }>;

const PUSH: AsmPattern = {
  anyOf: ['push_i8', 'push_i16', 'push_i32', 'push_nil', 'push_true', 'neg'],
};

function signedI8(value: number): AsmInstruction[] {
  const integer = Math.trunc(value);
  if (integer >= 0 && integer <= 127) {
    return [{ op: 'push_i8', value: integer }];
  }
  if (integer < 0 && integer >= -128) {
    return [{ op: 'push_i8', value: Math.abs(integer) }, { op: 'neg' }];
  }
  if (integer >= 0) {
    return [{ op: 'push_i16', value: integer }];
  }
  return [{ op: 'push_i16', value: Math.abs(integer) }, { op: 'neg' }];
}

function parseBackgroundName(name: string): { readonly group: number; readonly variant?: number } | null {
  const match = /^bg_(\d+)(?:_(\d+))?$/i.exec(name);
  if (!match) {
    return null;
  }
  const group = Number(match[1]);
  const rawVariant = match[2];
  return rawVariant === undefined ? { group } : { group, variant: Number(rawVariant) };
}

function bgArguments(args: number, variant: number | undefined): AsmInstruction[] {
  if (args < 7) {
    return Array.from({ length: args }, () => ({ op: 'push_nil' as const }));
  }
  // hcb_build.py::bgset 入参布局（f_00005579 等底座背景函数读取）：
  // - 显式细分编号（1/2/3 -> BGxxx_000/010/020/030）：编号在第七个入参（arg7，即 push_stack index=-5）。
  // - 无细分编号 / 编辑器默认日景（variant 0 = BGxxx_000）：-1 在第八个入参（arg8，即 push_stack index=-4），
  //   底座函数据此直接加载 BGxxx_000，不依赖尚未初始化的时段全局变量。
  if (variant === undefined || variant === 0) {
    return [
      ...Array.from({ length: 7 }, () => ({ op: 'push_nil' as const })),
      ...signedI8(-1),
      ...Array.from({ length: Math.max(0, args - 8) }, () => ({ op: 'push_nil' as const })),
    ];
  }
  return [
    ...Array.from({ length: 6 }, () => ({ op: 'push_nil' as const })),
    ...signedI8(variant),
    ...Array.from({ length: args - 7 }, () => ({ op: 'push_nil' as const })),
  ];
}

const signature: readonly AsmPattern[] = [
  { repeat: { pattern: PUSH, min: 5, max: 11 } },
  { call: true },
];

export const bgsetTemplate: Template<BgsetNode> = {
  id: 'fvp.bgset',
  signature,
  slots: {
    background: { kind: 'label', doc: '背景名（bg_<组号>[_<变体>]）' },
    variant: { kind: 'i8', doc: '背景细分编号' },
  },
  instantiate(node, ctx: TemplateCtx): { label?: string; instructions: readonly AsmInstruction[] }[] {
    const parsed = parseBackgroundName(node.background);
    const direct = ctx.tables.backgrounds[node.background];
    const byGroup = parsed ? ctx.tables.backgrounds[`bg_${parsed.group}`] : undefined;
    const bg = direct ?? byGroup;
    let variant = node.variant ?? parsed?.variant;
    // 旧导入器曾把背景组号误存进 variant（如 bg_240 + variant=240）。
    if (parsed && parsed.variant === undefined && variant === parsed.group) {
      variant = 0;
    }
    const args = bg?.args ?? 10;
    const transition: AsmInstruction[] = [
      { op: 'push_i8', value: 0 },
      { op: 'push_i16', value: 800 },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'call', target: 'f_0004115a' },
    ];
    let load: AsmInstruction[];
    if (bg) {
      load = [
        ...bgArguments(args, variant),
        { op: 'call', target: `f_${bg.fn.toString(16).padStart(8, '0')}` },
      ];
    } else if (parsed) {
      // 未预载背景直接调用 base.chb 的 8 参数底层加载器，支持 graph_bg.bin 中的任意组。
      const resource = `BG${String(parsed.group).padStart(3, '0')}_${String(variant ?? 0).padStart(3, '0')}`;
      const loaderArgs = (name: string): AsmInstruction[] => [
        { op: 'push_string', text: name },
        { op: 'push_nil' },
        { op: 'push_i8', value: 50 },
        { op: 'push_nil' },
        { op: 'push_nil' },
        { op: 'push_nil' },
        { op: 'push_nil' },
        { op: 'push_nil' },
      ];
      load = [
        ...loaderArgs(resource),
        { op: 'call', target: 'f_0003bb96' },
        ...loaderArgs(`${resource}b`),
        { op: 'call', target: 'f_0003bca3' },
      ];
    } else {
      throw new Error(`unknown background name: ${node.background}`);
    }
    return [
      {
        instructions: [
          ...load,
          ...(node.transition === 'none' ? [] : transition),
        ],
      },
    ];
  },
};

export { parseBackgroundName };
