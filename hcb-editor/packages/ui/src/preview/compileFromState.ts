/**
 * 编辑器状态 → HCB 编译编排（G1 / G10）。
 * - projectToIr 投影后交给 compileProject。
 * - 资源表中 speakFn/bgFn 为 null 的新增资源作为 extraCharacters/extraBackgrounds 传入，
 *   由编译器 emitFunctionDef 生成函数体 / 分配资源编号。
 * - baseData 提供时走 compileWithBase → 可独立运行；为 null 时退化为脚本-only 产物。
 */

import { compileProjectDetailed, type CompileProjectOptions } from '@hcb-editor/compiler';
import { projectToIr, type EditorState } from '@hcb-editor/editor';
import { formatIssues, validateIr } from '@hcb-editor/hcb/validate';

export interface CompiledEditorOutput {
  readonly bytes: Uint8Array;
  /** 新编译剧情函数的绝对入口；真实预览必须从这里启动，而不是底座 sysdesc launcher。 */
  readonly scriptEntry: number;
  /** label → 绝对代码地址（供真实引擎 label 断点 jump）。 */
  readonly labels: Readonly<Record<string, number>>;
}

export function compileEditorState(state: EditorState, baseData: Uint8Array | null): Uint8Array {
  return compileEditorStateDetailed(state, baseData).bytes;
}

export function compileEditorStateDetailed(state: EditorState, baseData: Uint8Array | null): CompiledEditorOutput {
  const ir = projectToIr(state.document, state.header);
  const issues = validateIr(ir);
  if (issues.length > 0) {
    throw new Error(formatIssues(issues));
  }
  const extraCharacters = state.resources.characters
    .filter((c) => c.speakFn === null)
    .map((c) => c.name);
  const extraBackgrounds = state.resources.backgrounds.map((b) => ({
    name: b.name,
    number: Number(/^bg_(\d+)/i.exec(b.name)?.[1] ?? Number.NaN),
    fn: b.bgFn,
  }));
  const characterChaNums: Record<string, number> = {};
  for (const c of state.resources.characters) {
    if (c.chaNum !== undefined) {
      characterChaNums[c.name] = c.chaNum;
    }
  }

  const opts: CompileProjectOptions = { extraCharacters, extraBackgrounds, characterChaNums };
  if (baseData) {
    opts.baseData = baseData;
  }
  const result = compileProjectDetailed(ir, state.header.nls, opts);
  return {
    bytes: result.bytes,
    scriptEntry: result.scriptEntry,
    labels: Object.fromEntries(result.labels),
  };
}
