/**
 * 剧本文本视图：IR 的只读 DSL 投影。
 * 点击可定位行可跳转回流程图对应节点。
 */

import { projectScript } from '@hcb-editor/editor';
import type { EditorDocument } from '@hcb-editor/editor';

export interface ScriptTextViewProps {
  readonly document: EditorDocument;
  readonly activeNodeId: string | null;
  readonly onLocate: (nodeId: string) => void;
}

export function ScriptTextView({ document, activeNodeId, onLocate }: ScriptTextViewProps) {
  const lines = projectScript(document);

  return (
    <div className="script">
      <pre className="script__code">
        {lines.map((line, i) => {
          const style = { paddingLeft: `${line.indent * 16}px` };
          if (line.nodeId === null) {
            return (
              <span className="script__line script__line--structure" style={style} key={i}>
                {line.text}
              </span>
            );
          }
          const active = line.nodeId === activeNodeId;
          return (
            <button
              type="button"
              className={`script__line script__line--link${active ? ' script__line--active' : ''}`}
              style={style}
              key={i}
              onClick={() => onLocate(line.nodeId!)}
            >
              {line.text}
            </button>
          );
        })}
      </pre>
    </div>
  );
}
