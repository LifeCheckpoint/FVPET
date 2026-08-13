/**
 * 模板系统类型契约（数据驱动核心）。
 * 模板 = signature（反编译识别）+ slots（命名槽位）+ instantiate（调用点展开）+ emitFunctionDef（函数定义体）。
 */

import type { Nls } from '@hcb-editor/hcb/core';

/** 符号化指令：地址/字符串/id 均为符号引用，由 assemble/layout pass 落地。 */
export type AsmInstruction =
  | { op: 'init_stack'; args: number; locals: number }
  | { op: 'call'; target: string }
  | { op: 'syscall'; name: string }
  | { op: 'ret' }
  | { op: 'retv' }
  | { op: 'jmp'; target: string }
  | { op: 'jz'; target: string }
  | { op: 'push_nil' }
  | { op: 'push_true' }
  | { op: 'push_i32'; value: number }
  | { op: 'push_i16'; value: number }
  | { op: 'push_i8'; value: number }
  | { op: 'push_f32'; value: number }
  | { op: 'push_string'; text: string }
  | { op: 'push_global'; index: number }
  | { op: 'push_stack'; index: number }
  | { op: 'push_global_table'; index: number }
  | { op: 'push_local_table'; index: number }
  | { op: 'push_top' }
  | { op: 'push_return' }
  | { op: 'pop_global'; index: number }
  | { op: 'pop_stack'; index: number }
  | { op: 'pop_global_table'; index: number }
  | { op: 'pop_local_table'; index: number }
  | { op: 'neg' }
  | { op: 'add' }
  | { op: 'sub' }
  | { op: 'mul' }
  | { op: 'div' }
  | { op: 'mod' }
  | { op: 'bit_test' }
  | { op: 'and' }
  | { op: 'or' }
  | { op: 'set_e' }
  | { op: 'set_ne' }
  | { op: 'set_g' }
  | { op: 'set_ge' }
  | { op: 'set_l' }
  | { op: 'set_le' };

export interface AsmBlock {
  readonly label?: string;
  readonly instructions: readonly AsmInstruction[];
  /** raw 逃生舱：字节透传 + 重定位重算（call/jmp/jz/thread_start_fn）。 */
  readonly raw?: {
    readonly bytes: Uint8Array;
    readonly relocations: readonly RawRelocation[];
  };
}

/** raw 块内的重定位声明。 */
export interface RawRelocation {
  readonly kind: 'call' | 'jmp' | 'jz' | 'thread_start_fn' | 'string_ref';
  readonly offset: number;
  readonly target: string;
}

/** 反编译识别签名：一条指令模式。 */
export type AsmPattern =
  | { readonly mnemonic: string } // 精确 mnemonic
  | { readonly anyOf: readonly string[] } // 任一 mnemonic
  | { readonly syscall: string } // 特定 syscall 名
  | { readonly syscallAny: readonly string[] } // 任一 syscall 名
  | { readonly call: true } // 任意 call
  | { readonly callTo: number } // call 到特定地址
  | { readonly callToAny: readonly number[] } // call 到任一地址（如 SPEAK 函数族）
  | { readonly repeat: { readonly pattern: AsmPattern; readonly min?: number; readonly max?: number } }; // 重复

export interface SlotSpec {
  readonly kind: 'global' | 'string' | 'i8' | 'i16' | 'i32' | 'label';
  readonly index?: number; // global 槽的 G[] 索引
  readonly doc?: string;
}

export interface CharacterEntry {
  readonly speakFn: number; // SPEAK 函数地址
  readonly chaNum?: number; // 立绘角色编号（bsset 第一入参）
  readonly alias?: Readonly<Record<string, number>>; // 别名 -> 名义编号
  readonly extraArgs?: number; // SPEAK 额外 nil 入参数（普通 1，大雅 3）
}

export interface BackgroundEntry {
  readonly fn: number; // 背景加载函数地址（Sakura moyu 为共享 f_00037421）
  readonly number?: number; // 背景资源编号（push_i16 入参）
}

export interface GameTables {
  readonly characters: Readonly<Record<string, CharacterEntry>>;
  readonly backgrounds: Readonly<Record<string, BackgroundEntry>>;
  readonly globals: Readonly<Record<string, number>>;
}

export interface TemplateCtx {
  readonly nls: Nls;
  readonly tables: GameTables;
}

export interface ResourceEntry {
  readonly name: string;
  readonly [key: string]: unknown;
}

export interface Template<N = unknown> {
  readonly id: string;
  readonly signature: readonly AsmPattern[];
  readonly slots: Readonly<Record<string, SlotSpec>>;
  instantiate(node: N, ctx: TemplateCtx): AsmBlock[];
  emitFunctionDef?(resource: ResourceEntry, ctx: TemplateCtx): AsmBlock[];
}
