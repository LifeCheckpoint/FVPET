/**
 * 底座游戏数据加载（数据驱动）。
 * 数据文件由 `hcb-editor extract-base` 从底座 HCB 反编译生成（sysdesc + 角色表）。
 * 换游戏 = 生成一份 `<game>.ts` 数据文件并在 BASES 注册，代码零改动。
 */

import type { HcbSysdesc, Nls, SyscallEntry } from '@hcb-editor/hcb/core';
import type { IrScript } from '@hcb-editor/hcb/ir';
import type { GameTables } from '../templates/types.js';
import { compile } from '../passes/compile.js';
import { sakuraMoyuBaseData } from './data/sakura-moyu.js';

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

/** 语义 IR → HCB：按 IR header.game 加载底座（sysdesc + 表），再走五段式编译。 */
export function compileProject(ir: IrScript, nls: Nls): Uint8Array {
  const { sysdesc, tables } = loadBaseGame(ir.header.game);
  return compile(ir, { sysdesc, tables, nls });
}
