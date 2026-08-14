/**
 * 底座游戏数据加载（数据驱动）。
 * 数据文件由 `hcb-editor extract-base` 从底座 HCB 反编译生成（sysdesc + 角色表）。
 * 换游戏 = 生成一份 `<game>.ts` 数据文件并在 BASES 注册，代码零改动。
 */

import type { HcbSysdesc, Nls, SyscallEntry } from '@hcb-editor/hcb/core';
import type { IrScript } from '@hcb-editor/hcb/ir';
import type { BackgroundEntry, CharacterEntry, CgEntry, GameTables, TemplateCtx } from '../templates/types.js';
import { compileWithBaseDetailed } from '../passes/compile.js';
import { assembleFlatWithLabels } from '../passes/assemble.js';
import { encodeFlatItems } from '../passes/encode.js';
import { lower } from '../passes/lower.js';
import { sakuraMoyuBaseData } from './data/sakura-moyu.js';
import { sakuraMoyuBackgrounds, sakuraMoyuCgs } from './data/sakura-moyu-resources.js';
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
  readonly characters: Readonly<Record<string, CharacterEntry>>;
  readonly backgrounds: Readonly<Record<string, BackgroundEntry>>;
  readonly cgs: Readonly<Record<string, CgEntry>>;
  readonly globals: Readonly<Record<string, number>>;
  /** 剧情 main 脚本插入点（库代码结束），对应 hcb_build.py 的 base_off。 */
  readonly mainOffset: number;
  /** 底座库二进制自身的字符串编码（base.chb 为 gbk，Sakura.hcb 为 sjis）。 */
  readonly nls: Nls;
}

/**
 * 预处理 base.chb 与原版 Sakura.hcb 的资源函数地址空间不同。
 * 这里只注册经 base.chb 字节及 hcb_build.py/cg_loaded.txt 双重核对过的专属函数；
 * 旧提取数据中的共享 0x37421/0x373a5 地址绝不能用于预处理底座。
 */
const SAKURA_MOYU_BACKGROUNDS: Readonly<Record<string, BackgroundEntry>> = Object.fromEntries(
  Object.entries(sakuraMoyuBackgrounds).flatMap(([id, value]) => {
    const entry: BackgroundEntry = { fn: value.fn, number: value.number, args: value.args };
    return [[`bg_${id}`, entry], [value.name, entry]] as const;
  }),
);

const SAKURA_MOYU_CGS: Readonly<Record<string, CgEntry>> = Object.fromEntries(
  Object.entries(sakuraMoyuCgs).map(([name, fn]) => [name, { fn }]),
);

const BASES: Readonly<Record<string, BaseGameData>> = {
  'sakura-moyu': {
    ...sakuraMoyuBaseData,
    backgrounds: SAKURA_MOYU_BACKGROUNDS,
    cgs: SAKURA_MOYU_CGS,
  },
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
  readonly mainOffset: number;
  readonly nls: Nls;
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
      cgs: data.cgs,
      globals: data.globals,
    },
    mainOffset: data.mainOffset,
    nls: data.nls,
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

/** 底座游戏已预载 CG 名（供属性面板校验与下拉）。 */
export function availableBaseCgs(game: string): string[] {
  return Object.keys(loadBaseGame(game).tables.cgs ?? {});
}

export interface CompileProjectOptions {
  /** 底座库二进制（完整原版 HCB）。提供时走 compileWithBase，产物可独立运行。 */
  baseData?: Uint8Array;
  /** 新增角色名（资源表中 speakFn 为 null 者），由 emitFunctionDef 生成 SPEAK 函数体。 */
  extraCharacters?: readonly string[];
  /**
   * 工程背景别名/元数据。仅当编号或 fn 能匹配底座真实专属函数时注册；
   * 未知背景保持未知并在 bgset 编译时报错，绝不回退到原版 Sakura 的无效共享地址。
   */
  extraBackgrounds?: readonly {
    readonly name: string;
    readonly number?: number;
    readonly fn?: number | null;
  }[];
  /** 角色名 → 立绘编号（chaNum）映射，供 bsset 编译真实立绘编号。 */
  characterChaNums?: Readonly<Record<string, number>>;
}

export interface CompileProjectResult {
  readonly bytes: Uint8Array;
  /** 新编译剧情函数的绝对入口；底座模式下不等于保留的 sysdesc launcher entryPoint。 */
  readonly scriptEntry: number;
  /** label → 绝对代码地址（供 label 断点 jump）。 */
  readonly labels: ReadonlyMap<string, number>;
}

/**
 * 语义 IR → HCB：按 IR header.game 加载底座（sysdesc + 表），再走五段式编译。
 * - 提供 baseData：compileWithBase 拼接底座库 → 可独立运行的 .hcb（真实引擎可执行）。
 * - 提供 extraCharacters/extraBackgrounds：新增资源在编译期生成函数体 / 分配编号。
 */
export function compileProject(ir: IrScript, nls: Nls, opts: CompileProjectOptions = {}): Uint8Array {
  return compileProjectDetailed(ir, nls, opts).bytes;
}

/** compileProject + 返回 label 绝对地址表（供真实引擎 label 断点 jump）。 */
export function compileProjectDetailed(ir: IrScript, nls: Nls, opts: CompileProjectOptions = {}): CompileProjectResult {
  const { sysdesc, tables, mainOffset, nls: baseNls } = loadBaseGame(ir.header.game);

  let characters = tables.characters;
  let backgrounds = tables.backgrounds;

  // 工程背景别名：只允许指向当前预处理底座中已验证的专属函数。
  if (opts.extraBackgrounds && opts.extraBackgrounds.length > 0) {
    const merged = { ...backgrounds };
    const canonical = Object.values(backgrounds);
    for (const bg of opts.extraBackgrounds) {
      const byNumber = bg.number !== undefined ? backgrounds[`bg_${bg.number}`] : undefined;
      const byFunction = bg.fn !== undefined && bg.fn !== null
        ? canonical.find((entry) => entry.fn === bg.fn)
        : undefined;
      const resolved = byNumber ?? byFunction;
      if (resolved) {
        merged[bg.name] = resolved;
      }
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
      baseNls,
      mainOffset,
    );
    extraFuncBytes = bytes;
    const merged = { ...characters };
    for (const [name, addr] of addresses) {
      merged[name] = { speakFn: addr };
    }
    characters = merged;
  }

  // 立绘编号映射：把编辑器资源的 chaNum 合并进角色表（bsset 读 chaNum 用）。
  if (opts.characterChaNums) {
    const merged = { ...characters };
    for (const [name, chaNum] of Object.entries(opts.characterChaNums)) {
      merged[name] = { ...(merged[name] ?? { speakFn: 0 }), chaNum };
    }
    characters = merged;
  }

  const ctx = { sysdesc, nls, tables: { characters, backgrounds, cgs: tables.cgs ?? {}, globals: tables.globals } };

  if (opts.baseData) {
    return compileWithBaseDetailed(ir, ctx, opts.baseData, extraFuncBytes, mainOffset, baseNls);
  }

  // 脚本-only：代码区起点为 4，label 相对偏移即绝对地址。
  const templateCtx: TemplateCtx = { nls, tables: ctx.tables };
  const blocks = lower(ir, templateCtx);
  const { items, labels } = assembleFlatWithLabels(blocks, sysdesc, nls);
  return { bytes: encodeFlatItems(items, sysdesc, nls), scriptEntry: 4, labels };
}