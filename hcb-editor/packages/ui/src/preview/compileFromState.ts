/**
 * 编辑器状态 → HCB 编译编排（G1 / G10）。
 * - projectToIr 投影后交给 compileProject。
 * - 资源表中 speakFn/bgFn 为 null 的新增资源作为 extraCharacters/extraBackgrounds 传入，
 *   由编译器 emitFunctionDef 生成函数体 / 分配资源编号。
 * - baseData 提供时走 compileWithBase → 可独立运行；为 null 时退化为脚本-only 产物。
 */

import { compileProject, type CompileProjectOptions } from '@hcb-editor/compiler';
import { projectToIr, type EditorState } from '@hcb-editor/editor';

export function compileEditorState(state: EditorState, baseData: Uint8Array | null): Uint8Array {
  const ir = projectToIr(state.document, state.header);
  const extraCharacters = state.resources.characters
    .filter((c) => c.speakFn === null)
    .map((c) => c.name);
  const extraBackgrounds = state.resources.backgrounds
    .filter((b) => b.bgFn === null)
    .map((b) => ({ name: b.name, number: b.variant }));

  const opts: CompileProjectOptions = { extraCharacters, extraBackgrounds };
  if (baseData) {
    opts.baseData = baseData;
  }
  return compileProject(ir, state.header.nls, opts);
}
