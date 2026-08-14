/**
 * 左侧栏：节点调色板 + 资源管理器入口。
 * 调色板只负责触发 onAdd(kind)，位置由流程图决定。
 */

import { NODE_KIND_META, type CreatableNodeKind } from '../theme/meta.js';
import { KindIcon } from './KindIcon.js';

export interface PaletteProps {
  readonly onAdd: (kind: CreatableNodeKind) => void;
  readonly onOpenResources: () => void;
}

export function Palette({ onAdd, onOpenResources }: PaletteProps) {
  return (
    <aside className="palette">
      <div className="palette__section-title">节点</div>
      <div className="palette__grid">
        {NODE_KIND_META.map((meta) => (
          <button
            type="button"
            className="palette__item"
            key={meta.kind}
            onClick={() => onAdd(meta.kind)}
            title={meta.hint}
          >
            <span className="palette__item-icon">
              <KindIcon kind={meta.kind} />
            </span>
            <span className="palette__item-label">{meta.label}</span>
          </button>
        ))}
      </div>

      <div className="palette__section-title">资源</div>
      <button type="button" className="palette__resource-btn" onClick={onOpenResources}>
        <span className="palette__resource-label">资源管理器</span>
      </button>
    </aside>
  );
}
