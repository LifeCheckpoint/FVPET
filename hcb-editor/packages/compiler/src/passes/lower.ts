/**
 * lower pass：语义 IR 节点 → 符号化 AsmBlock（模板实例化）。
 * 纯函数，不碰 IO；地址/字符串/syscall id 均保持符号引用，由 assemble/layout 落地。
 */

import type { CondExpr, IrScript } from '@hcb-editor/hcb/ir';
import {
  audioTemplate,
  bgsetTemplate,
  bssetTemplate,
  diaTemplate,
  selsetTemplate,
  speakTemplate,
  threadTemplate,
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

export function lower(ir: IrScript, ctx: TemplateCtx): AsmBlock[] {
  const blocks: AsmBlock[] = [];
  for (const node of ir.nodes) {
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
      case 'branch':
        blocks.push({
          instructions: [...condToAsm(node.cond), { op: 'jz', target: node.else }, { op: 'jmp', target: node.then }],
        });
        break;
      case 'comment':
        break; // 编译时丢弃
      case 'raw':
        blocks.push({ instructions: [], raw: { bytes: node.bytes, relocations: node.relocations } });
        break;
    }
  }
  // 函数末尾补 ret，保证 CFG 有出口（避免无界环）
  blocks.push({ instructions: [{ op: 'ret' }] });
  return blocks;
}
