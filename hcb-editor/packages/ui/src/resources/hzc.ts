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

export interface HzcSlices {
  readonly width: number;
  readonly height: number;
  /** 叠加偏移（Multi32Bit 表情切片相对 body 左上角）。 */
  readonly offsetX: number;
  readonly offsetY: number;
  /** 切片数量（Multi32Bit = 表情数；Single = 1）。 */
  readonly entryCount: number;
  /** 解预乘后的 RGBA 8-bit 切片数组（每片 width*height*4）。 */
  readonly slices: Uint8Array[];
}

/** 解析 NVSG 头 + 解压 + 解预乘为完整 RGBA 像素流（entryCount × width × height）。 */
async function decodeHzcRaw(bytes: Uint8Array): Promise<{
  readonly type: number;
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly entryCount: number;
  readonly rgba: Uint8Array;
}> {
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
  const offsetX = readU16LE(bytes, nvsg + 12);
  const offsetY = readU16LE(bytes, nvsg + 14);
  const entryCount = readU32LE(bytes, nvsg + 20) || 1;
  const compressed = bytes.subarray(nvsg + headerLength);
  const raw = await zlibInflate(compressed);

  const pixelCount = width * height * entryCount;
  const rgba = new Uint8Array(pixelCount * 4);
  if (type === 0) {
    // Single24Bit：RGB，无 alpha
    for (let i = 0; i < pixelCount; i += 1) {
      rgba[i * 4] = raw[i * 3]!;
      rgba[i * 4 + 1] = raw[i * 3 + 1]!;
      rgba[i * 4 + 2] = raw[i * 3 + 2]!;
      rgba[i * 4 + 3] = 255;
    }
  } else if (type === 1 || type === 2) {
    // Single/Multi32Bit：BGRA 预乘 alpha → 解预乘
    for (let i = 0; i < pixelCount; i += 1) {
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

  return { type, width, height, offsetX, offsetY, entryCount, rgba };
}

/** 解码单张立绘（body 等 Single 类型：取第一片）。 */
export async function decodeHzc1(bytes: Uint8Array): Promise<HzcImage> {
  const { width, height, rgba } = await decodeHzcRaw(bytes);
  return { width, height, rgba: rgba.slice(0, width * height * 4) };
}

/** 解码全部切片（Multi32Bit 表情集：entryCount 张人脸）。 */
export async function decodeHzcSlices(bytes: Uint8Array): Promise<HzcSlices> {
  const { width, height, offsetX, offsetY, entryCount, rgba } = await decodeHzcRaw(bytes);
  const sliceLen = width * height * 4;
  const slices: Uint8Array[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    slices.push(rgba.slice(i * sliceLen, (i + 1) * sliceLen));
  }
  return { width, height, offsetX, offsetY, entryCount, slices };
}

/**
 * RGBA 像素 → PNG data URL（浏览器 Canvas）。
 * 当 maxDimension 给定时，等比缩放到最长边不超过该值（控制内存占用与导出体积）。
 */
export function rgbaToPngDataUrl(
  width: number,
  height: number,
  rgba: Uint8Array,
  maxDimension?: number,
): string {
  const canvas = document.createElement('canvas');
  let targetW = width;
  let targetH = height;
  if (maxDimension && Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    targetW = Math.max(1, Math.round(width * scale));
    targetH = Math.max(1, Math.round(height * scale));
  }
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 Canvas 2D 上下文');
  }
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  if (targetW !== width || targetH !== height) {
    // 先铺到离屏整幅画布，再缩绘到目标画布，避免创建多余中间对象。
    const full = document.createElement('canvas');
    full.width = width;
    full.height = height;
    const fullCtx = full.getContext('2d');
    if (!fullCtx) {
      throw new Error('无法创建 Canvas 2D 上下文');
    }
    fullCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, 0, 0, targetW, targetH);
  } else {
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas.toDataURL('image/png');
}
