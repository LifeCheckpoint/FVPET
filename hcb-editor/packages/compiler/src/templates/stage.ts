/**
 * 演出 / 音频 / 线程 / 等待模板（95% 命中的剩余主体）。
 * audio/thread 有语义 IR 节点，instantiate 直接展开；
 * wait/stage(演出) 暂无独立 IR 节点，仅提供反编译识别签名（instantiate 抛错）。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import type { AsmBlock, AsmInstruction, AsmPattern, Template, TemplateCtx } from './types.js';

type AudioNode = Extract<IrNode, { kind: 'audio' }>;
type ThreadNode = Extract<IrNode, { kind: 'thread' }>;
type WaitNode = Extract<IrNode, { kind: 'wait' }>;
type MsgsetNode = Extract<IrNode, { kind: 'msgset' }>;
type CgsetNode = Extract<IrNode, { kind: 'cgset' }>;
type EyecatchNode = Extract<IrNode, { kind: 'eyecatch' }>;
type BsfadeNode = Extract<IrNode, { kind: 'bsfade' }>;
type WhiteNode = Extract<IrNode, { kind: 'white' }>;

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
    if (node.action === 'stop') {
      // bgmstop：push_nil + call f_00040695（hcb_build.py bgmstop）
      return [
        { op: 'push_nil' },
        { op: 'call', target: 'f_00040695' },
      ];
    }
    // bgmset：编号 + 4 nil + call f_00040552。旧实现以 AudioLoad(channel,nil)
    // 开头会先卸载通道，虽然无栈错误，却不会加载底座中的实际 BGM 资源。
    return [
      { op: 'push_i8', value: node.channelOrNum },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'call', target: 'f_00040552' },
    ];
  }
  if (node.type === 'se') {
    if (node.action === 'stop') {
      // se end：push_i16 num, push_i16 time, push_i8 0, push_nil, push_nil, call f_0003fc08
      return [
        { op: 'push_i16', value: node.channelOrNum },
        { op: 'push_i16', value: node.time ?? 0 },
        { op: 'push_i8', value: 0 },
        { op: 'push_nil' },
        { op: 'push_nil' },
        { op: 'call', target: 'f_0003fc08' },
      ];
    }
    if (node.loop) {
      // se loop：push_i16 num, push_i8 1, push_nil, push_nil, push_i16 time, call f_0003fc08
      return [
        { op: 'push_i16', value: node.channelOrNum },
        { op: 'push_i8', value: 1 },
        { op: 'push_nil' },
        { op: 'push_nil' },
        { op: 'push_i16', value: node.time ?? 0 },
        { op: 'call', target: 'f_0003fc08' },
      ];
    }
    // 普通播放同样必须经过 5 参数 SE 包装函数；SoundPlay syscall 本身需要 3 参数。
    return [
      { op: 'push_i16', value: node.channelOrNum },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'call', target: 'f_0003fc08' },
    ];
  }
  if (node.action === 'stop') {
    return [
      { op: 'push_i16', value: node.channelOrNum },
      { op: 'push_i16', value: node.time ?? 0 },
      { op: 'syscall', name: 'AudioStop' },
    ];
  }
  // AudioPlay 的 sysdesc 参数数为 2：通道 + repeat。
  return [
    { op: 'push_i16', value: node.channelOrNum },
    ...(node.loop ? ([{ op: 'push_true' }] as AsmInstruction[]) : ([{ op: 'push_nil' }] as AsmInstruction[])),
    { op: 'syscall', name: 'AudioPlay' },
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
          { op: 'push_thread_entry', target: node.entry },
          { op: 'syscall', name: 'ThreadStart' },
        ],
      },
    ];
  },
};

export const waitTemplate: Template<WaitNode> = {
  id: 'fvp.wait',
  signature: [{ repeat: { pattern: PUSH, min: 0, max: 2 } }, { syscallAny: ['TimerSet', 'ThreadWait', 'ThreadSleep'] }],
  slots: { ms: { kind: 'i16', doc: '等待毫秒数' } },
  instantiate(node, _ctx): AsmBlock[] {
    return [{ instructions: [{ op: 'push_i16', value: node.ms }, { op: 'syscall', name: 'ThreadWait' }] }];
  },
};

/** Sakura moyu 对话栏设置函数族（msgset 模板）。 */
const MSGSET_FNS: readonly number[] = [0x000349f1, 0x0003b797, 0x000864f4];

export const msgsetTemplate: Template<MsgsetNode> = {
  id: 'fvp.msgset',
  signature: [{ repeat: { pattern: PUSH, min: 1, max: 3 } }, { callToAny: MSGSET_FNS }],
  slots: { position: { kind: 'string', doc: '对话栏位置：middle / normal / boxin / boxout' } },
  instantiate(node, _ctx): AsmBlock[] {
    switch (node.position) {
      case 'middle':
        return [
          {
            instructions: [
              { op: 'push_i8', value: 1 },
              { op: 'push_i8', value: 1 },
              { op: 'neg' },
              { op: 'call', target: 'f_000349f1' },
            ],
          },
        ];
      case 'normal':
        return [
          {
            instructions: [
              { op: 'push_i8', value: 0 },
              { op: 'push_nil' },
              { op: 'call', target: 'f_000349f1' },
              { op: 'push_i8', value: 0 },
              { op: 'call', target: 'f_0003b797' },
            ],
          },
        ];
      case 'boxin':
        return [
          {
            instructions: [
              { op: 'push_i8', value: 0 },
              { op: 'push_nil' },
              { op: 'call', target: 'f_000864f4' },
            ],
          },
        ];
      case 'boxout':
        return [
          {
            instructions: [
              { op: 'push_i8', value: 1 },
              { op: 'push_i8', value: 2 },
              { op: 'neg' },
              { op: 'call', target: 'f_000864f4' },
            ],
          },
        ];
    }
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

/** 孤立 G[]/栈运算（push+算术链 + pop 结尾），仅用于反编译覆盖率识别。 */
export const arithmeticTemplate: Template<never> = {
  id: 'fvp.arithmetic',
  signature: [
    { repeat: { pattern: PUSH, min: 2, max: 32 } },
    { anyOf: ['pop_global', 'pop_stack', 'pop_global_table', 'pop_local_table'] },
  ],
  slots: {},
  instantiate(_node: never, _ctx: TemplateCtx): AsmBlock[] {
    throw new Error('fvp.arithmetic（孤立 G[]/栈运算）仅用于反编译识别');
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

function signedI16(value: number): AsmInstruction[] {
  const integer = Math.trunc(value);
  if (integer >= 0) {
    return [{ op: 'push_i16', value: integer }];
  }
  return [{ op: 'push_i16', value: Math.abs(integer) }, { op: 'neg' }];
}

/**
 * Sakura moyu 的预处理 base.chb 为每个已加载 CG 提供一个 6 参数专属函数。
 * 原版 Sakura 分析得到的共享 0x373a5 在 base.chb 中是数据字节 0x5f，不是函数。
 */
export const cgsetTemplate: Template<CgsetNode> = {
  id: 'fvp.cgset',
  signature: [{ repeat: { pattern: PUSH, min: 6, max: 10 } }, { call: true }],
  slots: {
    name: { kind: 'string', doc: 'CG 资源名（大写）' },
    x: { kind: 'i16', doc: '可选 x 坐标' },
    y: { kind: 'i16', doc: '可选 y 坐标' },
    scale: { kind: 'i16', doc: '可选缩放，1 为原始比例' },
    time: { kind: 'i16', doc: '转场时间（毫秒）' },
  },
  instantiate(node, ctx): AsmBlock[] {
    const normalized = node.name.toUpperCase();
    const cg = ctx.tables.cgs?.[normalized];
    const hasCustomTransform = node.x !== undefined || node.y !== undefined || node.scale !== undefined;
    const values: AsmInstruction[][] = hasCustomTransform
      ? [
          [{ op: 'push_i8', value: 0 }],
          signedI16(node.x ?? 0),
          signedI16(node.y ?? 0),
          signedI16(3000 - Math.round((node.scale ?? 1) * 1000)),
          [{ op: 'push_nil' }],
        ]
      : Array.from({ length: 5 }, () => [{ op: 'push_nil' as const }]);
    const time = signedI16(node.time ?? 0);
    const instructions: AsmInstruction[] = cg
      ? [
          ...values.flat(),
          ...time,
          { op: 'call', target: `f_${cg.fn.toString(16).padStart(8, '0')}` },
        ]
      : [
          // hcb_build.py::cgload 的 6 参数包装函数体内联版：允许 graph_vis/vish.bin
          // 中未被 cg_loaded.txt 预载的新 CG，无需生成额外函数定义。
          { op: 'call', target: 'f_000051ac' },
          { op: 'push_string', text: normalized },
          ...values[0]!,
          { op: 'push_i8', value: 1 },
          { op: 'push_nil' },
          ...values.slice(1).flat(),
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'call', target: 'f_0003c86a' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          ...time,
          { op: 'call', target: 'f_000051d3' },
        ];
    return [{ instructions }];
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

/** 转场（eyecatch）：5×push_nil + call f_00036e7b（hcb_build.py eyecatch）。 */
export const eyecatchTemplate: Template<EyecatchNode> = {
  id: 'fvp.eyecatch',
  signature: [{ repeat: { pattern: PUSH, min: 0, max: 5 } }, { callTo: 0x00036e7b }],
  slots: {},
  instantiate(): AsmBlock[] {
    return [
      {
        instructions: [
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'call', target: 'f_00036e7b' },
        ],
      },
    ];
  },
};

/** 消除当前立绘（bsfade）：2×push_nil + call f_0000baa9（hcb_build.py bsfade）。 */
export const bsfadeTemplate: Template<BsfadeNode> = {
  id: 'fvp.bsfade',
  signature: [{ repeat: { pattern: PUSH, min: 0, max: 2 } }, { callTo: 0x0000baa9 }],
  slots: {},
  instantiate(): AsmBlock[] {
    return [
      {
        instructions: [
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'call', target: 'f_0000baa9' },
        ],
      },
    ];
  },
};

/** 背景调白（white）：call f_00005467 + push_i8 0 + push_i16 1000 + push_nil×8 + call f_0004115a。 */
export const whiteTemplate: Template<WhiteNode> = {
  id: 'fvp.white',
  signature: [
    { callTo: 0x00005467 },
    { repeat: { pattern: PUSH, min: 0, max: 10 } },
    { callTo: 0x0004115a },
  ],
  slots: {},
  instantiate(): AsmBlock[] {
    return [
      {
        instructions: [
          { op: 'call', target: 'f_00005467' },
          { op: 'push_i8', value: 0 },
          { op: 'push_i16', value: 1000 },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'push_nil' },
          { op: 'call', target: 'f_0004115a' },
        ],
      },
    ];
  },
};
