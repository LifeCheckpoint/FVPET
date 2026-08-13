/**
 * 时间线视图：沿当前路径线性化的节点序列（只读投影）。
 * 点击条目定位回流程图对应节点。
 */

import { projectTimeline, type EditorDocument } from '@hcb-editor/editor';
import { nodeKindLabel } from '../theme/meta.js';
import { summarizeNode } from './nodeSummary.js';

export interface TimelineViewProps {
  readonly document: EditorDocument;
  readonly activeNodeId: string | null;
  readonly onLocate: (nodeId: string) => void;
}

export function TimelineView({ document, activeNodeId, onLocate }: TimelineViewProps) {
  const items = projectTimeline(document);

  if (items.length === 0) {
    return (
      <div className="timeline">
        <div className="timeline__empty">暂无节点</div>
      </div>
    );
  }

  return (
    <div className="timeline">
      {items.map((item, i) => {
        const docNode = document.nodes.find((n) => n.id === item.nodeId);
        const summary = docNode ? summarizeNode(docNode.node) : { primary: '', secondary: '' };
        return (
          <button
            type="button"
            key={item.nodeId}
            className={`timeline__item${item.nodeId === activeNodeId ? ' timeline__item--active' : ''}`}
            onClick={() => onLocate(item.nodeId)}
          >
            <span className="timeline__index">{i + 1}</span>
            <span className="timeline__body">
              <span className="timeline__kind">{nodeKindLabel(item.kind)}</span>
              <span className="timeline__text">{summary.primary || summary.secondary}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
