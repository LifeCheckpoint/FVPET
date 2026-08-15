/**
 * lower pass：语义 IR 节点 → 符号化 AsmBlock（模板实例化）。
 * 纯函数，不碰 IO；地址/字符串/syscall id 均保持符号引用，由 assemble/layout 落地。
 */

import type { CondExpr, IrScript } from '@hcb-editor/hcb/ir';
import {
  audioTemplate,
  bgsetTemplate,
  bsfadeTemplate,
  bssetTemplate,
  cgsetTemplate,
  diaTemplate,
  eyecatchTemplate,
  msgsetTemplate,
  selsetTemplate,
  speakTemplate,
  threadTemplate,
  waitTemplate,
  whiteTemplate,
} from '../templates/index.js';
import type { AsmBlock, AsmInstruction, TemplateCtx } from '../templates/types.js';

function pushValue(value: number | string): AsmInstruction[] {
  if (typeof value === 'string') {
    return [{ op: 'push_string', text: value }];
  }
  if (value >= -128 && value <= 127) {
    return [{ op: 'push_i8', value }];
  }
  if (value >= -32768 && value <= 32767) {
    return [{ op: 'push_i16', value }];
  }
  return [{ op: 'push_i32', value }];
}

function condToAsm(cond: CondExpr): AsmInstruction[] {
  switch (cond.op) {
    case 'eq':
      return [...pushValue(cond.a), ...pushValue(cond.b), { op: 'set_e' }];
    case 'ne':
      return [...pushValue(cond.a), ...pushValue(cond.b), { op: 'set_ne' }];
    case 'gt':
      return [...pushValue(cond.a), ...pushValue(cond.b), { op: 'set_g' }];
    case 'ge':
      return [...pushValue(cond.a), ...pushValue(cond.b), { op: 'set_ge' }];
    case 'lt':
      return [...pushValue(cond.a), ...pushValue(cond.b), { op: 'set_l' }];
    case 'le':
      return [...pushValue(cond.a), ...pushValue(cond.b), { op: 'set_le' }];
    case 'global_eq':
      return [{ op: 'push_global', index: cond.global }, ...pushValue(cond.value), { op: 'set_e' }];
    case 'flag_get':
      return [{ op: 'push_i8', value: cond.flag }, { op: 'syscall', name: 'FlagGet' }];
  }
}

export interface LoweredOutput {
  readonly blocks: AsmBlock[];
  /** 每个 IR 节点（按序）首块的合成 label 名；无代码节点（comment）为 undefined。 */
  readonly nodeStartLabels: readonly (string | undefined)[];
}

/** 节点首块合成 label 前缀（仅用于回填节点地址，不进用户 labels 表）。 */
export const NODE_MARKER_PREFIX = '@__node_';

/**
 * lower + 为每个节点注入零字节合成 label，便于 assemble 阶段回填「节点 → 代码地址」。
 * 合成 label 是空块，不改变任何指令字节 / 布局，只多出 label 地址记录。
 * `entryPrologue` 用于底座游戏在直达剧情入口前执行其原生场景初始化；
 * 脚本-only 编译不传该参数，保持通用输出不变。
 */
export function lowerWithNodes(
  ir: IrScript,
  ctx: TemplateCtx,
  entryPrologue: readonly AsmInstruction[] = [],
): LoweredOutput {
  const blocks: AsmBlock[] = [];
  const nodeStartLabels: (string | undefined)[] = [];
  // 入口函数 prologue：init_stack 建立栈帧。底座专用初始化紧随其后，
  // 且位于首个节点 marker 之前，因此节点地址会自动包含序言偏移。
  blocks.push({ instructions: [{ op: 'init_stack', args: 0, locals: 0 }, ...entryPrologue] });
  for (let i = 0; i < ir.nodes.length; i += 1) {
    const node = ir.nodes[i]!;
    if (node.kind === 'comment') {
      nodeStartLabels.push(undefined);
      continue;
    }
    const marker = `${NODE_MARKER_PREFIX}${i}`;
    blocks.push({ label: marker, instructions: [] });
    nodeStartLabels.push(marker);
    switch (node.kind) {
      case 'label':
        blocks.push({ label: node.name, instructions: [] });
        break;
      case 'speak':
        blocks.push(...speakTemplate.instantiate(node, ctx));
        break;
      case 'dia':
        blocks.push(...diaTemplate.instantiate(node, ctx));
        break;
      case 'bsset':
        blocks.push(...bssetTemplate.instantiate(node, ctx));
        break;
      case 'bgset':
        blocks.push(...bgsetTemplate.instantiate(node, ctx));
        break;
      case 'cgset':
        blocks.push(...cgsetTemplate.instantiate(node, ctx));
        break;
      case 'selset':
        blocks.push(...selsetTemplate.instantiate(node, ctx));
        break;
      case 'audio':
        blocks.push(...audioTemplate.instantiate(node, ctx));
        break;
      case 'thread':
        blocks.push(...threadTemplate.instantiate(node, ctx));
        break;
      case 'jump':
        blocks.push({ instructions: [{ op: 'jmp', target: node.target }] });
        break;
      case 'wait':
        blocks.push(...waitTemplate.instantiate(node, ctx));
        break;
      case 'msgset':
        blocks.push(...msgsetTemplate.instantiate(node, ctx));
        break;
      case 'eyecatch':
        blocks.push(...eyecatchTemplate.instantiate(node, ctx));
        break;
      case 'bsfade':
        blocks.push(...bsfadeTemplate.instantiate(node, ctx));
        break;
      case 'white':
        blocks.push(...whiteTemplate.instantiate(node, ctx));
        break;
      case 'branch':
        blocks.push({
          instructions: [...condToAsm(node.cond), { op: 'jz', target: node.else }, { op: 'jmp', target: node.then }],
        });
        break;
      case 'raw':
        blocks.push({ instructions: [], raw: { bytes: node.bytes, relocations: node.relocations } });
        break;
    }
  }
  // 函数末尾补 ret，保证 CFG 有出口（避免无界环）
  blocks.push({ instructions: [{ op: 'ret' }] });
  return { blocks, nodeStartLabels };
}

export function lower(ir: IrScript, ctx: TemplateCtx): AsmBlock[] {
  return lowerWithNodes(ir, ctx).blocks;
}
