/**
 * 底座游戏数据加载（数据驱动）。
 * 数据文件由 `hcb-editor extract-base` 从底座 HCB 反编译生成（sysdesc + 角色表）。
 * 换游戏 = 生成一份 `<game>.ts` 数据文件并在 BASES 注册，代码零改动。
 */

import type { HcbSysdesc, Nls, SyscallEntry } from '@hcb-editor/hcb/core';
import type { IrScript } from '@hcb-editor/hcb/ir';
import type { GameTables } from '../templates/types.js';
import { compile, compileWithBase } from '../passes/compile.js';
import { sakuraMoyuBaseData } from './data/sakura-moyu.js';
import { generateSpeakFunctions } from './function-gen.js';

interface BaseSyscallData {
  readonly args: number;
  readonly name: string;
}

interface BaseSysdescData {
  readonly entryPoint: number;
  readonly nonVolatileGlobalCount: number;
  readonly volatileGlobalCount: number;
  readonly gameMode: number;
  readonly gameModeReserved: number;
  readonly gameTitle: string;
  readonly syscalls: readonly BaseSyscallData[];
  readonly customSyscallCount: number;
}

interface BaseGameData {
  readonly sysdesc: BaseSysdescData;
  readonly characters: Readonly<Record<string, { readonly speakFn: number }>>;
  readonly backgrounds: Readonly<Record<string, { readonly fn: number; readonly number: number }>>;
  readonly globals: Readonly<Record<string, number>>;
}

const BASES: Readonly<Record<string, BaseGameData>> = {
  'sakura-moyu': sakuraMoyuBaseData,
};

function toSysdesc(data: BaseSysdescData): HcbSysdesc {
  const syscalls: SyscallEntry[] = data.syscalls.map((s, id) => ({
    id,
    args: s.args,
    name: s.name,
    nameOriginal: s.name,
    // 重新编码：rawOrEncoded 在 rawBytes 为空时会按 nls 重编码名字。
    rawBytes: new Uint8Array(0),
  }));
  return {
    sysDescOffset: 0,
    // 编译出的新脚本入口固定为代码区起点 4（底座原 entryPoint 仅对原版 HCB 有意义）。
    entryPoint: 4,
    nonVolatileGlobalCount: data.nonVolatileGlobalCount,
    volatileGlobalCount: data.volatileGlobalCount,
    gameMode: data.gameMode,
    gameModeReserved: data.gameModeReserved,
    gameTitle: data.gameTitle,
    gameTitleOriginal: data.gameTitle,
    titleRawBytes: new Uint8Array(0),
    syscallCount: syscalls.length,
    syscalls,
    customSyscallCount: data.customSyscallCount,
    sysdescEndOffset: 0,
  };
}

export interface LoadedBase {
  readonly sysdesc: HcbSysdesc;
  readonly tables: GameTables;
}

export function loadBaseGame(game: string): LoadedBase {
  const data = BASES[game];
  if (!data) {
    throw new Error(`未知底座游戏：${game}`);
  }
  return {
    sysdesc: toSysdesc(data.sysdesc),
    tables: {
      characters: data.characters,
      backgrounds: data.backgrounds,
      globals: data.globals,
    },
  };
}
/** 已注册的底座游戏 id 列表（供 UI 选择）。 */
export function availableBaseGames(): string[] {
  return Object.keys(BASES);
}

/** 底座游戏已有角色名（供属性面板 speaker 下拉）。 */
export function availableBaseCharacters(game: string): string[] {
  return Object.keys(loadBaseGame(game).tables.characters);
}

/** 底座游戏已有背景名（供属性面板 background 下拉）。 */
export function availableBaseBackgrounds(game: string): string[] {
  return Object.keys(loadBaseGame(game).tables.backgrounds);
}

export interface CompileProjectOptions {
  /** 底座库二进制（完整原版 HCB）。提供时走 compileWithBase，产物可独立运行。 */
  baseData?: Uint8Array;
  /** 新增角色名（资源表中 speakFn 为 null 者），由 emitFunctionDef 生成 SPEAK 函数体。 */
  extraCharacters?: readonly string[];
  /** 新增背景（资源表中 bgFn 为 null 者），共享加载函数，仅分配资源编号。 */
  extraBackgrounds?: readonly { readonly name: string; readonly number?: number }[];
}

/** Sakura moyu 背景/立绘资源加载共享函数（无专用函数体时回退值）。 */
const SHARED_BG_LOADER = 0x00037421;

/**
 * 语义 IR → HCB：按 IR header.game 加载底座（sysdesc + 表），再走五段式编译。
 * - 提供 baseData：compileWithBase 拼接底座库 → 可独立运行的 .hcb（真实引擎可执行）。
 * - 提供 extraCharacters/extraBackgrounds：新增资源在编译期生成函数体 / 分配编号。
 */
export function compileProject(ir: IrScript, nls: Nls, opts: CompileProjectOptions = {}): Uint8Array {
  const { sysdesc, tables } = loadBaseGame(ir.header.game);

  let characters = tables.characters;
  let backgrounds = tables.backgrounds;

  // 新增背景：共享加载函数，仅分配资源编号。
  if (opts.extraBackgrounds && opts.extraBackgrounds.length > 0) {
    const sharedFn = Object.values(backgrounds)[0]?.fn ?? SHARED_BG_LOADER;
    const maxNumber = Math.max(0, ...Object.values(backgrounds).map((b) => b.number ?? 0));
    const merged = { ...backgrounds };
    let next = maxNumber;
    for (const bg of opts.extraBackgrounds) {
      const given = bg.number !== undefined && bg.number > 0 ? bg.number : undefined;
      const number = given ?? next + 1;
      merged[bg.name] = { fn: sharedFn, number };
      next = number;
    }
    backgrounds = merged;
  }

  // 新增角色：克隆模板角色函数体生成定义（需底座库二进制）。
  let extraFuncBytes: Uint8Array = new Uint8Array(0);
  if (opts.extraCharacters && opts.extraCharacters.length > 0) {
    if (!opts.baseData) {
      throw new Error('新增角色需要底座库二进制（baseData）才能生成 SPEAK 函数体');
    }
    const templateName = Object.keys(tables.characters)[0];
    const template = templateName ? tables.characters[templateName] : undefined;
    if (!templateName || !template) {
      throw new Error('底座游戏无可用模板角色');
    }
    const { bytes, addresses } = generateSpeakFunctions(
      opts.baseData,
      template.speakFn,
      templateName,
      opts.extraCharacters,
      Object.keys(tables.characters).length,
      nls,
    );
    extraFuncBytes = bytes;
    const merged = { ...characters };
    for (const [name, addr] of addresses) {
      merged[name] = { speakFn: addr };
    }
    characters = merged;
  }

  const ctx = { sysdesc, nls, tables: { characters, backgrounds, globals: tables.globals } };

  if (opts.baseData) {
    return compileWithBase(ir, ctx, opts.baseData, extraFuncBytes);
  }
  return compile(ir, ctx);
}