/**
 * 节点卡片：流程图上的紧凑两行展示。
 * 默认安静；hover 微抬升 + 边框变亮；selected 用 1px accent 描边（区别于 hover）。
 */

import type { DocNode } from '@hcb-editor/editor';
import { KindIcon } from './KindIcon.js';
import { summarizeNode } from './nodeSummary.js';

export interface NodeCardProps {
  readonly node: DocNode;
  readonly selected: boolean;
}

export function NodeCard({ node, selected }: NodeCardProps) {
  const summary = summarizeNode(node.node);
  return (
    <div className={`node-card${selected ? ' node-card--selected' : ''}`}>
      <span className="node-card__icon">
        <KindIcon kind={node.node.kind} />
      </span>
      <span className="node-card__body">
        <span className="node-card__primary">{summary.primary}</span>
        <span className="node-card__secondary">{summary.secondary}</span>
      </span>
    </div>
  );
}
