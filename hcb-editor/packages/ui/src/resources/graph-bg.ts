/**
 * 内置背景 / 事件 CG 导入（graph_bg.bin / graph_vis.bin / graph_vish.bin）。
 *
 * 三者都是 FVP VFS 归档，条目为 hzc1 图片：
 * - graph_bg.bin：`BG<编号>_<变体>[b]`，编号 = 底座背景号，变体 = 时段（000 白天/010 黄昏/020 夜晚…），
 *   `b` 后缀为次要层；全量导入（默认变体命名 `bg_<编号>`，其余命名 `bg_<编号>_<变体>`）。
 * - graph_vis.bin / graph_vish.bin：事件 CG（2560×1440），条目名即 CG 名，全部导入。
 */

import type { BackgroundResource } from '@hcb-editor/editor';
import { parseBinArchive } from './bin.js';
import { decodeHzc1, rgbaToPngDataUrl } from './hzc.js';

/** 底座背景信息（bg_<编号> → 函数地址 / 引擎编号；引擎编号可缺省）。 */
export interface BaseBackgroundInfo {
  readonly fn: number;
  readonly number?: number;
}

/** 解析 `BG<编号>_<变体>[b]`；非该形式返回 null。 */
export function parseBgEntryName(name: string): { readonly num: number; readonly variant: number; readonly blur: boolean } | null {
  const m = /^BG(\d+)_(\d+)(b)?$/.exec(name);
  if (!m) {
    return null;
  }
  return { num: Number(m[1]), variant: Number(m[2] ?? 0), blur: m[3] === 'b' };
}

export interface GraphBgResult {
  /** 导入的背景（CG 亦作为背景，全屏显示）。 */
  readonly backgrounds: readonly Omit<BackgroundResource, 'id'>[];
  /** 被忽略 / 失败的条目数。 */
  readonly skipped: number;
  /** 成功解码的图片数。 */
  readonly decoded: number;
}

export interface GraphBgOptions {
  /** PNG 最长边上限（控制内存与体积）；默认 1280。 */
  readonly maxDimension?: number;
  /** 底座背景表（用于给 BG 编号匹配真实 bgFn / 引擎编号）。 */
  readonly baseBackgrounds?: Readonly<Record<string, BaseBackgroundInfo>>;
  readonly onProgress?: (done: number, total: number) => void;
}

export async function importGraphBgBytes(
  bytes: Uint8Array,
  opts: GraphBgOptions = {},
): Promise<GraphBgResult> {
  const { maxDimension = 1280, baseBackgrounds = {}, onProgress } = opts;
  const entries = parseBinArchive(bytes);

  // 分类：BG 背景（跳过 b 次要层）全量导入；其余按 CG 全量。
  const bgs: { num: number; variant: number; bytes: Uint8Array }[] = [];
  const cgs: { name: string; bytes: Uint8Array }[] = [];
  for (const entry of entries) {
    const parsed = parseBgEntryName(entry.name);
    if (parsed && !parsed.blur) {
      bgs.push({ num: parsed.num, variant: parsed.variant, bytes: entry.bytes });
    } else if (!parsed) {
      cgs.push({ name: entry.name, bytes: entry.bytes });
    }
  }
  bgs.sort((a, b) => a.num - b.num || a.variant - b.variant);

  const backgrounds: Omit<BackgroundResource, 'id'>[] = [];
  let decoded = 0;
  const total = bgs.length + cgs.length;
  let done = 0;

  const decode = async (bytesToDecode: Uint8Array): Promise<string | null> => {
    try {
      const img = await decodeHzc1(bytesToDecode);
      return rgbaToPngDataUrl(img.width, img.height, img.rgba, maxDimension);
    } catch {
      return null;
    }
  };

  for (const bg of bgs) {
    const image = await decode(bg.bytes);
    if (image !== null) {
      const key = `bg_${bg.num}`;
      const base = baseBackgrounds[key];
      const name = bg.variant === 0 ? key : `${key}_${bg.variant}`;
      backgrounds.push({ name, variant: base?.number ?? bg.num, bgFn: base?.fn ?? null, image });
      decoded += 1;
    }
    done += 1;
    onProgress?.(done, total);
  }

  for (const cg of cgs) {
    const image = await decode(cg.bytes);
    if (image !== null) {
      backgrounds.push({ name: cg.name, variant: 0, bgFn: null, image });
      decoded += 1;
    }
    done += 1;
    onProgress?.(done, total);
  }

  return { backgrounds, skipped: entries.length - decoded, decoded };
}

/** 从用户选择的文件导入背景/CG。 */
export async function importGraphBgFile(
  file: File,
  opts: GraphBgOptions = {},
): Promise<GraphBgResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importGraphBgBytes(bytes, opts);
}
