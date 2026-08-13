/**
 * 预览脚本投影：EditorDocument → FakeScript（FakeEngine 可消费）。
 * - speak/dia 线性化为文本队列。
 * - bsset 立绘投影为占位 prim（z=layer，坐标取 position）。
 * 真实立绘/CG 的 prim 语义由真实引擎回放补足，此处仅保证 FakeEngine 可驱动。
 */

import { projectToIr, type EditorDocument, type ProjectResources } from '@hcb-editor/editor';
import type { IrHeader } from '@hcb-editor/hcb/ir';
import type { FakePrim, FakeScript } from '@hcb-editor/rfvp';

/** 按 pose/costume/face 组合匹配立绘；未命中回退默认立绘。 */
function characterImageAt(
  resources: ProjectResources | undefined,
  name: string,
  pose: number,
  costume: number,
  face: number,
): string | undefined {
  const char = resources?.characters.find((c) => c.name === name);
  if (!char) {
    return undefined;
  }
  const matched = char.poses?.find((p) => p.pose === pose && p.costume === costume && p.face === face);
  return matched?.image ?? char.image;
}

export function buildPreviewScript(
  document: EditorDocument,
  header: IrHeader,
  resources?: ProjectResources,
): FakeScript {
  const ir = projectToIr(document, header);
  const texts: { readonly text: string; readonly speaker?: string; readonly audioSrc?: string }[] = [];
  const prims: FakePrim[] = [];
  let primId = 0;

  for (const node of ir.nodes) {
    if (node.kind === 'speak') {
      texts.push({ text: node.text, speaker: node.speaker });
    } else if (node.kind === 'dia') {
      texts.push({ text: node.text });
    } else if (node.kind === 'audio') {
      const audio = resources?.audios.find((a) => a.type === node.type && a.number === node.channelOrNum);
      texts.push({ text: '', ...(audio?.src !== undefined ? { audioSrc: audio.src } : {}) });
    } else if (node.kind === 'bgset') {
      const bg = resources?.backgrounds.find((b) => b.name === node.background);
      if (bg?.image) {
        prims.push({
          id: primId,
          graphId: 0,
          x: 0,
          y: 0,
          z: -10,
          alpha: 1,
          scale: 1,
          rotate: 0,
          blend: 0,
          image: bg.image,
          fullscreen: true,
        });
        primId += 1;
      }
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
        const img = characterImageAt(resources, node.character, node.pose, node.costume, node.expression);
        if (img) {
          prim.image = img;
        }
      }
      prims.push(prim);
      primId += 1;
    }
  }

  return { texts, prims, globals: {} };
}
