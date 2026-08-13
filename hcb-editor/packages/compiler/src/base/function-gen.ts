/**
 * 底座函数定义体生成（emitFunctionDef 的角色侧落地）。
 *
 * FVP 的 SPEAK 名栏函数是「每角色一份」的同构函数（硬编码 styleIndex + 名字字符串）。
 * 新增角色 = 克隆模板角色（底座已有角色）的函数体，替换名字字符串与 styleIndex，
 * 其余字节骨架照抄；函数地址由上层（compileProject）在底座库代码区之后顺延分配。
 *
 * 背景则共享加载函数 f_00037421（仅需资源编号），无需生成函数体，见 base/index.ts。
 */

import type { Nls } from '@hcb-editor/hcb/core';
import { decodeHcb, type HcbDecoded } from '@hcb-editor/hcb/decompile';
import type { FlatItem } from '../passes/assemble.js';
import { encodeFlatItemsCode } from '../passes/encode.js';

function stripSpace(s: string): string {
  return s.replace(/[\u3000 ]/g, '');
}

/**
 * 克隆模板 SPEAK 函数并生成新角色函数字节（仅代码区，相对布局）。
 * 内部 call/jmp/jz 由 encodeFlatItemsCode 按相对地址重定位；
 * 指向底座库的外部 call（styleInit/tail 等）地址不变，由 compileWithBase 保留的底座库兜底。
 */
export function generateSpeakFunctionBytes(
  decoded: HcbDecoded,
  templateSpeakFn: number,
  templateName: string,
  newName: string,
  newStyleIndex: number,
  nls: Nls,
  startAddr: number,
): Uint8Array {
  const instByAddr = new Map(decoded.instructions.map((i) => [i.addr, i]));
  const func = decoded.functions.find((f) => f.startAddr === templateSpeakFn);
  if (!func) {
    throw new Error(`模板 SPEAK 函数不存在：0x${templateSpeakFn.toString(16)}`);
  }
  const insts = func.instructionAddrs.map((a) => instByAddr.get(a)).filter((i) => i !== undefined);

  let namePatched = false;
  let stylePatched = false;

  const patched = insts.map((i, idx) => {
    // 名字替换：名栏显示串（去全角空格后与模板角色名一致）。
    if (!namePatched && i.mnemonic === 'push_string' && i.args.kind === 'string' && stripSpace(i.args.text) === templateName) {
      namePatched = true;
      const text = i.args.text.replace(templateName, newName);
      return {
        ...i,
        args: {
          kind: 'string' as const,
          length: 0,
          text,
          textOriginal: text,
          rawBytes: new Uint8Array(0),
        },
      };
    }
    // styleIndex 替换：push_i8 后紧跟 pop_global 227（说话人样式编号）。
    const next = insts[idx + 1];
    if (
      !stylePatched &&
      i.mnemonic === 'push_i8' &&
      i.args.kind === 'i8' &&
      next?.mnemonic === 'pop_global' &&
      next.args.kind === 'u16' &&
      next.args.index === 227
    ) {
      stylePatched = true;
      return { ...i, args: { kind: 'i8' as const, value: newStyleIndex } };
    }
    return i;
  });

  if (!namePatched) {
    throw new Error(`模板 SPEAK 函数内未找到名字字符串：${templateName}`);
  }

  const items: FlatItem[] = patched.map((inst) => ({ kind: 'inst' as const, inst }));
  return encodeFlatItemsCode(items, startAddr, nls);
}

/**
 * 为多个新角色批量生成函数体，返回拼接后的字节与「角色名 → 绝对地址」映射。
 * 地址从 baseCodeEnd（底座库代码区末尾）起顺延。
 */
export function generateSpeakFunctions(
  baseData: Uint8Array,
  templateSpeakFn: number,
  templateName: string,
  newNames: readonly string[],
  baseCharacterCount: number,
  nls: Nls,
): { readonly bytes: Uint8Array; readonly addresses: ReadonlyMap<string, number> } {
  const decoded = decodeHcb(baseData, nls);
  const baseCodeEnd = decoded.sysdesc.sysDescOffset;

  // 逐函数按绝对地址生成：startAddr 只影响体内 jmp/jz 目标值，不影响字节长度。
  const chunks: Uint8Array[] = [];
  const addresses = new Map<string, number>();
  let offset = 0;
  newNames.forEach((name, i) => {
    const styleIndex = baseCharacterCount + i + 1;
    const addr = baseCodeEnd + offset;
    const bytes = generateSpeakFunctionBytes(decoded, templateSpeakFn, templateName, name, styleIndex, nls, addr);
    addresses.set(name, addr);
    chunks.push(bytes);
    offset += bytes.length;
  });

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return { bytes: out, addresses };
}
