/**
 * IR 语义校验（编译前诊断）：标签重复、控制流目标引用悬空。
 * 纯函数：返回结构化 issue 列表，编译调用方据此给出面向节点的友好错误。
 *
 * 注：栈平衡 / 越界跳转等更底层校验由 assemble/layout pass 在编译期兜底，
 * 此处聚焦「用户在流程图里最容易写错」的标签引用问题。
 */

import type { IrScript } from '../ir/types.js';

export interface ValidationIssue {
  /** IR 节点下标（对应用户可定位的节点）。 */
  readonly nodeIndex: number;
  readonly kind: 'duplicate_label' | 'dangling_label';
  readonly message: string;
}

export function validateIr(ir: IrScript): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const labels = new Set<string>();

  ir.nodes.forEach((node, index) => {
    if (node.kind === 'label') {
      if (labels.has(node.name)) {
        issues.push({
          nodeIndex: index,
          kind: 'duplicate_label',
          message: `标签名重复：${node.name}`,
        });
      }
      labels.add(node.name);
    }
  });

  ir.nodes.forEach((node, index) => {
    const check = (target: string, what: string): void => {
      if (target !== '' && !labels.has(target)) {
        issues.push({
          nodeIndex: index,
          kind: 'dangling_label',
          message: `${what}引用了未定义的标签：${target}`,
        });
      }
    };

    switch (node.kind) {
      case 'branch':
        check(node.then, '分支 then');
        check(node.else, '分支 else');
        break;
      case 'thread':
        check(node.entry, '线程入口');
        break;
      case 'jump':
        check(node.target, '跳转');
        break;
      case 'selset':
        for (const choice of node.choices) {
          check(choice.label, '选项');
        }
        break;
      default:
        break;
    }
  });

  return issues;
}

/** 把 issue 列表拼接为单条错误信息（便于 throw / alert）。 */
export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((i) => i.message).join('；');
}
