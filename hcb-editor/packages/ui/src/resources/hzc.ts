/**
 * hzc1/nvsg 图片解码（FVP 资源格式）。
 * 格式：`"hzc1" + original_length(u32) + header_length(u32=32)` + NVSG 头（32 字节）+ zlib 压缩像素。
 * - type=0 Single24Bit：RGB（背景）
 * - type=1/2 Single/Multi32Bit：BGRA 预乘 alpha（立绘）
 * 像素解压后做 unpremultiply 转标准 RGBA。
 */

export interface HzcImage {
  readonly width: number;
  readonly height: number;
  /** 解预乘后的 RGBA 8-bit 像素（width*height*4）。 */
  readonly rgba: Uint8Array;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
  );
}

/** zlib 解压（Node 18+ 与浏览器均提供 DecompressionStream('deflate')）。 */
async function zlibInflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const stream = new Blob([buffer]).stream().pipeThrough(ds);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

export async function decodeHzc1(bytes: Uint8Array): Promise<HzcImage> {
  if (bytes.length < 44) {
    throw new Error('hzc1 文件过短');
  }
  const sig = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (sig !== 'hzc1') {
    throw new Error(`不是 hzc1 容器：${sig}`);
  }
  const headerLength = readU32LE(bytes, 8);
  if (headerLength < 32) {
    throw new Error('NVSG 头长度非法');
  }

  const nvsg = 12;
  const nvsgSig = String.fromCharCode(bytes[nvsg]!, bytes[nvsg + 1]!, bytes[nvsg + 2]!, bytes[nvsg + 3]!);
  if (nvsgSig !== 'NVSG') {
    throw new Error(`不是 NVSG 图片：${nvsgSig}`);
  }

  const type = readU16LE(bytes, nvsg + 6);
  const width = readU16LE(bytes, nvsg + 8);
  const height = readU16LE(bytes, nvsg + 10);
  const compressed = bytes.subarray(nvsg + headerLength);
  const raw = await zlibInflate(compressed);

  const rgba = new Uint8Array(width * height * 4);
  if (type === 0) {
    // Single24Bit：RGB，无 alpha
    for (let i = 0; i < width * height; i += 1) {
      rgba[i * 4] = raw[i * 3]!;
      rgba[i * 4 + 1] = raw[i * 3 + 1]!;
      rgba[i * 4 + 2] = raw[i * 3 + 2]!;
      rgba[i * 4 + 3] = 255;
    }
  } else if (type === 1 || type === 2) {
    // Single/Multi32Bit：BGRA 预乘 alpha → 解预乘
    for (let i = 0; i < width * height; i += 1) {
      const b = raw[i * 4]!;
      const g = raw[i * 4 + 1]!;
      const r = raw[i * 4 + 2]!;
      const a = raw[i * 4 + 3]!;
      const factor = a > 0 ? 255 / a : 1;
      rgba[i * 4] = Math.min(255, Math.round(r * factor));
      rgba[i * 4 + 1] = Math.min(255, Math.round(g * factor));
      rgba[i * 4 + 2] = Math.min(255, Math.round(b * factor));
      rgba[i * 4 + 3] = a;
    }
  } else {
    throw new Error(`暂不支持 NVSG type=${type}`);
  }

  return { width, height, rgba };
}
