/**
 * 内置音频导入（bgm.bin）。
 * bgm.bin 是 FVP VFS 归档，条目名 `001`..`081`（有空洞），每项为 OGG Vorbis。
 * 音频不做解码，直接转 data URL（audio/ogg）供 HTMLAudioElement 试听。
 */

import type { AudioResource } from '@hcb-editor/editor';
import { parseBinArchive } from './bin.js';

export interface BgmBinResult {
  readonly audios: readonly Omit<AudioResource, 'id'>[];
  readonly skipped: number;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function importBgmBinBytes(bytes: Uint8Array): Promise<BgmBinResult> {
  const entries = parseBinArchive(bytes);
  const audios: Omit<AudioResource, 'id'>[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const number = Number.parseInt(entry.name, 10);
    if (!Number.isFinite(number)) {
      skipped += 1;
      continue;
    }
    if (entry.bytes.length < 4 || String.fromCharCode(entry.bytes[0]!, entry.bytes[1]!, entry.bytes[2]!, entry.bytes[3]!) !== 'OggS') {
      skipped += 1;
      continue;
    }
    audios.push({
      type: 'bgm',
      number,
      label: `BGM ${entry.name}`,
      src: bytesToDataUrl(entry.bytes, 'audio/ogg'),
    });
  }
  return { audios, skipped };
}

/** 从用户选择的文件导入内置音频。 */
export async function importBgmBinFile(file: File): Promise<BgmBinResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importBgmBinBytes(bytes);
}
