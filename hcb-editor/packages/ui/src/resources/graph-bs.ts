/**
 * graph_bs.bin 内置立绘包导入。
 *
 * graph_bs.bin 是 FVP VFS 归档，内部条目名为：
 *   `CHR_<角色>_<姿势>_<服装>[L|U][_表情]`
 * - `<姿势>`：基 / 幼少基 / 喜 / 悲 …（角色站姿状态）
 * - `<服装>`：私服 / 制服 / メイド服 …（可含下划线，如 `私服_ネコ`）
 * - `L` / `U`：尺寸变体（同一立绘的缩放版），导入时忽略
 * - `_表情`：Multi32Bit 表情切片集（entryCount 张人脸，按 offset 叠加到 body 上）
 *
 * 本模块取「基础立绘」（无 L/U 后缀、非表情合成图）作为 body，
 * 匹配同 (姿势, 服装) 的 `_表情` 切片集，产出层级化的 CharacterPose[]（body + faces）。
 */

import type { CharacterFace, CharacterPose } from '@hcb-editor/editor';
import { parseBinArchive } from './bin.js';
import { decodeHzc1, decodeHzcSlices, rgbaToPngDataUrl } from './hzc.js';

/** 解析后的条目名。 */
export interface GraphEntryName {
  readonly character: string;
  readonly pose: string;
  readonly costume: string;
  readonly size: '' | 'L' | 'U';
  readonly faceSheet: boolean;
}

/** 单个角色的立绘集导入结果。 */
export interface CharacterSpriteSet {
  readonly name: string;
  readonly poses: CharacterPose[];
  readonly defaultPose: number;
  readonly defaultCostume: number;
  readonly image: string | undefined;
}

/** graph_bs.bin 整体导入结果。 */
export interface GraphBsImportResult {
  readonly characters: CharacterSpriteSet[];
  /** 被忽略的条目数（L/U 变体 + 解码失败）。 */
  readonly skipped: number;
  /** 成功解码的图片数（body + 表情切片）。 */
  readonly decoded: number;
}

/** 姿势标签的固定优先级（基 → 幼少基 → 喜 → 悲 → 其他按字典序）。 */
const POSE_PRIORITY: readonly string[] = ['基', '幼少基', '喜', '悲'];

/**
 * 解析 `CHR_<角色>_<姿势>_<服装>[L|U][_表情]` 形式的条目名。
 * 非该形式的名称返回 null。
 */
export function parseGraphEntryName(name: string): GraphEntryName | null {
  if (!name.startsWith('CHR_')) {
    return null;
  }
  const parts = name.slice(4).split('_');
  if (parts.length < 3) {
    return null;
  }
  const character = parts[0]!;
  const pose = parts[1]!;
  let costume = parts.slice(2).join('_');

  let faceSheet = false;
  if (costume.endsWith('_表情')) {
    faceSheet = true;
    costume = costume.slice(0, -'表情'.length - 1);
  }

  let size: '' | 'L' | 'U' = '';
  if (costume.endsWith('L') || costume.endsWith('U')) {
    size = costume.slice(-1) as 'L' | 'U';
    costume = costume.slice(0, -1);
  }

  if (character === '' || pose === '' || costume === '') {
    return null;
  }
  return { character, pose, costume, size, faceSheet };
}

/** 标签 → 稳定索引：优先按 priority 顺序，其余按日语字典序。 */
function buildIndexMap(labels: readonly string[], priority: readonly string[]): Map<string, number> {
  const unique = [...new Set(labels)];
  const ordered = [
    ...priority.filter((p) => unique.includes(p)),
    ...unique.filter((l) => !priority.includes(l)).sort((a, b) => a.localeCompare(b, 'ja')),
  ];
  return new Map(ordered.map((label, index) => [label, index]));
}

export interface GraphBsImportOptions {
  /** body PNG 最长边上限（控制内存与体积）；默认 1024。表情切片尺寸小，不做缩放。 */
  readonly maxDimension?: number;
  /** 每解码一张图片回调一次（done, total）。 */
  readonly onProgress?: (done: number, total: number) => void;
}

interface BaseEntry {
  readonly character: string;
  readonly pose: string;
  readonly costume: string;
  readonly bytes: Uint8Array;
}

/** 从归档字节导入内置立绘（按角色归类 + 姿势/服装索引映射 + 表情切片）。 */
export async function importGraphBsBytes(
  bytes: Uint8Array,
  opts: GraphBsImportOptions = {},
): Promise<GraphBsImportResult> {
  const { maxDimension = 1024, onProgress } = opts;
  const entries = parseBinArchive(bytes);

  const bodiesByCharacter = new Map<string, BaseEntry[]>();
  const facesByCharacter = new Map<string, Map<string, Uint8Array>>();
  for (const entry of entries) {
    const parsed = parseGraphEntryName(entry.name);
    if (!parsed || parsed.size !== '') {
      continue;
    }
    const item: BaseEntry = { character: parsed.character, pose: parsed.pose, costume: parsed.costume, bytes: entry.bytes };
    if (parsed.faceSheet) {
      let byKey = facesByCharacter.get(parsed.character);
      if (!byKey) {
        byKey = new Map();
        facesByCharacter.set(parsed.character, byKey);
      }
      byKey.set(`${parsed.pose}/${parsed.costume}`, entry.bytes);
    } else {
      const list = bodiesByCharacter.get(parsed.character) ?? [];
      list.push(item);
      bodiesByCharacter.set(parsed.character, list);
    }
  }

  const characters: CharacterSpriteSet[] = [];
  let decoded = 0;
  let total = 0;
  for (const bodies of bodiesByCharacter.values()) {
    total += bodies.length;
  }
  let done = 0;

  const characterNames = [...bodiesByCharacter.keys()].sort((a, b) => a.localeCompare(b, 'ja'));
  for (const name of characterNames) {
    const bodies = bodiesByCharacter.get(name)!;
    const faceSheets = facesByCharacter.get(name) ?? new Map<string, Uint8Array>();
    const poseIndex = buildIndexMap(bodies.map((i) => i.pose), POSE_PRIORITY);
    const costumeIndex = buildIndexMap(bodies.map((i) => i.costume), []);

    const poses: CharacterPose[] = [];
    for (const body of bodies) {
      try {
        const img = await decodeHzc1(body.bytes);
        const image = rgbaToPngDataUrl(img.width, img.height, img.rgba, maxDimension);
        decoded += 1;

        const faceBytes = faceSheets.get(`${body.pose}/${body.costume}`);
        let faces: CharacterFace[] = [];
        let faceMeta: { faceX: number; faceY: number; faceWidth: number; faceHeight: number } | undefined;
        if (faceBytes) {
          const slices = await decodeHzcSlices(faceBytes);
          faces = slices.slices.map((slice, idx) => {
            decoded += 1;
            return { face: idx + 1, image: rgbaToPngDataUrl(slices.width, slices.height, slice) };
          });
          faceMeta = { faceX: slices.offsetX, faceY: slices.offsetY, faceWidth: slices.width, faceHeight: slices.height };
        }

        poses.push({
          pose: poseIndex.get(body.pose) ?? 0,
          costume: costumeIndex.get(body.costume) ?? 0,
          image,
          faces,
          ...(faceMeta ?? {}),
          bodyWidth: img.width,
          bodyHeight: img.height,
        });
      } catch {
        // 解码失败的 body 跳过。
      }
      done += 1;
      onProgress?.(done, total);
    }

    poses.sort((a, b) => a.pose - b.pose || a.costume - b.costume);
    const defaultPose = poseIndex.get('基') ?? 0;
    const first = poses.find((p) => p.pose === defaultPose) ?? poses[0];
    characters.push({
      name,
      poses,
      defaultPose: first?.pose ?? 0,
      defaultCostume: first?.costume ?? 0,
      image: first?.image,
    });
  }

  return { characters, skipped: entries.length - decoded, decoded };
}

/** 从用户选择的文件导入内置立绘。 */
export async function importGraphBsFile(
  file: File,
  opts: GraphBsImportOptions = {},
): Promise<GraphBsImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importGraphBsBytes(bytes, opts);
}
