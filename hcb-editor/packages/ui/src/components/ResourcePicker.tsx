/**
 * 资源选择器（二级模态窗口）：从资源表可视化挑选 背景 / CG / 立绘 / 音频。
 * 属性面板（PropertyPanel）中的音画节点字段通过「选择…」按钮打开本组件，
 * 避免用户干巴巴地手填编号 —— 资源以缩略图 / 试听控件直观呈现。
 */

import { useState } from 'react';
import type { AudioResource, CharacterResource, EditorState } from '@hcb-editor/editor';
import { assetUrl } from '../projectDir.js';

export type ResourcePickerKind = 'background' | 'cg' | 'character' | 'audio';

/** 选择结果：可辨识联合，属性面板据此回填节点字段。 */
export type ResourcePickerResult =
  | { readonly kind: 'background'; readonly name: string; readonly variant: number }
  | { readonly kind: 'cg'; readonly name: string }
  | { readonly kind: 'character'; readonly character: string; readonly pose: number; readonly costume: number; readonly expression: number }
  | { readonly kind: 'audio'; readonly number: number };

export interface ResourcePickerProps {
  readonly kind: ResourcePickerKind;
  readonly state: EditorState;
  /** 音频选择时按类型过滤（bgm / voice / se）。 */
  readonly audioType?: AudioResource['type'];
  readonly onPick: (result: ResourcePickerResult) => void;
  readonly onClose: () => void;
}

const TITLES: Record<ResourcePickerKind, string> = {
  background: '选择背景',
  cg: '选择 CG',
  character: '选择立绘',
  audio: '选择音频',
};

const EMPTY_HINTS: Record<ResourcePickerKind, string> = {
  background: '还没有背景，请先在「资源工作台 → 背景」导入。',
  cg: '还没有 CG，请先在「资源工作台 → CG」导入。',
  character: '还没有立绘，请先在「资源工作台 → 角色」导入内置立绘。',
  audio: '还没有音频，请先在「资源工作台 → 音频」导入。',
};

function EmptyHint({ kind }: { readonly kind: ResourcePickerKind }) {
  return <div className="picker-empty">{EMPTY_HINTS[kind]}</div>;
}

export function ResourcePicker({ kind, state, audioType, onPick, onClose }: ResourcePickerProps) {
  const [drillChar, setDrillChar] = useState<CharacterResource | null>(null);
  const audios = state.resources.audios.filter((a) => audioType === undefined || a.type === audioType);

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__header">
          <span className="modal__title">{TITLES[kind]}</span>
          <button type="button" className="modal__close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal__body picker">
          {kind === 'background' && (
            <div className="picker-grid">
              {state.resources.backgrounds.length === 0 && <EmptyHint kind={kind} />}
              {state.resources.backgrounds.map((r) => (
                <button
                  type="button"
                  className="picker-card"
                  key={r.id}
                  onClick={() => onPick({ kind: 'background', name: r.name, variant: r.variant })}
                >
                  <span className="picker-card__thumb">
                    {(r.thumb ?? r.image) ? (
                      <img src={assetUrl(r.thumb ?? r.image)} alt={r.name} loading="lazy" decoding="async" />
                    ) : (
                      <span className="picker-card__fallback">{r.name}</span>
                    )}
                  </span>
                  <span className="picker-card__meta">
                    <span className="picker-card__name">{r.name}</span>
                    <span className="picker-card__sub">变体 {r.variant}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {kind === 'cg' && (
            <div className="picker-grid">
              {state.resources.cgs.length === 0 && <EmptyHint kind={kind} />}
              {state.resources.cgs.map((r) => (
                <button
                  type="button"
                  className="picker-card"
                  key={r.id}
                  onClick={() => onPick({ kind: 'cg', name: r.name })}
                >
                  <span className="picker-card__thumb">
                    {(r.thumb ?? r.image) ? (
                      <img src={assetUrl(r.thumb ?? r.image)} alt={r.name} loading="lazy" decoding="async" />
                    ) : (
                      <span className="picker-card__fallback">{r.name}</span>
                    )}
                  </span>
                  <span className="picker-card__meta">
                    <span className="picker-card__name">{r.name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {kind === 'character' &&
            (drillChar ? (
              <div className="picker">
                <button type="button" className="btn btn--secondary picker__back" onClick={() => setDrillChar(null)}>
                  ← 返回角色列表
                </button>
                <div className="picker-heading">{drillChar.name}</div>
                {(drillChar.poses ?? []).length === 0 ? (
                  <EmptyHint kind="character" />
                ) : (
                  <div className="picker-grid">
                    {(drillChar.poses ?? []).map((p, i) => (
                      <div className="picker-pose" key={i}>
                        <button
                          type="button"
                          className="picker-card"
                          onClick={() =>
                            onPick({ kind: 'character', character: drillChar.name, pose: p.pose, costume: p.costume, expression: 0 })
                          }
                        >
                          <span className="picker-card__thumb">
                            {p.image ? (
                              <img src={assetUrl(p.image)} alt={`${drillChar.name} 姿势${p.pose}/服装${p.costume}`} loading="lazy" decoding="async" />
                            ) : (
                              <span className="picker-card__fallback">无图</span>
                            )}
                          </span>
                          <span className="picker-card__meta">
                            <span className="picker-card__name">
                              姿势 {p.pose} · 服装 {p.costume}
                            </span>
                            <span className="picker-card__sub">默认表情</span>
                          </span>
                        </button>
                        {p.faces.length > 0 && (
                          <div className="picker-faces">
                            {p.faces.map((f) => (
                              <button
                                type="button"
                                className="picker-face"
                                key={f.face}
                                title={`表情 ${f.face}`}
                                onClick={() =>
                                  onPick({ kind: 'character', character: drillChar.name, pose: p.pose, costume: p.costume, expression: f.face })
                                }
                              >
                                <img src={assetUrl(f.image)} alt={`表情 ${f.face}`} loading="lazy" decoding="async" />
                                <span className="picker-face__num">{f.face}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="picker-grid">
                {state.resources.characters.length === 0 && <EmptyHint kind="character" />}
                {state.resources.characters.map((c) => (
                  <button type="button" className="picker-card" key={c.id} onClick={() => setDrillChar(c)}>
                    <span className="picker-card__thumb">
                      {c.image ? (
                        <img src={assetUrl(c.image)} alt={c.name} loading="lazy" decoding="async" />
                      ) : (
                        <span className="picker-card__fallback">{c.name}</span>
                      )}
                    </span>
                    <span className="picker-card__meta">
                      <span className="picker-card__name">{c.name}</span>
                      <span className="picker-card__sub">{(c.poses ?? []).length} 姿势组合</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}

          {kind === 'audio' && (
            <div className="picker-list">
              {audios.length === 0 && <EmptyHint kind="audio" />}
              {audios.map((r) => (
                <div className="picker-audio" key={r.id} role="button" tabIndex={0} onClick={() => onPick({ kind: 'audio', number: r.number })}>
                  <span className="resource-card__badge">{r.type}</span>
                  <span className="picker-audio__body">
                    <span className="picker-audio__label">{r.label || `#${r.number}`}</span>
                    <span className="picker-audio__num">编号 {r.number}</span>
                  </span>
                  {r.src ? (
                    <audio className="picker-audio__player" controls src={assetUrl(r.src)} onClick={(e) => e.stopPropagation()} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
