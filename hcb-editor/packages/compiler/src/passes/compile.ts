/**
 * 五段式编译高层：compile = encode(relocate(layout(assemble(lower(ir))))).
 * 纯函数：输入语义 IR + 编译上下文（底座 sysdesc + 资源表 + nls），输出 HCB 字节。
 */

import { ByteWriter, serializeSysdesc, type HcbSysdesc, type Nls } from '@hcb-editor/hcb/core';
import { decodeHcb, type HcbDecoded } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';
import type { GameTables, TemplateCtx } from '../templates/types.js';
import { assembleFlat, assembleFlatWithLabels } from './assemble.js';
import { encodeFlatItems, encodeFlatItemsCode } from './encode.js';
import { lower } from './lower.js';

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
  /** label → 绝对代码地址（供 label 断点 jump）。 */
  readonly labels: ReadonlyMap<string, number>;
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
): Uint8Array {
  return compileWithBaseDetailed(ir, ctx, baseData, extraFuncBytes).bytes;
}

/** compileWithBase + 返回 label 绝对地址表。 */
export function compileWithBaseDetailed(
  ir: IrScript,
  ctx: CompileCtx,
  baseData: Uint8Array,
  extraFuncBytes: Uint8Array = new Uint8Array(0),
): CompileWithBaseResult {
  const base = decodeBaseCached(baseData, ctx.nls);
  const baseCodeEnd = base.sysdesc.sysDescOffset;
  const baseCode = baseData.subarray(4, baseCodeEnd);

  const templateCtx: TemplateCtx = { nls: ctx.nls, tables: ctx.tables };
  const blocks = lower(ir, templateCtx);
  const { items, labels: relativeLabels } = assembleFlatWithLabels(blocks, base.sysdesc, ctx.nls);
  const scriptStart = baseCodeEnd + extraFuncBytes.length;
  const scriptCode = encodeFlatItemsCode(items, scriptStart, ctx.nls);

  // 相对偏移（从 4 起算）→ 绝对地址：scriptStart + (rel - 4)。
  const labels = new Map<string, number>();
  for (const [name, rel] of relativeLabels) {
    labels.set(name, scriptStart + (rel - 4));
  }

  const code = new ByteWriter();
  code.bytes(baseCode).bytes(extraFuncBytes).bytes(scriptCode);

  const sysDescOffset = 4 + code.length;
  const relocatedSysdesc: HcbSysdesc = { ...base.sysdesc, entryPoint: scriptStart };
  const sysdescBytes = serializeSysdesc(relocatedSysdesc, ctx.nls);

  const out = new ByteWriter();
  out.u32(sysDescOffset).bytes(code.toBytes()).bytes(sysdescBytes);
  return { bytes: out.toBytes(), labels };
}
