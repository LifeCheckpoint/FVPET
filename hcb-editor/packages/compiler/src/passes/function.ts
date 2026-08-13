/**
 * 函数级编译原语（增量编译的地基）。
 * IR 的函数边界 = label 节点（每个 label 到下一个 label 前为一段）。
 * 注意：HCB 代码区地址是连续的，真正「仅重编单函数并保持其余地址不变」需 patchBase
 * 两段拼接支持；此处提供按段编译的最小原语，供上层做缓存/局部重编。
 */

import type { IrScript } from '@hcb-editor/hcb/ir';
import { compile, type CompileCtx } from './compile.js';

export interface IrFunction {
  readonly name: string;
  readonly ir: IrScript;
}

/** 按 label 切分 IR 为函数段；首个 label 之前的节点归入 '@prologue'。 */
export function splitIrFunctions(ir: IrScript): IrFunction[] {
  const out: IrFunction[] = [];
  let currentName = '@prologue';
  let currentNodes: IrScript['nodes'] = [];

  const flush = (): void => {
    if (currentNodes.length > 0) {
      out.push({ name: currentName, ir: { header: ir.header, nodes: currentNodes } });
    }
    currentNodes = [];
  };

  for (const node of ir.nodes) {
    if (node.kind === 'label') {
      flush();
      currentName = node.name;
    } else {
      currentNodes = [...currentNodes, node];
    }
  }
  flush();
  return out;
}

/** 编译单个函数段（label + 段内节点，compile 自动补 ret）。 */
export function compileFunctionSegment(fn: IrFunction, ctx: CompileCtx): Uint8Array {
  return compile({ header: fn.ir.header, nodes: [{ kind: 'label', name: fn.name }, ...fn.ir.nodes] }, ctx);
}
