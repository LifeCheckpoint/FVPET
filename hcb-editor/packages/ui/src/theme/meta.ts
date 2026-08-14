/**
 * 节点种类元数据：中文标签 + 调色板排序。
 * 不包含 raw（raw 是反编译降级的只读占位，不能从调色板创建）。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';

export type CreatableNodeKind = Exclude<IrNode['kind'], 'raw'>;

export interface NodeKindMeta {
  readonly kind: CreatableNodeKind;
  readonly label: string;
  /** 调色板内的一行提示，克制、不啰嗦。 */
  readonly hint: string;
}

export const NODE_KIND_META: readonly NodeKindMeta[] = [
  { kind: 'label', label: '标签', hint: '分支与线程的锚点' },
  { kind: 'speak', label: '台词', hint: '角色名 + 台词文本' },
  { kind: 'dia', label: '旁白', hint: '无名字的纯文本' },
  { kind: 'bgset', label: '背景', hint: '切换背景' },
  { kind: 'cgset', label: 'CG', hint: '事件CG显示' },
  { kind: 'bsset', label: '立绘', hint: '角色立绘站位' },
  { kind: 'selset', label: '选项', hint: '分支选项' },
  { kind: 'audio', label: '音频', hint: 'BGM / 语音 / 音效' },
  { kind: 'wait', label: '等待', hint: '等待指定毫秒' },
  { kind: 'msgset', label: '对话栏', hint: '设置对话框位置' },
  { kind: 'eyecatch', label: '转场', hint: 'eyecatch 转场' },
  { kind: 'bsfade', label: '消除立绘', hint: '清除当前立绘' },
  { kind: 'white', label: '白屏', hint: '背景调白' },
  { kind: 'branch', label: '分支', hint: '条件跳转' },
  { kind: 'thread', label: '线程', hint: '启动并行线程' },
  { kind: 'jump', label: '跳转', hint: '无条件跳转到标签' },
  { kind: 'comment', label: '注释', hint: '编译时丢弃' },
];

export function nodeKindLabel(kind: IrNode['kind']): string {
  if (kind === 'raw') {
    return '未识别块';
  }
  return NODE_KIND_META.find((m) => m.kind === kind)?.label ?? kind;
}
