/**
 * 属性面板：选中节点的表单投影（右侧）。
 * 通过 editNode 命令全量替换节点；分支 then/else 由流程图连线决定，此处只读展示。
 */

import { useMemo } from 'react';
import { availableBaseBackgrounds, availableBaseCharacters } from '@hcb-editor/compiler';
import type { EditorState } from '@hcb-editor/editor';
import type { EditorStore } from '@hcb-editor/editor';
import { nodeKindLabel } from '../theme/meta.js';
import { renderCond } from '@hcb-editor/editor';
import type { IrNode } from '@hcb-editor/hcb/ir';

export interface PropertyPanelProps {
  readonly state: EditorState;
  readonly store: EditorStore;
}

function mergeSpeak(
  node: Extract<IrNode, { kind: 'speak' }>,
  patch: { readonly speaker?: string; readonly alias?: string; readonly text?: string; readonly voice?: number | null },
): IrNode {
  const next = { ...node };
  if (patch.speaker !== undefined) next.speaker = patch.speaker;
  if (patch.text !== undefined) next.text = patch.text;
  if (patch.alias !== undefined) {
    next.alias = patch.alias === '' ? undefined : patch.alias;
  }
  if (patch.voice !== undefined) {
    if (patch.voice === null) {
      delete next.voice;
    } else {
      next.voice = patch.voice;
    }
  }
  return next;
}

export function PropertyPanel({ state, store }: PropertyPanelProps) {
  const baseCharacters = useMemo(() => availableBaseCharacters(state.header.game), [state.header.game]);
  const baseBackgrounds = useMemo(() => availableBaseBackgrounds(state.header.game), [state.header.game]);
  const projectCharacters = useMemo(() => state.resources.characters.map((c) => c.name), [state.resources.characters]);
  const projectBackgrounds = useMemo(() => state.resources.backgrounds.map((b) => b.name), [state.resources.backgrounds]);
  const speakerOptions = useMemo(() => [...new Set([...baseCharacters, ...projectCharacters])], [baseCharacters, projectCharacters]);
  const backgroundOptions = useMemo(() => [...new Set([...baseBackgrounds, ...projectBackgrounds])], [baseBackgrounds, projectBackgrounds]);

  const selectedId = state.selection.nodeId;
  const docNode = selectedId ? state.document.nodes.find((n) => n.id === selectedId) : undefined;

  if (!docNode) {
    return (
      <div className="pp pp--empty">
        <div className="pp__empty-title">未选中节点</div>
        <div className="pp__empty-hint">在流程图中选中一个节点以编辑其字段。</div>
      </div>
    );
  }

  const node = docNode.node;

  const edit = (nextNode: IrNode) => {
    store.dispatch({ kind: 'edit_node', id: docNode.id, node: nextNode });
  };

  return (
    <div className="pp">
      <div className="pp__header">
        <span className="pp__title">{nodeKindLabel(node.kind)}</span>
        <div className="pp__header-right">
          <span className="pp__id">{docNode.id}</span>
          {docNode.id !== state.document.startNodeId && (
            <button
              type="button"
              className="pp__delete"
              onClick={() => store.dispatch({ kind: 'remove_node', id: docNode.id })}
            >
              删除
            </button>
          )}
        </div>
      </div>

      <datalist id="hcb-speakers">
        {speakerOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="hcb-backgrounds">
        {backgroundOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {node.kind === 'speak' && (
        <>
          <label className="pp__field">
            <span className="pp__label">角色</span>
            <input className="pp__input" list="hcb-speakers" value={node.speaker} onChange={(e) => edit(mergeSpeak(node, { speaker: e.target.value }))} />
          </label>
          <label className="pp__field">
            <span className="pp__label">别名</span>
            <input className="pp__input" value={node.alias ?? ''} placeholder="可选" onChange={(e) => edit(mergeSpeak(node, { alias: e.target.value }))} />
          </label>
          <label className="pp__field">
            <span className="pp__label">语音编号</span>
            <input
              className="pp__input"
              type="number"
              value={node.voice ?? ''}
              placeholder="可选"
              onChange={(e) => edit(mergeSpeak(node, { voice: e.target.value === '' ? null : Number(e.target.value) }))}
            />
          </label>
          <label className="pp__field">
            <span className="pp__label">台词</span>
            <textarea className="pp__input pp__textarea" rows={4} value={node.text} onChange={(e) => edit(mergeSpeak(node, { text: e.target.value }))} />
          </label>
        </>
      )}

      {node.kind === 'dia' && (
        <label className="pp__field">
          <span className="pp__label">旁白文本</span>
          <textarea className="pp__input pp__textarea" rows={4} value={node.text} onChange={(e) => edit({ ...node, text: e.target.value })} />
        </label>
      )}

      {node.kind === 'label' && (
        <label className="pp__field">
          <span className="pp__label">标签名</span>
          <input className="pp__input" value={node.name} onChange={(e) => edit({ ...node, name: e.target.value })} />
        </label>
      )}

      {node.kind === 'bgset' && (
        <>
          <label className="pp__field">
            <span className="pp__label">背景</span>
            <input className="pp__input" list="hcb-backgrounds" value={node.background} onChange={(e) => edit({ ...node, background: e.target.value })} />
          </label>
          <label className="pp__field">
            <span className="pp__label">变体编号</span>
            <input
              className="pp__input"
              type="number"
              value={node.variant ?? ''}
              placeholder="可选"
              onChange={(e) => {
                const next = { ...node };
                if (e.target.value === '') {
                  delete next.variant;
                } else {
                  next.variant = Number(e.target.value);
                }
                edit(next);
              }}
            />
          </label>
        </>
      )}

      {node.kind === 'comment' && (
        <label className="pp__field">
          <span className="pp__label">注释</span>
          <textarea className="pp__input pp__textarea" rows={3} value={node.text} onChange={(e) => edit({ ...node, text: e.target.value })} />
        </label>
      )}

      {node.kind === 'branch' && (
        <>
          <div className="pp__field">
            <span className="pp__label">条件</span>
            <div className="pp__readonly">{renderCond(node.cond)}</div>
          </div>
          <div className="pp__field">
            <span className="pp__label">then / else</span>
            <div className="pp__readonly">{node.then} / {node.else}</div>
          </div>
          <div className="pp__hint">分支目标由流程图连线决定。</div>
        </>
      )}

      {node.kind === 'selset' && (
        <div className="pp__field">
          <span className="pp__label">选项（G[{node.resultGlobal}] 分发）</span>
          <div className="pp__choices">
            {node.choices.map((choice, i) => (
              <div className="pp__choice" key={i}>
                <input
                  className="pp__input"
                  value={choice.text}
                  placeholder="选项文本"
                  onChange={(e) => {
                    const choices = node.choices.map((c, j) => (j === i ? { ...c, text: e.target.value } : c));
                    edit({ ...node, choices });
                  }}
                />
                <input
                  className="pp__input"
                  value={choice.label}
                  placeholder="目标 label"
                  onChange={(e) => {
                    const choices = node.choices.map((c, j) => (j === i ? { ...c, label: e.target.value } : c));
                    edit({ ...node, choices });
                  }}
                />
                <button
                  className="pp__icon-btn"
                  type="button"
                  aria-label="删除选项"
                  onClick={() => edit({ ...node, choices: node.choices.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="pp__add-btn"
              type="button"
              onClick={() => edit({ ...node, choices: [...node.choices, { text: '', label: '' }] })}
            >
              + 添加选项
            </button>
          </div>
        </div>
      )}

      {node.kind === 'bsset' && (
        <>
          <label className="pp__field">
            <span className="pp__label">角色</span>
            <input className="pp__input" list="hcb-speakers" value={node.character} onChange={(e) => edit({ ...node, character: e.target.value })} />
          </label>
          <label className="pp__field">
            <span className="pp__label">姿势 pose</span>
            <input className="pp__input" type="number" value={node.pose} onChange={(e) => edit({ ...node, pose: Number(e.target.value) })} />
          </label>
          <label className="pp__field">
            <span className="pp__label">服装 costume</span>
            <input className="pp__input" type="number" value={node.costume} onChange={(e) => edit({ ...node, costume: Number(e.target.value) })} />
          </label>
          <label className="pp__field">
            <span className="pp__label">表情 face</span>
            <input className="pp__input" type="number" value={node.expression} onChange={(e) => edit({ ...node, expression: Number(e.target.value) })} />
          </label>
          <label className="pp__field">
            <span className="pp__label">层次 layer</span>
            <input className="pp__input" type="number" value={node.layer} onChange={(e) => edit({ ...node, layer: Number(e.target.value) })} />
          </label>
          <div className="pp__field">
            <span className="pp__label">坐标 x / y</span>
            <div className="pp__choice">
              <input className="pp__input" type="number" value={node.position.x} onChange={(e) => edit({ ...node, position: { ...node.position, x: Number(e.target.value) } })} />
              <input className="pp__input" type="number" value={node.position.y} onChange={(e) => edit({ ...node, position: { ...node.position, y: Number(e.target.value) } })} />
            </div>
          </div>
        </>
      )}

      {node.kind === 'audio' && (
        <>
          <label className="pp__field">
            <span className="pp__label">类型</span>
            <select className="pp__input" value={node.type} onChange={(e) => edit({ ...node, type: e.target.value as 'bgm' | 'voice' | 'se' })}>
              <option value="bgm">bgm</option>
              <option value="voice">voice</option>
              <option value="se">se</option>
            </select>
          </label>
          <label className="pp__field">
            <span className="pp__label">编号</span>
            <input className="pp__input" type="number" value={node.channelOrNum} onChange={(e) => edit({ ...node, channelOrNum: Number(e.target.value) })} />
          </label>
          <label className="pp__field pp__field--check">
            <span className="pp__label">循环</span>
            <input type="checkbox" checked={node.loop ?? false} onChange={(e) => {
              const next = { ...node };
              if (e.target.checked) {
                next.loop = true;
              } else {
                delete next.loop;
              }
              edit(next);
            }} />
          </label>
        </>
      )}

      {node.kind === 'thread' && (
        <>
          <label className="pp__field">
            <span className="pp__label">线程槽 slot</span>
            <input className="pp__input" type="number" value={node.slot} onChange={(e) => edit({ ...node, slot: Number(e.target.value) })} />
          </label>
          <div className="pp__field">
            <span className="pp__label">入口 label</span>
            <div className="pp__readonly">{node.entry || '（由流程图连线决定）'}</div>
          </div>
        </>
      )}

      {node.kind === 'raw' && (
        <div className="pp__field">
          <span className="pp__label">未识别演出块</span>
          <div className="pp__readonly">{node.bytes.byteLength} 字节 · 只读占位</div>
          <div className="pp__hint">raw 块内部不可编辑，仅可整体删除或保留。</div>
        </div>
      )}
    </div>
  );
}
