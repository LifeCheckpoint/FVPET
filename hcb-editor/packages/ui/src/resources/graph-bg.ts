/**
 * 内置背景 / 事件 CG 导入。
 *
 * - graph_bg.bin：VFS 归档，`BG<编号>_<变体>[b]`（编号 = 底座背景号，变体 = 时段，`b` 为次要层）。
 *   背景由「编号」引用，导入为 BackgroundResource（bg_<编号> / bg_<编号>_<变体>）。
 * - graph_vis.bin / graph_vish.bin：事件 CG（2560×1440），条目名即 CG 名。
 *   CG 由「字符串名」引用（HCB 中为大写），导入为 CgResource（名称大写）。
 */

import type { BackgroundResource, CgResource } from '@hcb-editor/editor';
import { parseBinArchive } from './bin.js';
import { decodeHzc1, rgbaToPngDataUrl } from './hzc.js';

/** 底座背景信息（bg_<组号> → 预处理 base.chb 专属函数）。 */
export interface BaseBackgroundInfo {
  readonly fn: number;
  readonly number?: number;
  readonly args?: number;
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
  readonly backgrounds: readonly Omit<BackgroundResource, 'id'>[];
  readonly skipped: number;
  readonly decoded: number;
}

export interface CgBinResult {
  readonly cgs: readonly Omit<CgResource, 'id'>[];
  readonly skipped: number;
  readonly decoded: number;
}

interface CommonOptions {
  readonly maxDimension?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

/** 列表缩略图最长边（平滑降采样，大幅降低大量图片渲染与内存占用）。 */
const THUMB_DIM = 256;

async function decodeImages(bytes: Uint8Array, maxDimension: number): Promise<{ image: string; thumb: string } | null> {
  try {
    const img = await decodeHzc1(bytes);
    const image = rgbaToPngDataUrl(img.width, img.height, img.rgba, maxDimension);
    const thumb = rgbaToPngDataUrl(img.width, img.height, img.rgba, THUMB_DIM);
    return { image, thumb };
  } catch {
    return null;
  }
}

/** 导入背景（graph_bg.bin）：跳过 b 次要层，全量导入各时段变体。 */
export async function importGraphBgBytes(
  bytes: Uint8Array,
  opts: CommonOptions & { readonly baseBackgrounds?: Readonly<Record<string, BaseBackgroundInfo>> } = {},
): Promise<GraphBgResult> {
  const { maxDimension = 1280, baseBackgrounds = {}, onProgress } = opts;
  const entries = parseBinArchive(bytes);

  const bgs: { num: number; variant: number; bytes: Uint8Array }[] = [];
  for (const entry of entries) {
    const parsed = parseBgEntryName(entry.name);
    if (parsed && !parsed.blur) {
      bgs.push({ num: parsed.num, variant: parsed.variant, bytes: entry.bytes });
    }
  }
  bgs.sort((a, b) => a.num - b.num || a.variant - b.variant);

  const backgrounds: Omit<BackgroundResource, 'id'>[] = [];
  let decoded = 0;
  let done = 0;
  for (const bg of bgs) {
    const result = await decodeImages(bg.bytes, maxDimension);
    if (result !== null) {
      const key = `bg_${bg.num}`;
      const base = baseBackgrounds[key];
      const name = bg.variant === 0 ? key : `${key}_${bg.variant}`;
      backgrounds.push({ name, variant: bg.variant, bgFn: base?.fn ?? null, image: result.image, thumb: result.thumb });
      decoded += 1;
    }
    done += 1;
    onProgress?.(done, bgs.length);
  }

  return { backgrounds, skipped: bgs.length - decoded, decoded };
}

/** 导入事件 CG（graph_vis/vish.bin）：全量导入，名称转大写以匹配 HCB 字符串引用。 */
export async function importCgBinBytes(
  bytes: Uint8Array,
  opts: CommonOptions = {},
): Promise<CgBinResult> {
  const { maxDimension = 1024, onProgress } = opts;
  const entries = parseBinArchive(bytes);

  const cgs: Omit<CgResource, 'id'>[] = [];
  let decoded = 0;
  let done = 0;
  for (const entry of entries) {
    if (parseBgEntryName(entry.name) !== null) {
      // 跳过 BG 编号条目（这些属于背景）。
      done += 1;
      continue;
    }
    const result = await decodeImages(entry.bytes, maxDimension);
    if (result !== null) {
      cgs.push({ name: entry.name.toUpperCase(), image: result.image, thumb: result.thumb });
      decoded += 1;
    }
    done += 1;
    onProgress?.(done, entries.length);
  }

  return { cgs, skipped: entries.length - decoded, decoded };
}

/** 从用户选择的文件导入背景。 */
export async function importGraphBgFile(
  file: File,
  opts: CommonOptions & { readonly baseBackgrounds?: Readonly<Record<string, BaseBackgroundInfo>> } = {},
): Promise<GraphBgResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importGraphBgBytes(bytes, opts);
}

/** 从用户选择的文件导入 CG。 */
export async function importCgBinFile(file: File, opts: CommonOptions = {}): Promise<CgBinResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importCgBinBytes(bytes, opts);
}
