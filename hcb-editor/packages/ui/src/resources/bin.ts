/**
 * .bin 资源包解析（FVP VFS 归档）。
 * 格式：`u32 file_count + u32 filename_table_size` + file_count×{u32 name_off, u32 data_off, u32 data_size}
 *      + 文件名表（NUL 结尾字符串）。
 */

export interface BinEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
  );
}

function decodeName(bytes: Uint8Array): string {
  try {
    return new TextDecoder('shift-jis').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function parseBinArchive(bytes: Uint8Array): BinEntry[] {
  if (bytes.length < 8) {
    throw new Error('.bin 文件过短');
  }
  const fileCount = readU32LE(bytes, 0);
  const filenameTableSize = readU32LE(bytes, 4);
  const entriesOffset = 8;
  const filenameTableOffset = entriesOffset + fileCount * 12;

  // 文件名表：offset → 名字（NUL 结尾）
  const nameAt = new Map<number, string>();
  {
    let start = filenameTableOffset;
    const end = Math.min(filenameTableOffset + filenameTableSize, bytes.length);
    while (start < end) {
      const nameOffset = start - filenameTableOffset;
      let i = start;
      while (i < end && bytes[i] !== 0) {
        i += 1;
      }
      nameAt.set(nameOffset, decodeName(bytes.subarray(start, i)));
      start = i + 1;
    }
  }

  const entries: BinEntry[] = [];
  for (let i = 0; i < fileCount; i += 1) {
    const eo = entriesOffset + i * 12;
    if (eo + 12 > bytes.length) {
      break;
    }
    const nameOff = readU32LE(bytes, eo);
    const dataOff = readU32LE(bytes, eo + 4);
    const dataSize = readU32LE(bytes, eo + 8);
    const name = nameAt.get(nameOff) ?? `file_${i}`;
    entries.push({ name, bytes: bytes.slice(dataOff, dataOff + dataSize) });
  }
  return entries;
}
