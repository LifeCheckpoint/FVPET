/**
 * 预览脚本投影：EditorDocument → FakeScript（FakeEngine 可消费）。
 * - speak/dia 线性化为文本队列。
 * - bsset 立绘投影为占位 prim（z=layer，坐标取 position）。
 * 真实立绘/CG 的 prim 语义由真实引擎回放补足，此处仅保证 FakeEngine 可驱动。
 */

import { projectToIr, type EditorDocument, type ProjectResources } from '@hcb-editor/editor';
import type { IrHeader } from '@hcb-editor/hcb/ir';
import type { FakePrim, FakeScript } from '@hcb-editor/rfvp';

/** 按 pose/costume/face 组合匹配立绘；face>0 时附带表情叠加切片，未命中回退默认立绘。 */
function characterOverlayAt(
  resources: ProjectResources | undefined,
  name: string,
  pose: number,
  costume: number,
  face: number,
): {
  readonly image: string;
  readonly width?: number;
  readonly height?: number;
  readonly face?: NonNullable<FakePrim['face']>;
} | undefined {
  const char = resources?.characters.find((c) => c.name === name);
  if (!char) {
    return undefined;
  }
  const matched = char.poses?.find((p) => p.pose === pose && p.costume === costume);
  const image = matched?.image ?? char.image;
  if (!image) {
    return undefined;
  }
  if (matched && face > 0 && matched.faces.length > 0 && matched.faceX !== undefined && matched.faceY !== undefined) {
    const f = matched.faces.find((x) => x.face === face);
    if (f) {
      return {
        image,
        ...(matched.bodyWidth !== undefined ? { width: matched.bodyWidth } : {}),
        ...(matched.bodyHeight !== undefined ? { height: matched.bodyHeight } : {}),
        face: {
          image: f.image,
          x: matched.faceX,
          y: matched.faceY,
          width: matched.faceWidth ?? 0,
          height: matched.faceHeight ?? 0,
          bodyWidth: matched.bodyWidth ?? 0,
          bodyHeight: matched.bodyHeight ?? 0,
        },
      };
    }
  }
  return {
    image,
    ...(matched?.bodyWidth !== undefined ? { width: matched.bodyWidth } : {}),
    ...(matched?.bodyHeight !== undefined ? { height: matched.bodyHeight } : {}),
  };
}

export function buildPreviewScript(
  document: EditorDocument,
  header: IrHeader,
  resources?: ProjectResources,
): FakeScript {
  const ir = projectToIr(document, header);
  const texts: { readonly text: string; readonly speaker?: string; readonly audioSrc?: string; readonly choices?: readonly string[] }[] = [];
  const prims: FakePrim[] = [];
  let primId = 0;

  for (const node of ir.nodes) {
    if (node.kind === 'speak') {
      const voiceAudio =
        node.voice !== undefined
          ? resources?.audios.find((a) => a.type === 'voice' && a.number === node.voice)
          : undefined;
      texts.push({
        text: node.text,
        speaker: node.speaker,
        ...(voiceAudio?.src !== undefined ? { audioSrc: voiceAudio.src } : {}),
      });
    } else if (node.kind === 'dia') {
      texts.push({ text: node.text });
    } else if (node.kind === 'audio') {
      const audio = resources?.audios.find((a) => a.type === node.type && a.number === node.channelOrNum);
      texts.push({ text: '', ...(audio?.src !== undefined ? { audioSrc: audio.src } : {}) });
    } else if (node.kind === 'selset') {
      texts.push({ text: '请选择：', choices: node.choices.map((c) => c.text) });
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
    } else if (node.kind === 'cgset') {
      const cg = resources?.cgs.find((c) => c.name.toLowerCase() === node.name.toLowerCase());
      if (cg?.image) {
        prims.push({
          id: primId,
          graphId: 0,
          x: 0,
          y: 0,
          z: -5,
          alpha: 1,
          scale: 1,
          rotate: 0,
          blend: 0,
          image: cg.image,
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
        align: node.loc === 'l' ? 'left' : node.loc === 'r' ? 'right' : 'center',
      };
      if (node.character !== '') {
        prim.label = node.character;
        const overlay = characterOverlayAt(resources, node.character, node.pose, node.costume, node.expression);
        if (overlay) {
          prim.image = overlay.image;
          if (overlay.width !== undefined) {
            prim.w = overlay.width;
          }
          if (overlay.height !== undefined) {
            prim.h = overlay.height;
          }
          if (overlay.face) {
            prim.face = overlay.face;
          }
        }
      }
      prims.push(prim);
      primId += 1;
    }
  }

  return { texts, prims, globals: {} };
}
