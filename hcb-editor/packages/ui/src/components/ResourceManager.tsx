/**
 * 资源管理器：角色 / 背景 / 音频三张可编辑卡片（模态对话框）。
 * 卡片给出资源本身的视觉表现（立绘缩略图 / 背景缩略图 / 音频试听），
 * 支持导入本地图片 / 音频（FileReader → data URL），
 * 技术字段（函数地址 / pose / costume / face 等）折叠为次要小字，降低陌生感。
 * 修改走资源命令（add/edit/remove），undo/redo 由 store 统一接管。
 */

import { useRef, useState, type CSSProperties } from 'react';
import {
  addAudio,
  addAudios,
  addBackground,
  addCharacter,
  addCharacters,
  editAudio,
  editBackground,
  editCharacter,
  removeAudio,
  removeBackground,
  removeCharacter,
  type AudioResource,
  type BackgroundResource,
  type CharacterPose,
  type CharacterResource,
  type EditorState,
  type EditorStore,
} from '@hcb-editor/editor';
import { decodeHzc1 } from '../resources/hzc.js';
import { parseBinArchive } from '../resources/bin.js';

type Tab = 'characters' | 'backgrounds' | 'audios';

/** 导入队列候选（预览 + 勾选 + 一次性提交）。 */
interface PendingResource {
  readonly id: string;
  readonly kind: 'character' | 'audio';
  readonly name: string;
  readonly dataUrl: string;
  checked: boolean;
}

function intOrNull(value: string): number | null {
  if (value.trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return h;
}

function avatarStyle(name: string): CSSProperties {
  const h = hueOf(name);
  return { background: `hsl(${h} 38% 26%)`, color: `hsl(${h} 62% 78%)` };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** RGBA 像素 → PNG data URL（浏览器 Canvas）。 */
function rgbaToPngDataUrl(width: number, height: number, rgba: Uint8Array): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 Canvas 2D 上下文');
  }
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function updateCharacter(r: CharacterResource, patch: {
  readonly name?: string;
  readonly alias?: string;
  readonly speakFn?: number | null;
  readonly pose?: number;
  readonly costume?: number;
  readonly face?: number;
  readonly image?: string;
  readonly poses?: CharacterPose[];
}): CharacterResource {
  const next = { ...r };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.alias !== undefined) {
    if (patch.alias === '') {
      delete next.alias;
    } else {
      next.alias = patch.alias;
    }
  }
  if (patch.speakFn !== undefined) next.speakFn = patch.speakFn;
  if (patch.pose !== undefined) next.pose = patch.pose;
  if (patch.costume !== undefined) next.costume = patch.costume;
  if (patch.face !== undefined) next.face = patch.face;
  if (patch.poses !== undefined) next.poses = patch.poses;
  if (patch.image !== undefined) {
    if (patch.image === '') {
      delete next.image;
    } else {
      next.image = patch.image;
    }
  }
  return next;
}

function updateBackground(r: BackgroundResource, patch: {
  readonly name?: string;
  readonly variant?: number;
  readonly bgFn?: number | null;
  readonly image?: string;
}): BackgroundResource {
  const next = { ...r };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.variant !== undefined) next.variant = patch.variant;
  if (patch.bgFn !== undefined) next.bgFn = patch.bgFn;
  if (patch.image !== undefined) {
    if (patch.image === '') {
      delete next.image;
    } else {
      next.image = patch.image;
    }
  }
  return next;
}

function updateAudio(r: AudioResource, patch: {
  readonly type?: AudioResource['type'];
  readonly number?: number;
  readonly label?: string;
  readonly src?: string;
}): AudioResource {
  const next = { ...r, ...patch };
  if (patch.src === '') {
    delete next.src;
  }
  return next;
}

export interface ResourceManagerProps {
  readonly state: EditorState;
  readonly store: EditorStore;
  readonly onClose: () => void;
}

export function ResourceManager({ state, store, onClose }: ResourceManagerProps) {
  const [tab, setTab] = useState<Tab>('characters');
  const [queue, setQueue] = useState<PendingResource[]>([]);
  const queueSeq = useRef(0);

  const enqueue = (items: Omit<PendingResource, 'id' | 'checked'>[]): void => {
    if (items.length === 0) {
      return;
    }
    setQueue((prev) => [
      ...prev,
      ...items.map((it) => ({ ...it, id: `q${queueSeq.current++}`, checked: true })),
    ]);
  };

  /** 批量导入音频：读文件 → data URL，进导入队列。 */
  const importAudios = async (files: File[]): Promise<void> => {
    const items: Omit<PendingResource, 'id' | 'checked'>[] = [];
    for (const file of files) {
      const url = await readFileAsDataUrl(file);
      items.push({ kind: 'audio', name: file.name.replace(/\.[^.]+$/, ''), dataUrl: url });
    }
    enqueue(items);
  };

  /** 导入 hzc/nvsg 立绘：解码 → PNG data URL，进导入队列（.bin 归档按条目）。 */
  const importHzc = async (files: File[]): Promise<void> => {
    const items: Omit<PendingResource, 'id' | 'checked'>[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isBin = file.name.toLowerCase().endsWith('.bin');
      const entries = isBin
        ? parseBinArchive(bytes).map((e) => ({ name: e.name, bytes: e.bytes }))
        : [{ name: file.name, bytes }];
      for (const item of entries) {
        try {
          const img = await decodeHzc1(item.bytes);
          const url = rgbaToPngDataUrl(img.width, img.height, img.rgba);
          items.push({ kind: 'character', name: item.name.replace(/\.[^.]+$/, ''), dataUrl: url });
        } catch {
          // 非 hzc 图片条目跳过
        }
      }
    }
    enqueue(items);
  };

  /** 一次性提交导入队列（勾选项 → 一次 undo 步）。 */
  const commitQueue = (): void => {
    const selected = queue.filter((q) => q.checked);
    const characters = selected
      .filter((q) => q.kind === 'character')
      .map((q) => ({ name: q.name, speakFn: null, pose: 0, costume: 0, face: 0, image: q.dataUrl, poses: [] }));
    const audios = selected
      .filter((q) => q.kind === 'audio')
      .map((q) => ({ type: 'bgm' as const, number: 0, label: q.name, src: q.dataUrl }));
    if (characters.length > 0) {
      store.dispatch(addCharacters(characters));
    }
    if (audios.length > 0) {
      const maxByType = new Map<string, number>();
      for (const a of state.resources.audios) {
        maxByType.set(a.type, Math.max(maxByType.get(a.type) ?? 0, a.number));
      }
      let next = maxByType.get('bgm') ?? 0;
      store.dispatch(addAudios(audios.map((a) => ({ ...a, number: ++next }))));
    }
    setQueue((prev) => prev.filter((q) => !selected.includes(q)));
  };

  const toggleQueueItem = (id: string): void => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, checked: !q.checked } : q)));
  };

  /** 拖拽导入：图片 → 角色候选，音频 → 音频候选。 */
  const onDropFiles = (files: File[]): void => {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(hzc1|bin)$/i.test(f.name));
    const audios = files.filter((f) => f.type.startsWith('audio/'));
    void importHzc(images).then(() => importAudios(audios));
  };

  return (
    <div className="workspace">
      <header className="workspace__header">
        <span className="workspace__title">资源工作台</span>
        <button type="button" className="topbar-btn" onClick={onClose}>
          ← 返回编辑器
        </button>
      </header>

      <div className="workspace__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'characters'} className={`workspace__tab${tab === 'characters' ? ' workspace__tab--active' : ''}`} onClick={() => setTab('characters')}>
          角色
        </button>
        <button type="button" role="tab" aria-selected={tab === 'backgrounds'} className={`workspace__tab${tab === 'backgrounds' ? ' workspace__tab--active' : ''}`} onClick={() => setTab('backgrounds')}>
          背景
        </button>
        <button type="button" role="tab" aria-selected={tab === 'audios'} className={`workspace__tab${tab === 'audios' ? ' workspace__tab--active' : ''}`} onClick={() => setTab('audios')}>
          音频
        </button>
      </div>

      <div
        className="workspace__body"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) {
            onDropFiles(files);
          }
        }}
      >
          {queue.length > 0 && (
            <div className="import-queue">
              <div className="import-queue__head">
                <span className="import-queue__title">
                  导入队列（{queue.filter((q) => q.checked).length}/{queue.length}）
                </span>
                <div className="import-queue__actions">
                  <button type="button" className="btn btn--secondary" onClick={() => setQueue([])}>
                    清空
                  </button>
                  <button type="button" className="btn btn--primary" onClick={commitQueue}>
                    确认导入
                  </button>
                </div>
              </div>
              <div className="import-queue__grid">
                {queue.map((q) => (
                  <label className="import-queue__item" key={q.id}>
                    <input type="checkbox" checked={q.checked} onChange={() => toggleQueueItem(q.id)} />
                    {q.kind === 'character' ? (
                      <img className="import-queue__thumb" src={q.dataUrl} alt={q.name} />
                    ) : (
                      <span className="import-queue__badge">音频</span>
                    )}
                    <span className="import-queue__name">{q.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {tab === 'characters' && (
            <div className="resource-grid">
              {state.resources.characters.length === 0 && (
                <div className="resource-empty">还没有角色，点击下方「添加角色」。</div>
              )}
              {state.resources.characters.map((r) => (
                <article className="resource-card" key={r.id}>
                  <header className="resource-card__head">
                    {r.image ? (
                      <img className="resource-card__avatar-img" src={r.image} alt={r.name} />
                    ) : (
                      <span className="resource-card__avatar" style={avatarStyle(r.name)}>
                        {r.name.trim().slice(0, 1) || '?'}
                      </span>
                    )}
                    {r.builtin && <span className="resource-card__badge">内置</span>}
                    <input className="resource-card__name" value={r.name} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { name: e.target.value })))} />
                    {!r.builtin && (
                      <button type="button" className="resource-card__remove" aria-label="删除角色" onClick={() => store.dispatch(removeCharacter(r.id))}>×</button>
                    )}
                  </header>
                  <label className="resource-card__import">
                    {r.image ? '更换立绘' : '导入立绘'}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void readFileAsDataUrl(file).then((url) => store.dispatch(editCharacter(r.id, updateCharacter(r, { image: url }))));
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <input className="resource-card__sub" value={r.alias ?? ''} placeholder="别名（可选）" onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { alias: e.target.value })))} />
                  <div className="resource-card__poses">
                    <div className="resource-card__poses-title">表情集（姿势 / 服装 / 表情 → 图）</div>
                    {(r.poses ?? []).map((p, i) => (
                      <div className="resource-card__pose" key={i}>
                        {p.image ? (
                          <img className="resource-card__pose-img" src={p.image} alt={`${r.name} ${p.pose}/${p.costume}/${p.face}`} />
                        ) : (
                          <span className="resource-card__pose-empty">无图</span>
                        )}
                        <div className="resource-card__pose-fields">
                          <input
                            type="number"
                            value={p.pose}
                            title="姿势 pose"
                            onChange={(e) => {
                              const poses = (r.poses ?? []).map((q, j) => (j === i ? { ...q, pose: Number(e.target.value) } : q));
                              store.dispatch(editCharacter(r.id, updateCharacter(r, { poses })));
                            }}
                          />
                          <input
                            type="number"
                            value={p.costume}
                            title="服装 costume"
                            onChange={(e) => {
                              const poses = (r.poses ?? []).map((q, j) => (j === i ? { ...q, costume: Number(e.target.value) } : q));
                              store.dispatch(editCharacter(r.id, updateCharacter(r, { poses })));
                            }}
                          />
                          <input
                            type="number"
                            value={p.face}
                            title="表情 face"
                            onChange={(e) => {
                              const poses = (r.poses ?? []).map((q, j) => (j === i ? { ...q, face: Number(e.target.value) } : q));
                              store.dispatch(editCharacter(r.id, updateCharacter(r, { poses })));
                            }}
                          />
                        </div>
                        <label className="resource-card__import resource-card__import--sm">
                          图
                          <input
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                void readFileAsDataUrl(file).then((url) => {
                                  const poses = (r.poses ?? []).map((q, j) => (j === i ? { ...q, image: url } : q));
                                  store.dispatch(editCharacter(r.id, updateCharacter(r, { poses })));
                                });
                              }
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="resource-card__remove"
                          aria-label="删除表情"
                          onClick={() => store.dispatch(editCharacter(r.id, updateCharacter(r, { poses: (r.poses ?? []).filter((_, j) => j !== i) })))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="resource-card__pose-add"
                      onClick={() => store.dispatch(editCharacter(r.id, updateCharacter(r, { poses: [...(r.poses ?? []), { pose: r.pose, costume: r.costume, face: r.face, image: r.image ?? '' }] })))}
                    >
                      + 添加表情
                    </button>
                  </div>
                  <div className="resource-card__meta">
                    <label className="resource-card__field">
                      <span>姿势</span>
                      <input type="number" value={r.pose} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { pose: Number(e.target.value) })))} />
                    </label>
                    <label className="resource-card__field">
                      <span>服装</span>
                      <input type="number" value={r.costume} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { costume: Number(e.target.value) })))} />
                    </label>
                    <label className="resource-card__field">
                      <span>表情</span>
                      <input type="number" value={r.face} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { face: Number(e.target.value) })))} />
                    </label>
                  </div>
                  <label className="resource-card__adv">
                    <span>SPEAK 函数</span>
                    <input className="resource-card__adv-input" value={r.speakFn ?? ''} placeholder="自动分配" onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { speakFn: intOrNull(e.target.value) })))} />
                  </label>
                </article>
              ))}
            </div>
          )}

          {tab === 'backgrounds' && (
            <div className="resource-grid">
              {state.resources.backgrounds.length === 0 && (
                <div className="resource-empty">还没有背景，点击下方「添加背景」。</div>
              )}
              {state.resources.backgrounds.map((r) => (
                <article className="resource-card" key={r.id}>
                  <div className="resource-card__thumb">
                    {r.image ? <img src={r.image} alt={r.name} /> : <span>{r.name}</span>}
                  </div>
                  <header className="resource-card__head">
                    <input className="resource-card__name" value={r.name} onChange={(e) => store.dispatch(editBackground(r.id, updateBackground(r, { name: e.target.value })))} />
                    <button type="button" className="resource-card__remove" aria-label="删除背景" onClick={() => store.dispatch(removeBackground(r.id))}>×</button>
                  </header>
                  <label className="resource-card__import">
                    {r.image ? '更换背景' : '导入背景'}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void readFileAsDataUrl(file).then((url) => store.dispatch(editBackground(r.id, updateBackground(r, { image: url }))));
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <div className="resource-card__meta">
                    <label className="resource-card__field">
                      <span>变体</span>
                      <input type="number" value={r.variant} onChange={(e) => store.dispatch(editBackground(r.id, updateBackground(r, { variant: Number(e.target.value) })))} />
                    </label>
                    <label className="resource-card__field">
                      <span>背景函数</span>
                      <input value={r.bgFn ?? ''} placeholder="自动" onChange={(e) => store.dispatch(editBackground(r.id, updateBackground(r, { bgFn: intOrNull(e.target.value) })))} />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          )}

          {tab === 'audios' && (
            <div className="resource-grid">
              {state.resources.audios.length === 0 && (
                <div className="resource-empty">还没有音频，点击下方「添加音频」。</div>
              )}
              {state.resources.audios.map((r) => (
                <article className="resource-card resource-card--audio" key={r.id}>
                  <header className="resource-card__head">
                    <span className="resource-card__badge">{r.type}</span>
                    <input className="resource-card__name" value={r.label} placeholder="标签（如片头曲）" onChange={(e) => store.dispatch(editAudio(r.id, updateAudio(r, { label: e.target.value })))} />
                    <button type="button" className="resource-card__remove" aria-label="删除音频" onClick={() => store.dispatch(removeAudio(r.id))}>×</button>
                  </header>
                  {r.src && <audio className="resource-card__player" controls src={r.src} />}
                  <label className="resource-card__import">
                    {r.src ? '更换音频' : '导入音频'}
                    <input
                      type="file"
                      accept="audio/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void readFileAsDataUrl(file).then((url) => store.dispatch(editAudio(r.id, updateAudio(r, { src: url }))));
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <div className="resource-card__meta">
                    <label className="resource-card__field">
                      <span>类型</span>
                      <select className="resource-card__select" value={r.type} onChange={(e) => store.dispatch(editAudio(r.id, updateAudio(r, { type: e.target.value as AudioResource['type'] })))}>
                        <option value="bgm">bgm</option>
                        <option value="voice">voice</option>
                        <option value="se">se</option>
                      </select>
                    </label>
                    <label className="resource-card__field">
                      <span>编号</span>
                      <input type="number" value={r.number} onChange={(e) => store.dispatch(editAudio(r.id, updateAudio(r, { number: Number(e.target.value) })))} />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="workspace__footer">
          {tab === 'characters' && (
            <>
              <button type="button" className="btn btn--secondary" onClick={() => store.dispatch(addCharacter({ name: '新角色', speakFn: null, pose: 0, costume: 0, face: 0, poses: [] }))}>
                + 添加角色
              </button>
              <label className="btn btn--secondary">
                导入 hzc/bin 立绘
                <input
                  type="file"
                  accept=".hzc1,.bin"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    void importHzc(files);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}
          {tab === 'backgrounds' && (
            <button type="button" className="btn btn--secondary" onClick={() => store.dispatch(addBackground({ name: '新背景', variant: 0, bgFn: null }))}>
              + 添加背景
            </button>
          )}
          {tab === 'audios' && (
            <>
              <button type="button" className="btn btn--secondary" onClick={() => store.dispatch(addAudio({ type: 'bgm', number: 0, label: '' }))}>
                + 添加音频
              </button>
              <label className="btn btn--secondary">
                批量导入音频
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    void importAudios(files);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}
        </footer>
    </div>
  );
}
