/**
 * 属性面板：选中节点的表单投影（右侧）。
 * 通过 editNode 命令全量替换节点；分支 then/else 由流程图连线决定，此处只读展示。
 */

import { useMemo, useState } from 'react';
import { availableBaseBackgrounds, availableBaseCgs, availableBaseCharacters } from '@hcb-editor/compiler';
import type { AudioResource, EditorState } from '@hcb-editor/editor';
import type { EditorStore } from '@hcb-editor/editor';
import { nodeKindLabel } from '../theme/meta.js';
import { renderCond } from '@hcb-editor/editor';
import type { IrNode } from '@hcb-editor/hcb/ir';
import { ResourcePicker, type ResourcePickerKind, type ResourcePickerResult } from './ResourcePicker.js';
import { assetUrl } from '../projectDir.js';

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

/** 对选中节点引用的资源做存在性检查，返回面向用户的警告文案（不阻断编译）。 */
function resourceRefWarnings(node: IrNode, state: EditorState): string[] {
  const warnings: string[] = [];
  const charNames = new Set([
    ...availableBaseCharacters(state.header.game),
    ...state.resources.characters.map((c) => c.name),
  ]);
  const bgNames = new Set([
    ...availableBaseBackgrounds(state.header.game),
    ...state.resources.backgrounds.map((b) => b.name),
  ]);
  const cgNames = new Set([
    ...availableBaseCgs(state.header.game).map((name) => name.toUpperCase()),
    ...state.resources.cgs.map((c) => c.name.toUpperCase()),
  ]);
  if (node.kind === 'speak' && node.speaker !== '' && !charNames.has(node.speaker)) {
    warnings.push(`角色「${node.speaker}」不在底座或资源表中`);
  }
  if (node.kind === 'bsset' && node.character !== '' && !charNames.has(node.character)) {
    warnings.push(`角色「${node.character}」不在底座或资源表中`);
  }
  if (node.kind === 'bgset' && node.background !== '' && !bgNames.has(node.background)) {
    warnings.push(`背景「${node.background}」不在底座或资源表中`);
  }
  if (node.kind === 'cgset' && node.name !== '' && !cgNames.has(node.name.toUpperCase())) {
    warnings.push(`CG「${node.name}」尚未导入且不在底座预载表中`);
  }
  if (node.kind === 'audio' && state.resources.audios.length > 0) {
    const has = state.resources.audios.some((a) => a.type === node.type && a.number === node.channelOrNum);
    if (!has) {
      warnings.push(`音频 ${node.type} #${node.channelOrNum} 尚未导入`);
    }
  }
  if (node.kind === 'speak' && node.voice !== undefined && state.resources.audios.length > 0) {
    const has = state.resources.audios.some((a) => a.type === 'voice' && a.number === node.voice);
    if (!has) {
      warnings.push(`语音 #${node.voice} 尚未导入`);
    }
  }
  return warnings;
}

export function PropertyPanel({ state, store }: PropertyPanelProps) {
  const baseCharacters = useMemo(() => availableBaseCharacters(state.header.game), [state.header.game]);
  const baseBackgrounds = useMemo(() => availableBaseBackgrounds(state.header.game), [state.header.game]);
  const baseCgs = useMemo(() => availableBaseCgs(state.header.game), [state.header.game]);
  const projectCharacters = useMemo(() => state.resources.characters.map((c) => c.name), [state.resources.characters]);
  const projectBackgrounds = useMemo(() => state.resources.backgrounds.map((b) => b.name), [state.resources.backgrounds]);
  const projectCgs = useMemo(() => state.resources.cgs.map((c) => c.name), [state.resources.cgs]);
  const speakerOptions = useMemo(() => [...new Set([...baseCharacters, ...projectCharacters])], [baseCharacters, projectCharacters]);
  const backgroundOptions = useMemo(() => [...new Set([...baseBackgrounds, ...projectBackgrounds])], [baseBackgrounds, projectBackgrounds]);
  const cgOptions = useMemo(() => [...new Set([...baseCgs, ...projectCgs])], [baseCgs, projectCgs]);

  const [picker, setPicker] = useState<{ readonly kind: ResourcePickerKind; readonly audioType?: AudioResource['type'] } | null>(null);

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

  /** 选择器回填：把可视化选择结果写回当前音画节点的对应字段。 */
  const applyPick = (result: ResourcePickerResult): void => {
    setPicker(null);
    if (result.kind === 'background' && node.kind === 'bgset') {
      const next = { ...node, background: result.name };
      if (result.variant === 0) {
        delete next.variant;
      } else {
        next.variant = result.variant;
      }
      edit(next);
    } else if (result.kind === 'cg' && node.kind === 'cgset') {
      edit({ ...node, name: result.name });
    } else if (result.kind === 'character' && node.kind === 'bsset') {
      edit({ ...node, character: result.character, pose: result.pose, costume: result.costume, expression: result.expression });
    } else if (result.kind === 'audio' && node.kind === 'audio') {
      edit({ ...node, channelOrNum: result.number });
    }
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

      {resourceRefWarnings(node, state).map((w) => (
        <div className="pp__warning" key={w}>
          ⚠ {w}
        </div>
      ))}

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
      <datalist id="hcb-cgs">
        {cgOptions.map((name) => (
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
          <div className="pp__field">
            <span className="pp__label">背景</span>
            <div className="pp__picker">
              <input className="pp__input" list="hcb-backgrounds" value={node.background} onChange={(e) => edit({ ...node, background: e.target.value })} />
              <button type="button" className="pp__pick-btn" onClick={() => setPicker({ kind: 'background' })}>
                选择…
              </button>
            </div>
            {(() => {
              const bg = state.resources.backgrounds.find((b) => b.name === node.background);
              return bg?.image ? <img className="pp__picker-preview" src={assetUrl(bg.thumb ?? bg.image)} alt={node.background} /> : null;
            })()}
          </div>
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

      {node.kind === 'cgset' && (
        <>
          <div className="pp__field">
            <span className="pp__label">CG</span>
            <div className="pp__picker">
              <input className="pp__input" list="hcb-cgs" value={node.name} onChange={(e) => edit({ ...node, name: e.target.value })} />
              <button type="button" className="pp__pick-btn" onClick={() => setPicker({ kind: 'cg' })}>
                选择…
              </button>
            </div>
            {(() => {
              const cg = state.resources.cgs.find((c) => c.name.toLowerCase() === node.name.toLowerCase());
              return cg ? <img className="pp__picker-preview" src={assetUrl(cg.thumb ?? cg.image)} alt={node.name} /> : null;
            })()}
          </div>
          <div className="pp__field">
            <span className="pp__label">坐标 x / y（留空使用 CG 内置设定）</span>
            <div className="pp__choice">
              <input
                className="pp__input"
                type="number"
                value={node.x ?? ''}
                placeholder="内置"
                onChange={(e) => {
                  const next = { ...node };
                  if (e.target.value === '') delete next.x;
                  else next.x = Number(e.target.value);
                  edit(next);
                }}
              />
              <input
                className="pp__input"
                type="number"
                value={node.y ?? ''}
                placeholder="内置"
                onChange={(e) => {
                  const next = { ...node };
                  if (e.target.value === '') delete next.y;
                  else next.y = Number(e.target.value);
                  edit(next);
                }}
              />
            </div>
          </div>
          <label className="pp__field">
            <span className="pp__label">缩放（1 = 原始比例，留空使用内置设定）</span>
            <input
              className="pp__input"
              type="number"
              step="0.1"
              value={node.scale ?? ''}
              placeholder="内置"
              onChange={(e) => {
                const next = { ...node };
                if (e.target.value === '') delete next.scale;
                else next.scale = Number(e.target.value);
                edit(next);
              }}
            />
          </label>
          <label className="pp__field">
            <span className="pp__label">转场时间（毫秒）</span>
            <input
              className="pp__input"
              type="number"
              value={node.time ?? 0}
              onChange={(e) => edit({ ...node, time: Number(e.target.value) })}
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
          <div className="pp__field">
            <span className="pp__label">角色</span>
            <div className="pp__picker">
              <input className="pp__input" list="hcb-speakers" value={node.character} onChange={(e) => edit({ ...node, character: e.target.value })} />
              <button type="button" className="pp__pick-btn" onClick={() => setPicker({ kind: 'character' })}>
                选择…
              </button>
            </div>
            {(() => {
              const char = state.resources.characters.find((c) => c.name === node.character);
              const pose = char?.poses?.find((p) => p.pose === node.pose && p.costume === node.costume);
              const faceImg = node.expression > 0 ? pose?.faces.find((f) => f.face === node.expression)?.image : undefined;
              const img = faceImg ?? pose?.image ?? char?.image;
              return img ? <img className="pp__picker-preview pp__picker-preview--portrait" src={assetUrl(img)} alt={node.character} /> : null;
            })()}
          </div>
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
            <span className="pp__label">站位</span>
            <select
              className="pp__input"
              value={node.loc ?? 'm'}
              onChange={(e) => edit({ ...node, loc: e.target.value as 'l' | 'm' | 'r' })}
            >
              <option value="l">左（l）</option>
              <option value="m">中（m）</option>
              <option value="r">右（r）</option>
            </select>
          </label>
          <label className="pp__field">
            <span className="pp__label">z 坐标</span>
            <input className="pp__input" type="number" value={node.z ?? 0} onChange={(e) => edit({ ...node, z: Number(e.target.value) })} />
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
            <div className="pp__picker">
              <input className="pp__input" type="number" value={node.channelOrNum} onChange={(e) => edit({ ...node, channelOrNum: Number(e.target.value) })} />
              <button type="button" className="pp__pick-btn" onClick={() => setPicker({ kind: 'audio', audioType: node.type })}>
                选择…
              </button>
            </div>
          </label>
          <label className="pp__field">
            <span className="pp__label">动作</span>
            <select
              className="pp__input"
              value={node.action ?? 'play'}
              onChange={(e) => {
                const next = { ...node };
                if (e.target.value === 'play') {
                  delete next.action;
                } else {
                  next.action = 'stop';
                }
                edit(next);
              }}
            >
              <option value="play">播放</option>
              <option value="stop">停止</option>
            </select>
          </label>
          <label className="pp__field">
            <span className="pp__label">时长（毫秒，loop / 停止用）</span>
            <input
              className="pp__input"
              type="number"
              value={node.time ?? ''}
              placeholder="可选"
              onChange={(e) => {
                const next = { ...node };
                if (e.target.value === '') {
                  delete next.time;
                } else {
                  next.time = Number(e.target.value);
                }
                edit(next);
              }}
            />
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

      {node.kind === 'jump' && (
        <div className="pp__field">
          <span className="pp__label">目标 label</span>
          <div className="pp__readonly">{node.target || '（由流程图连线决定）'}</div>
        </div>
      )}

      {node.kind === 'wait' && (
        <label className="pp__field">
          <span className="pp__label">等待时长（毫秒）</span>
          <input className="pp__input" type="number" value={node.ms} onChange={(e) => edit({ ...node, ms: Number(e.target.value) })} />
        </label>
      )}

      {node.kind === 'msgset' && (
        <label className="pp__field">
          <span className="pp__label">对话栏位置</span>
          <select
            className="pp__input"
            value={node.position}
            onChange={(e) => edit({ ...node, position: e.target.value as typeof node.position })}
          >
            <option value="middle">middle（居中）</option>
            <option value="normal">normal（恢复显示）</option>
            <option value="boxin">boxin（框入）</option>
            <option value="boxout">boxout（框出）</option>
          </select>
        </label>
      )}

      {node.kind === 'eyecatch' && (
        <div className="pp__field">
          <span className="pp__label">转场</span>
          <div className="pp__readonly">eyecatch 转场特效</div>
        </div>
      )}

      {node.kind === 'bsfade' && (
        <div className="pp__field">
          <span className="pp__label">消除立绘</span>
          <div className="pp__readonly">清除当前显示的角色立绘</div>
        </div>
      )}

      {node.kind === 'white' && (
        <div className="pp__field">
          <span className="pp__label">白屏</span>
          <div className="pp__readonly">背景调白特效</div>
        </div>
      )}

      {node.kind === 'raw' && (
        <div className="pp__field">
          <span className="pp__label">未识别演出块</span>
          <div className="pp__readonly">{node.bytes.byteLength} 字节 · 只读占位</div>
          <div className="pp__hint">raw 块内部不可编辑，仅可整体删除或保留。</div>
        </div>
      )}

      {picker && (
        <ResourcePicker
          kind={picker.kind}
          state={state}
          {...(picker.audioType !== undefined ? { audioType: picker.audioType } : {})}
          onPick={applyPick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
