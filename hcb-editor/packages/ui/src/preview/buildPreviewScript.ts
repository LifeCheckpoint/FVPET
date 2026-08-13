/**
 * 预览脚本投影：EditorDocument → FakeScript（FakeEngine 可消费）。
 * - speak/dia 线性化为文本队列。
 * - bsset 立绘投影为占位 prim（z=layer，坐标取 position）。
 * 真实立绘/CG 的 prim 语义由真实引擎回放补足，此处仅保证 FakeEngine 可驱动。
 */

import { projectToIr, type EditorDocument } from '@hcb-editor/editor';
import type { IrHeader } from '@hcb-editor/hcb/ir';
import type { FakePrim, FakeScript } from '@hcb-editor/rfvp';

export function buildPreviewScript(document: EditorDocument, header: IrHeader): FakeScript {
  const ir = projectToIr(document, header);
  const texts: { readonly text: string; readonly speaker?: string }[] = [];
  const prims: FakePrim[] = [];
  let primId = 0;

  for (const node of ir.nodes) {
    if (node.kind === 'speak') {
      texts.push({ text: node.text, speaker: node.speaker });
    } else if (node.kind === 'dia') {
      texts.push({ text: node.text });
    } else if (node.kind === 'bsset') {
      const prim: FakePrim = {
        id: primId,
        graphId: 0,
        x: node.position.x,
        y: node.position.y,
        z: node.layer,
        alpha: 1,
        scale: 1,
        rotate: 0,
        blend: 0,
      };
      if (node.character !== '') {
        prim.label = node.character;
      }
      prims.push(prim);
      primId += 1;
    }
  }

  return { texts, prims, globals: {} };
}
