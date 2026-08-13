/**
 * 资源管理器：角色 / 背景 / 音频三张可编辑卡片（模态对话框）。
 * 卡片给出资源本身的视觉表现（立绘缩略图 / 背景缩略图 / 音频试听），
 * 支持导入本地图片 / 音频（FileReader → data URL），
 * 技术字段（函数地址 / pose / costume / face 等）折叠为次要小字，降低陌生感。
 * 修改走资源命令（add/edit/remove），undo/redo 由 store 统一接管。
 */

import { useState, type CSSProperties } from 'react';
import {
  addAudio,
  addBackground,
  addCharacter,
  editAudio,
  editBackground,
  editCharacter,
  removeAudio,
  removeBackground,
  removeCharacter,
  type AudioResource,
  type BackgroundResource,
  type CharacterResource,
  type EditorState,
  type EditorStore,
} from '@hcb-editor/editor';

type Tab = 'characters' | 'backgrounds' | 'audios';

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

function updateCharacter(r: CharacterResource, patch: {
  readonly name?: string;
  readonly alias?: string;
  readonly speakFn?: number | null;
  readonly pose?: number;
  readonly costume?: number;
  readonly face?: number;
  readonly image?: string;
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

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="资源管理器">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__header">
          <span className="modal__title">资源管理器</span>
          <button type="button" className="modal__close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'characters'} className={`modal__tab${tab === 'characters' ? ' modal__tab--active' : ''}`} onClick={() => setTab('characters')}>
            角色
          </button>
          <button type="button" role="tab" aria-selected={tab === 'backgrounds'} className={`modal__tab${tab === 'backgrounds' ? ' modal__tab--active' : ''}`} onClick={() => setTab('backgrounds')}>
            背景
          </button>
          <button type="button" role="tab" aria-selected={tab === 'audios'} className={`modal__tab${tab === 'audios' ? ' modal__tab--active' : ''}`} onClick={() => setTab('audios')}>
            音频
          </button>
        </div>

        <div className="modal__body">
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
                    <input className="resource-card__name" value={r.name} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { name: e.target.value })))} />
                    <button type="button" className="resource-card__remove" aria-label="删除角色" onClick={() => store.dispatch(removeCharacter(r.id))}>×</button>
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

        <footer className="modal__footer">
          {tab === 'characters' && (
            <button type="button" className="btn btn--secondary" onClick={() => store.dispatch(addCharacter({ name: '新角色', speakFn: null, pose: 0, costume: 0, face: 0 }))}>
              + 添加角色
            </button>
          )}
          {tab === 'backgrounds' && (
            <button type="button" className="btn btn--secondary" onClick={() => store.dispatch(addBackground({ name: '新背景', variant: 0, bgFn: null }))}>
              + 添加背景
            </button>
          )}
          {tab === 'audios' && (
            <button type="button" className="btn btn--secondary" onClick={() => store.dispatch(addAudio({ type: 'bgm', number: 0, label: '' }))}>
              + 添加音频
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
