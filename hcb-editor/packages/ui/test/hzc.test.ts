import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodeHzc1, decodeHzcSlices } from '../src/resources/hzc.js';
import { parseBinArchive } from '../src/resources/bin.js';

function buildHzc1(width: number, height: number, bgra: Uint8Array): Uint8Array {
  const compressed = deflateSync(bgra);
  const out = new Uint8Array(12 + 32 + compressed.length);
  // hzc1 header
  out.set([0x68, 0x7a, 0x63, 0x31], 0); // "hzc1"
  const dv = new DataView(out.buffer);
  dv.setUint32(4, bgra.length, true); // original_length
  dv.setUint32(8, 32, true); // header_length
  // NVSG header（32 字节）
  out.set([0x4e, 0x56, 0x53, 0x47], 12); // "NVSG"
  dv.setUint16(12 + 6, 1, true); // type = Single32Bit
  dv.setUint16(12 + 8, width, true);
  dv.setUint16(12 + 10, height, true);
  dv.setUint32(12 + 20, 1, true); // entry_count
  out.set(compressed, 44);
  return out;
}

function buildHzcMulti(
  width: number,
  height: number,
  slices: Uint8Array[],
  offsetX: number,
  offsetY: number,
): Uint8Array {
  const all = new Uint8Array(slices.length * width * height * 4);
  slices.forEach((s, i) => all.set(s, i * width * height * 4));
  const compressed = deflateSync(all);
  const out = new Uint8Array(12 + 32 + compressed.length);
  out.set([0x68, 0x7a, 0x63, 0x31], 0); // "hzc1"
  const dv = new DataView(out.buffer);
  dv.setUint32(4, all.length, true); // original_length
  dv.setUint32(8, 32, true); // header_length
  out.set([0x4e, 0x56, 0x53, 0x47], 12); // "NVSG"
  dv.setUint16(12 + 6, 2, true); // type = Multi32Bit
  dv.setUint16(12 + 8, width, true);
  dv.setUint16(12 + 10, height, true);
  dv.setUint16(12 + 12, offsetX, true);
  dv.setUint16(12 + 14, offsetY, true);
  dv.setUint32(12 + 20, slices.length, true); // entry_count
  out.set(compressed, 44);
  return out;
}

describe('decodeHzc1', () => {
  it('decodes 32bit premultiplied BGRA to unpremultiplied RGBA', async () => {
    const bgra = new Uint8Array([
      0, 0, 255, 255, // 纯红
      0, 128, 0, 128, // 绿（预乘：g=128, a=128 → 原 g=255）
    ]);
    const bytes = buildHzc1(2, 1, bgra);
    const img = await decodeHzc1(bytes);

    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    // 像素 0：红
    expect(img.rgba[0]).toBe(255);
    expect(img.rgba[1]).toBe(0);
    expect(img.rgba[2]).toBe(0);
    expect(img.rgba[3]).toBe(255);
    // 像素 1：绿，a=128 → 解预乘 g=255
    expect(img.rgba[4]).toBe(0);
    expect(img.rgba[5]).toBe(255);
    expect(img.rgba[6]).toBe(0);
    expect(img.rgba[7]).toBe(128);
  });
});

describe('decodeHzcSlices', () => {
  it('splits a Multi32Bit face sheet into slices with offset', async () => {
    // 2 张 2×1 的 BGRA 预乘切片
    const s1 = new Uint8Array([
      0, 0, 255, 255, // 红
      0, 255, 0, 255, // 绿
    ]);
    const s2 = new Uint8Array([
      255, 0, 0, 255, // 蓝
      255, 255, 0, 255, // 黄（蓝+绿）
    ]);
    const bytes = buildHzcMulti(2, 1, [s1, s2], 326, 122);
    const res = await decodeHzcSlices(bytes);

    expect(res.width).toBe(2);
    expect(res.height).toBe(1);
    expect(res.entryCount).toBe(2);
    expect(res.offsetX).toBe(326);
    expect(res.offsetY).toBe(122);
    expect(res.slices).toHaveLength(2);
    // 切片 0 像素 0：红（r=255）
    expect(res.slices[0]![0]).toBe(255);
    expect(res.slices[0]![2]).toBe(0);
    // 切片 1 像素 0：蓝（b=255）
    expect(res.slices[1]![2]).toBe(255);
    expect(res.slices[1]![0]).toBe(0);
  });
});

function buildBin(entries: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const names = new TextEncoder().encode(entries.map((e) => e.name).join('\0') + '\0');
  const fileCount = entries.length;
  const filenameTableSize = names.length;
  const entriesOffset = 8;
  const filenameTableOffset = entriesOffset + fileCount * 12;
  const dataStart = filenameTableOffset + filenameTableSize;

  const parts: Uint8Array[] = [];
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, fileCount, true);
  new DataView(header.buffer).setUint32(4, filenameTableSize, true);
  parts.push(header);

  const entryBytes = new Uint8Array(fileCount * 12);
  const dv = new DataView(entryBytes.buffer);
  let nameOff = 0;
  let dataOff = dataStart;
  const dataParts: Uint8Array[] = [];
  for (let i = 0; i < fileCount; i += 1) {
    dv.setUint32(i * 12, nameOff, true);
    dv.setUint32(i * 12 + 4, dataOff, true);
    dv.setUint32(i * 12 + 8, entries[i]!.bytes.length, true);
    nameOff += entries[i]!.name.length + 1;
    dataOff += entries[i]!.bytes.length;
    dataParts.push(entries[i]!.bytes);
  }
  parts.push(entryBytes, names, ...dataParts);

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe('parseBinArchive', () => {
  it('enumerates files by name', () => {
    const bytes = buildBin([
      { name: 'bg_240', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'chr_kuro', bytes: new Uint8Array([4, 5]) },
    ]);
    const entries = parseBinArchive(bytes);
    expect(entries.map((e) => e.name)).toEqual(['bg_240', 'chr_kuro']);
    expect(entries[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(entries[1]!.bytes).toEqual(new Uint8Array([4, 5]));
  });
});
