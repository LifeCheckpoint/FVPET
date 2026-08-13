/**
 * HCB 二进制读写原语（little-endian）。
 * 对应 hcb_ir_core.py 的 u8/i8/u16/i16/u32/i32/f32 读原语与 w_* 写原语。
 * 纯函数 / 纯类，无 IO，无全局状态。
 */

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readU8(bytes: Uint8Array, off: number): number {
  return view(bytes).getUint8(off);
}

export function readI8(bytes: Uint8Array, off: number): number {
  return view(bytes).getInt8(off);
}

export function readU16(bytes: Uint8Array, off: number): number {
  return view(bytes).getUint16(off, true);
}

export function readI16(bytes: Uint8Array, off: number): number {
  return view(bytes).getInt16(off, true);
}

export function readU32(bytes: Uint8Array, off: number): number {
  return view(bytes).getUint32(off, true);
}

export function readI32(bytes: Uint8Array, off: number): number {
  return view(bytes).getInt32(off, true);
}

export function readF32(bytes: Uint8Array, off: number): number {
  return view(bytes).getFloat32(off, true);
}

/** 累积式字节写出器；encode pass 与 stringpool 共用。 */
export class ByteWriter {
  private chunks: Uint8Array[] = [];
  private total = 0;

  get length(): number {
    return this.total;
  }

  private push(chunk: Uint8Array): this {
    this.chunks.push(chunk);
    this.total += chunk.length;
    return this;
  }

  u8(v: number): this {
    return this.push(Uint8Array.of(v & 0xff));
  }

  i8(v: number): this {
    return this.u8(v & 0xff);
  }

  u16(v: number): this {
    return this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }

  i16(v: number): this {
    return this.u16(v & 0xffff);
  }

  u32(v: number): this {
    return this.push(
      new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]),
    );
  }

  i32(v: number): this {
    return this.u32(v >>> 0);
  }

  f32(v: number): this {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, true);
    return this.push(new Uint8Array(buf));
  }

  bytes(b: Uint8Array): this {
    return this.push(b);
  }

  /** 就地回填 4 字节无符号值（relocate pass 用）。 */
  patchU32At(offset: number, v: number): this {
    const target = this.toBytes();
    target[offset] = v & 0xff;
    target[offset + 1] = (v >>> 8) & 0xff;
    target[offset + 2] = (v >>> 16) & 0xff;
    target[offset + 3] = (v >>> 24) & 0xff;
    this.chunks = [target];
    this.total = target.length;
    return this;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.total);
    let off = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, off);
      off += chunk.length;
    }
    return out;
  }
}
