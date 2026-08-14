/**
 * 五段式编译高层：compile = encode(relocate(layout(assemble(lower(ir))))).
 * 纯函数：输入语义 IR + 编译上下文（底座 sysdesc + 资源表 + nls），输出 HCB 字节。
 */

import { ByteWriter, type HcbSysdesc, type Nls } from '@hcb-editor/hcb/core';
import { decodeHcb, type HcbDecoded } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';
import type { GameTables, TemplateCtx } from '../templates/types.js';
import { assembleFlat, assembleFlatWithLabels } from './assemble.js';
import { encodeFlatItems, encodeFlatItemsCode } from './encode.js';
import { lower, lowerWithNodes, NODE_MARKER_PREFIX } from './lower.js';

/** 底座二进制解码缓存：避免每次编译都重新解析 5MB 原版 HCB。 */
const baseDecodeCache = new WeakMap<Uint8Array, HcbDecoded>();

export function decodeBaseCached(baseData: Uint8Array, nls: Nls): HcbDecoded {
  const cached = baseDecodeCache.get(baseData);
  if (cached) {
    return cached;
  }
  const decoded = decodeHcb(baseData, nls);
  baseDecodeCache.set(baseData, decoded);
  return decoded;
}

export interface CompileCtx {
  readonly sysdesc: HcbSysdesc;
  readonly tables: GameTables;
  readonly nls: Nls;
}
export function compile(ir: IrScript, ctx: CompileCtx): Uint8Array {
  const templateCtx: TemplateCtx = { nls: ctx.nls, tables: ctx.tables };
  const blocks = lower(ir, templateCtx);
  const items = assembleFlat(blocks, ctx.sysdesc, ctx.nls);
  return encodeFlatItems(items, ctx.sysdesc, ctx.nls);
}

export interface CompileWithBaseResult {
  readonly bytes: Uint8Array;
  /** 新编译剧情函数的绝对入口；与保留在 sysdesc 中的底座 launcher entryPoint 不同。 */
  readonly scriptEntry: number;
  /** label → 绝对代码地址（供 label 断点 jump）。 */
  readonly labels: ReadonlyMap<string, number>;
  /** IR 节点索引 → 绝对代码地址（节点首条指令地址，供精确节点定位；comment 等无代码节点缺失）。 */
  readonly nodeAddrs: ReadonlyMap<number, number>;
}

/**
 * patchBase 拼接：底座库代码原样保留 + 新脚本代码追加，库函数地址不变，入口指向新脚本。
 * `extraFuncBytes`（新增角色生成的函数定义体）插入在底座库代码区与新脚本之间，
 * 其地址从 baseCodeEnd 起顺延，入口随之顺移。
 */
export function compileWithBase(
  ir: IrScript,
  ctx: CompileCtx,
  baseData: Uint8Array,
  extraFuncBytes: Uint8Array = new Uint8Array(0),
  mainOffset: number,
  baseNls: Nls,
): Uint8Array {
  return compileWithBaseDetailed(ir, ctx, baseData, extraFuncBytes, mainOffset, baseNls).bytes;
}

/** 字节级替换 bytes 中所有等于 target 的小端 u32 值为 replacement（对齐无关，精确字节序列匹配）。 */
function patchU32References(bytes: Uint8Array, target: number, replacement: number): void {
  const t0 = target & 0xff;
  const t1 = (target >>> 8) & 0xff;
  const t2 = (target >>> 16) & 0xff;
  const t3 = (target >>> 24) & 0xff;
  const r0 = replacement & 0xff;
  const r1 = (replacement >>> 8) & 0xff;
  const r2 = (replacement >>> 16) & 0xff;
  const r3 = (replacement >>> 24) & 0xff;
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === t0 && bytes[i + 1] === t1 && bytes[i + 2] === t2 && bytes[i + 3] === t3) {
      bytes[i] = r0;
      bytes[i + 1] = r1;
      bytes[i + 2] = r2;
      bytes[i + 3] = r3;
    }
  }
}

/** compileWithBase + 返回 label 绝对地址表。 */
export function compileWithBaseDetailed(
  ir: IrScript,
  ctx: CompileCtx,
  baseData: Uint8Array,
  extraFuncBytes: Uint8Array = new Uint8Array(0),
  mainOffset: number,
  baseNls: Nls,
): CompileWithBaseResult {
  const base = decodeBaseCached(baseData, baseNls);
  // 库代码结束 = 剧情 main 插入点（对应 hcb_build.py 的 base_off）。
  const libEnd = mainOffset;
  const libCode = baseData.subarray(4, libEnd).slice();
  const templateCtx: TemplateCtx = { nls: ctx.nls, tables: ctx.tables };
  const { blocks, nodeStartLabels } = lowerWithNodes(ir, templateCtx);
  const { items, labels: relativeLabels } = assembleFlatWithLabels(blocks, base.sysdesc, ctx.nls);
  const scriptStart = libEnd + extraFuncBytes.length;
  const scriptCode = encodeFlatItemsCode(items, scriptStart, ctx.nls);

  // 库代码区里对剧情 main（base_off）的引用改为新脚本起点（参考 hcb_build.py 的入口重定位）。
  patchU32References(libCode, mainOffset, scriptStart);

  // 相对偏移（从 4 起算）→ 绝对地址：scriptStart + (rel - 4)。
  // 合成节点 marker 不进 labels 表，单独收集为「节点索引 → 绝对地址」。
  const labels = new Map<string, number>();
  for (const [name, rel] of relativeLabels) {
    if (name.startsWith(NODE_MARKER_PREFIX)) {
      continue;
    }
    labels.set(name, scriptStart + (rel - 4));
  }
  const nodeAddrs = new Map<number, number>();
  nodeStartLabels.forEach((marker, index) => {
    if (marker === undefined) {
      return;
    }
    const rel = relativeLabels.get(marker);
    if (rel !== undefined) {
      nodeAddrs.set(index, scriptStart + (rel - 4));
    }
  });

  const code = new ByteWriter();
  code.bytes(libCode).bytes(extraFuncBytes).bytes(scriptCode);

  const sysDescOffset = 4 + code.length;
  // 尾部：原 sysdesc 表及其后（启动器 entryPoint、syscall 表、标题）原样保留，不再重序列化。
  const tail = baseData.subarray(base.sysdesc.sysDescOffset);

  const out = new ByteWriter();
  out.u32(sysDescOffset).bytes(code.toBytes()).bytes(tail);
  return { bytes: out.toBytes(), scriptEntry: scriptStart, labels, nodeAddrs };
}
