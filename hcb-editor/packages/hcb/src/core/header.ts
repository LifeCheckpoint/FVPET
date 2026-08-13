/**
 * HCB 系统描述区（sysdesc）解析与序列化。
 * 对应 hcb_ir_core.py 的 read_sysdesc / syscall_by_id。
 *
 * 规范约定：title_len / syscall name_len 一律含结尾 NUL；
 * 未理解字段（game_mode_reserved / custom_syscall_count）原样保留。
 */

import { ByteWriter, readU8, readU16, readU32 } from './binary.js';
import { decodeCString, rawOrEncoded, type Nls } from './nls.js';

export interface SyscallEntry {
  readonly id: number;
  readonly args: number;
  readonly name: string;
  readonly nameOriginal: string;
  /** 含 NUL 的原始字节（round-trip 原样保留用） */
  readonly rawBytes: Uint8Array;
}

export interface HcbSysdesc {
  readonly sysDescOffset: number;
  readonly entryPoint: number;
  readonly nonVolatileGlobalCount: number;
  readonly volatileGlobalCount: number;
  readonly gameMode: number;
  readonly gameModeReserved: number;
  readonly gameTitle: string;
  readonly gameTitleOriginal: string;
  /** 含 NUL 的标题原始字节 */
  readonly titleRawBytes: Uint8Array;
  readonly syscallCount: number;
  readonly syscalls: readonly SyscallEntry[];
  readonly customSyscallCount: number;
  readonly sysdescEndOffset: number;
}

export function parseSysdesc(data: Uint8Array, sysDescOffset: number, nls: Nls): HcbSysdesc {
  let off = sysDescOffset;
  const entryPoint = readU32(data, off);
  off += 4;
  const nonVolatileGlobalCount = readU16(data, off);
  off += 2;
  const volatileGlobalCount = readU16(data, off);
  off += 2;
  const gameMode = readU8(data, off);
  off += 1;
  const gameModeReserved = readU8(data, off);
  off += 1;
  const titleLen = readU8(data, off);
  off += 1;
  const titleRawBytes = data.subarray(off, off + titleLen).slice();
  off += titleLen;
  const gameTitle = decodeCString(titleRawBytes, nls);
  const syscallCount = readU16(data, off);
  off += 2;
  const syscalls: SyscallEntry[] = [];
  for (let idx = 0; idx < syscallCount; idx += 1) {
    const args = readU8(data, off);
    off += 1;
    const nameLen = readU8(data, off);
    off += 1;
    const rawBytes = data.subarray(off, off + nameLen).slice();
    off += nameLen;
    const name = decodeCString(rawBytes, nls);
    syscalls.push({ id: idx, args, name, nameOriginal: name, rawBytes });
  }
  const customSyscallCount = off + 2 <= data.length ? readU16(data, off) : 0;
  off += off + 2 <= data.length ? 2 : 0;

  return {
    sysDescOffset,
    entryPoint,
    nonVolatileGlobalCount,
    volatileGlobalCount,
    gameMode,
    gameModeReserved,
    gameTitle,
    gameTitleOriginal: gameTitle,
    titleRawBytes,
    syscallCount,
    syscalls,
    customSyscallCount,
    sysdescEndOffset: off,
  };
}

export function syscallById(sysdesc: HcbSysdesc): Map<number, SyscallEntry> {
  return new Map(sysdesc.syscalls.map((sc) => [sc.id, sc]));
}

export function serializeSysdesc(sysdesc: HcbSysdesc, nls: Nls): Uint8Array {
  const w = new ByteWriter();
  w.u32(sysdesc.entryPoint);
  w.u16(sysdesc.nonVolatileGlobalCount);
  w.u16(sysdesc.volatileGlobalCount);
  w.u8(sysdesc.gameMode);
  w.u8(sysdesc.gameModeReserved);
  const titleBytes = rawOrEncoded(sysdesc.gameTitle, sysdesc.gameTitleOriginal, sysdesc.titleRawBytes, nls);
  w.u8(titleBytes.length);
  w.bytes(titleBytes);
  w.u16(sysdesc.syscalls.length);
  for (const sc of sysdesc.syscalls) {
    w.u8(sc.args);
    const nameBytes = rawOrEncoded(sc.name, sc.nameOriginal, sc.rawBytes, nls);
    w.u8(nameBytes.length);
    w.bytes(nameBytes);
  }
  w.u16(sysdesc.customSyscallCount);
  return w.toBytes();
}
