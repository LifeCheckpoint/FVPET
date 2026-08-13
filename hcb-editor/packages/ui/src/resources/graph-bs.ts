/**
 * graph_bs.bin 内置立绘包导入。
 *
 * graph_bs.bin 是 FVP VFS 归档，内部条目名为：
 *   `CHR_<角色>_<姿势>_<服装>[L|U][_表情]`
 * - `<姿势>`：基 / 幼少基 / 喜 / 悲 …（角色站姿状态）
 * - `<服装>`：私服 / 制服 / メイド服 …（可含下划线，如 `私服_ネコ`）
 * - `L` / `U`：尺寸变体（同一立绘的缩放版），导入时忽略
 * - `_表情`：表情合成图（引擎切脸用图集），导入时忽略
 *
 * 本模块只取「基础立绘」（无 L/U 后缀、非表情合成图），按角色归类，
 * 并把姿势/服装标签映射为稳定的数字索引，直接产出 CharacterPose[]。
 */

import type { CharacterPose } from '@hcb-editor/editor';
import { parseBinArchive } from './bin.js';
import { decodeHzc1, rgbaToPngDataUrl } from './hzc.js';

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
  /** 被忽略的条目数（L/U 变体 + 表情合成图 + 解码失败）。 */
  readonly skipped: number;
  /** 成功解码的基础立绘数。 */
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
  /** PNG 最长边上限（控制内存与体积）；默认 1024。 */
  readonly maxDimension?: number;
  /** 每解码一张基础立绘回调一次（done, total）。 */
  readonly onProgress?: (done: number, total: number) => void;
}

interface BaseEntry {
  readonly character: string;
  readonly pose: string;
  readonly costume: string;
  readonly bytes: Uint8Array;
}

/** 从归档字节导入内置立绘（按角色归类 + 姿势/服装索引映射）。 */
export async function importGraphBsBytes(
  bytes: Uint8Array,
  opts: GraphBsImportOptions = {},
): Promise<GraphBsImportResult> {
  const { maxDimension = 1024, onProgress } = opts;
  const entries = parseBinArchive(bytes);

  const base: BaseEntry[] = [];
  for (const entry of entries) {
    const parsed = parseGraphEntryName(entry.name);
    if (!parsed || parsed.faceSheet || parsed.size !== '') {
      continue;
    }
    base.push({ character: parsed.character, pose: parsed.pose, costume: parsed.costume, bytes: entry.bytes });
  }

  const byCharacter = new Map<string, BaseEntry[]>();
  for (const item of base) {
    const list = byCharacter.get(item.character) ?? [];
    list.push(item);
    byCharacter.set(item.character, list);
  }

  const characters: CharacterSpriteSet[] = [];
  let decoded = 0;
  const characterNames = [...byCharacter.keys()].sort((a, b) => a.localeCompare(b, 'ja'));
  for (const name of characterNames) {
    const items = byCharacter.get(name)!;
    const poseIndex = buildIndexMap(items.map((i) => i.pose), POSE_PRIORITY);
    const costumeIndex = buildIndexMap(items.map((i) => i.costume), []);

    const poses: CharacterPose[] = [];
    for (const item of items) {
      try {
        const img = await decodeHzc1(item.bytes);
        const image = rgbaToPngDataUrl(img.width, img.height, img.rgba, maxDimension);
        poses.push({
          pose: poseIndex.get(item.pose) ?? 0,
          costume: costumeIndex.get(item.costume) ?? 0,
          face: 0,
          image,
        });
        decoded += 1;
      } catch {
        // 解码失败的条目跳过，不计入 decoded。
      }
      onProgress?.(decoded, base.length);
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
