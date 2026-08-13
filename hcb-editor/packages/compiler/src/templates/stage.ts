/**
 * 演出 / 音频 / 线程 / 等待模板（95% 命中的剩余主体）。
 * audio/thread 有语义 IR 节点，instantiate 直接展开；
 * wait/stage(演出) 暂无独立 IR 节点，仅提供反编译识别签名（instantiate 抛错）。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import type { AsmBlock, AsmInstruction, AsmPattern, Template, TemplateCtx } from './types.js';

type AudioNode = Extract<IrNode, { kind: 'audio' }>;
type ThreadNode = Extract<IrNode, { kind: 'thread' }>;

const PUSH: AsmPattern = {
  anyOf: [
    'push_i8',
    'push_i16',
    'push_i32',
    'push_f32',
    'push_nil',
    'push_true',
    'push_string',
    'push_global',
    'push_stack',
    'neg',
    'add',
    'sub',
    'mul',
    'div',
    'mod',
    'set_e',
    'set_ne',
    'set_g',
    'set_ge',
    'set_l',
    'set_le',
    'and',
    'or',
    'bit_test',
  ],
};

const AUDIO_SYSCALLS = [
  'AudioLoad',
  'AudioPlay',
  'AudioStop',
  'AudioVol',
  'AudioType',
  'AudioState',
  'AudioSilentOn',
  'SoundLoad',
  'SoundPlay',
  'SoundStop',
  'SoundVol',
] as const;

const STAGE_SYSCALLS = [
  'MotionMove',
  'MotionMoveTest',
  'MotionMoveS2',
  'MotionMoveS2Test',
  'MotionMoveStop',
  'MotionMoveZ',
  'MotionMoveR',
  'MotionAlpha',
  'MotionAlphaStop',
  'MotionAnim',
  'PrimSetAlpha',
  'PrimSetNull',
  'PrimGroupIn',
  'PrimHit',
  'PrimSetDraw',
  'PrimSetOP',
  'PrimSetXY',
  'PrimSetUV',
  'PrimSetBlend',
  'PrimSetSnow',
  'GraphLoad',
  'PartsLoad',
  'ColorSet',
  'TextColor',
  'TextClear',
  'Snow',
] as const;

function audioAsm(node: AudioNode): AsmInstruction[] {
  if (node.type === 'bgm') {
    return [
      { op: 'push_i8', value: node.channelOrNum },
      { op: 'push_nil' },
      { op: 'syscall', name: 'AudioLoad' },
      { op: 'push_i8', value: node.channelOrNum },
      ...(node.loop ? ([{ op: 'push_true' }] as AsmInstruction[]) : ([{ op: 'push_nil' }] as AsmInstruction[])),
      { op: 'syscall', name: 'AudioPlay' },
    ];
  }
  return [
    { op: 'push_i16', value: node.channelOrNum },
    { op: 'syscall', name: node.type === 'se' ? 'SoundPlay' : 'AudioPlay' },
  ];
}

export const audioTemplate: Template<AudioNode> = {
  id: 'fvp.audio',
  signature: [{ repeat: { pattern: PUSH, min: 1, max: 4 } }, { syscallAny: AUDIO_SYSCALLS }],
  slots: { channelOrNum: { kind: 'i16', doc: '音频编号/通道' } },
  instantiate(node, _ctx): AsmBlock[] {
    return [{ instructions: audioAsm(node) }];
  },
};

export const threadTemplate: Template<ThreadNode> = {
  id: 'fvp.thread',
  signature: [{ mnemonic: 'push_i8' }, { mnemonic: 'push_i32' }, { syscall: 'ThreadStart' }],
  slots: { slot: { kind: 'i8', doc: '线程槽' }, entry: { kind: 'label', doc: '线程入口 label' } },
  instantiate(node, _ctx): AsmBlock[] {
    return [
      {
        instructions: [
          { op: 'push_i8', value: node.slot },
          { op: 'push_i32', value: 0 }, // entry 地址由 assemble 解析 label 后回填
          { op: 'syscall', name: 'ThreadStart' },
        ],
      },
    ];
  },
};

export const waitTemplate: Template<never> = {
  id: 'fvp.wait',
  signature: [{ repeat: { pattern: PUSH, min: 0, max: 2 } }, { syscallAny: ['TimerSet', 'ThreadWait', 'ThreadSleep'] }],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.wait 暂无独立 IR 节点，仅用于反编译识别');
  },
};

export const stageTemplate: Template<never> = {
  id: 'fvp.stage',
  signature: [{ repeat: { pattern: PUSH, min: 0, max: 12 } }, { syscallAny: STAGE_SYSCALLS }],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.stage（演出）暂无独立 IR 节点，仅用于反编译识别');
  },
};

export const branchTemplate: Template<never> = {
  id: 'fvp.branch',
  signature: [
    { repeat: { pattern: PUSH, min: 1, max: 2 } },
    { anyOf: ['set_e', 'set_ne', 'set_g', 'set_ge', 'set_l', 'set_le'] },
    { mnemonic: 'jz' },
    { mnemonic: 'jmp' },
  ],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.branch 由 lower 内联展开，此处仅用于反编译识别');
  },
};

export const callTemplate: Template<never> = {
  id: 'fvp.call',
  signature: [{ repeat: { pattern: PUSH, min: 0, max: 12 } }, { call: true }],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.call（通用功能调用）暂无独立 IR 节点，仅用于反编译识别');
  },
};

export const jumpTemplate: Template<never> = {
  id: 'fvp.jump',
  signature: [{ mnemonic: 'jmp' }],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.jump 由 lower 内联展开，此处仅用于反编译识别');
  },
};

export const controlTemplate: Template<never> = {
  id: 'fvp.control',
  signature: [
    {
      anyOf: [
        'init_stack',
        'ret',
        'retv',
        'nop',
        'push_stack',
        'pop_stack',
        'push_global',
        'pop_global',
        'push_global_table',
        'pop_global_table',
        'push_local_table',
        'pop_local_table',
        'push_top',
        'push_return',
      ],
    },
  ],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.control（函数框架/状态访问）仅用于反编译识别');
  },
};

export const cgsetTemplate: Template<never> = {
  id: 'fvp.cgset',
  signature: [
    { mnemonic: 'push_i16' },
    { mnemonic: 'push_string' },
    { mnemonic: 'push_i8' },
    { mnemonic: 'push_i8' },
    { callToAny: [0x000373a5] },
  ],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.cgset 暂无独立 IR 节点，仅用于反编译识别');
  },
};

export const inputTemplate: Template<never> = {
  id: 'fvp.input',
  signature: [
    { repeat: { pattern: PUSH, min: 0, max: 2 } },
    { syscallAny: ['InputGetDown', 'InputGetUp', 'InputSetRepeat', 'ThreadExit'] },
  ],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.input（输入/线程退出）仅用于反编译识别');
  },
};
