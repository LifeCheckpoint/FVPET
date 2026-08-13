/**
 * HCB 整体解码入口：头部 + 指令流 + 函数切分 + CFG。
 * 对应 hcb_ir_core.py 的 decode_hcb / finalize_ir / make_ir。
 */

import { readU32 } from '../core/binary.js';
import { parseSysdesc, type HcbSysdesc } from '../core/header.js';
import { decodeCodeArea, splitFunctions, type FunctionInfo, type Instruction } from '../core/instruction.js';
import { normalizeNls } from '../core/nls.js';
import { buildCfg, type FunctionCfg } from './cfg.js';

export interface DecodedFunction extends FunctionInfo {
  readonly isEntry: boolean;
}

export interface HcbDecoded {
  readonly sysdesc: HcbSysdesc;
  readonly instructions: readonly Instruction[];
  readonly functions: readonly DecodedFunction[];
  readonly cfg: ReadonlyMap<string, FunctionCfg>;
}

export function decodeHcb(data: Uint8Array, nls?: string): HcbDecoded {
  const normalized = normalizeNls(nls);
  if (data.length < 8) {
    throw new Error('HCB too small');
  }
  const sysDescOffset = readU32(data, 0);
  if (sysDescOffset > data.length) {
    throw new Error(`invalid sys_desc_offset ${sysDescOffset}, file size ${data.length}`);
  }
  const sysdesc = parseSysdesc(data, sysDescOffset, normalized);
  const instructions = decodeCodeArea(data, sysDescOffset, sysdesc, normalized);
  const functions = splitFunctions(instructions);

  const funcsByStart = new Map<number, FunctionInfo>(functions.map((f) => [f.startAddr, f]));
  const instByAddr = new Map<number, Instruction>(instructions.map((i) => [i.addr, i]));

  const decodedFunctions: DecodedFunction[] = functions.map((f) => ({
    ...f,
    isEntry: f.startAddr === sysdesc.entryPoint,
  }));

  const cfg = new Map<string, FunctionCfg>();
  for (const func of functions) {
    const insts = func.instructionAddrs
      .map((a) => instByAddr.get(a))
      .filter((i): i is Instruction => i !== undefined);
    cfg.set(func.name, buildCfg(func, insts, funcsByStart));
  }

  return { sysdesc, instructions, functions: decodedFunctions, cfg };
}
