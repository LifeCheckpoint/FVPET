/**
 * 资源管理器：角色 / 背景 / 音频三张可编辑卡片（模态对话框）。
 * 卡片给出资源本身的视觉表现（立绘缩略图 / 背景缩略图 / 音频试听），
 * 支持导入本地图片 / 音频（FileReader → data URL），
 * 技术字段（函数地址 / pose / costume / face 等）折叠为次要小字，降低陌生感。
 * 修改走资源命令（add/edit/remove），undo/redo 由 store 统一接管。
 */

import { useState, type CSSProperties } from 'react';
import {
  addAudios,
  addBackgrounds,
  addCgs,
  editAudio,
  editBackground,
  editCharacter,
  editCharacters,
  removeAudio,
  removeBackground,
  removeCg,
  renameBackground,
  renameCharacter,
  type AudioResource,
  type BackgroundResource,
  type CharacterFace,
  type CharacterPose,
  type CharacterResource,
  type EditorState,
  type EditorStore,
} from '@hcb-editor/editor';
import { assetUrl } from '../projectDir.js';
import { loadBaseGame } from '@hcb-editor/compiler';
import { importGraphBsFile } from '../resources/graph-bs.js';
import { importCgBinFile, importGraphBgFile } from '../resources/graph-bg.js';
import { importBgmBinFile } from '../resources/audio-bin.js';

type Tab = 'characters' | 'backgrounds' | 'cgs' | 'audios';

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

/** 表情悬停预览：body 立绘显示宽度（表情叠加位置按 bodyWidth 等比缩放）。 */
const FACE_PREVIEW_W = 320;

/** 角色统计卡片（列表视图）：缩略图 + 名称 + 统计数字，点击进入详情。 */
function CharacterStatCard({ r, onOpen }: { readonly r: CharacterResource; readonly onOpen: () => void }) {
  const poses = r.poses ?? [];
  const faceCount = poses.reduce((sum, p) => sum + p.faces.length, 0);
  const stats: string[] = [`姿势/服装 ${poses.length}`, `表情 ${faceCount}`];
  if (r.image) {
    stats.push('立绘 ✓');
  }
  if (r.chaNum !== undefined) {
    stats.push(`编号 ${r.chaNum}`);
  }
  return (
    <button type="button" className="character-stat" onClick={onOpen}>
      <span className="character-stat__thumb">
        {r.image ? (
          <img src={assetUrl(r.image)} alt={r.name} />
        ) : (
          <span className="resource-card__avatar" style={avatarStyle(r.name)}>
            {r.name.trim().slice(0, 1) || '?'}
          </span>
        )}
      </span>
      <span className="character-stat__body">
        <span className="character-stat__name">{r.name}</span>
        <span className="character-stat__stats">{stats.join(' · ')}</span>
      </span>
      <span className="character-stat__arrow">›</span>
    </button>
  );
}

/** 角色详情（二级菜单）：分区展示 + 全部编辑项 + 返回列表。 */
function CharacterDetail({ r, store, onBack }: {
  readonly r: CharacterResource;
  readonly store: EditorStore;
  readonly onBack: () => void;
}) {
  const poses = r.poses ?? [];
  const [facePreview, setFacePreview] = useState<{
    readonly p: CharacterPose;
    readonly face: CharacterFace;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const setPose = (i: number, patch: Partial<CharacterPose>): void => {
    const next = poses.map((q, j) => (j === i ? { ...q, ...patch } : q));
    store.dispatch(editCharacter(r.id, updateCharacter(r, { poses: next })));
  };
  const setChaNum = (value: string): void => {
    const n = intOrNull(value);
    const next = { ...r };
    if (n === null) {
      delete next.chaNum;
    } else {
      next.chaNum = n;
    }
    store.dispatch(editCharacter(r.id, next));
  };

  return (
    <div className="character-detail">
      <header className="character-detail__bar">
        <button type="button" className="btn btn--secondary" onClick={onBack}>← 返回</button>
        <div className="character-detail__identity">
          <h2 className="character-detail__title">{r.name}</h2>
        </div>
      </header>

      <div className="character-detail__grid">
        <section className="detail-section detail-section--preview">
          <div className="character-detail__stage">
            {r.image ? (
              <img className="character-detail__img" src={assetUrl(r.image)} alt={r.name} />
            ) : (
              <span className="character-detail__stage-empty">暂无立绘</span>
            )}
          </div>
          <label className="btn btn--secondary btn--block">
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
        </section>

        <section className="detail-section">
          <h3 className="detail-section__title">基础信息</h3>
          <div className="form-grid">
            <label className="form-field">
              <span className="form-field__label">名称</span>
              <input className="form-field__input" value={r.name} onChange={(e) => store.dispatch(renameCharacter(r.id, e.target.value))} />
            </label>
            <label className="form-field">
              <span className="form-field__label">别名</span>
              <input className="form-field__input" value={r.alias ?? ''} placeholder="可选" onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { alias: e.target.value })))} />
            </label>
          </div>
        </section>

        <section className="detail-section">
          <h3 className="detail-section__title">技术参数</h3>
          <div className="form-grid form-grid--3">
            <label className="form-field">
              <span className="form-field__label">姿势</span>
              <input className="form-field__input" type="number" value={r.pose} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { pose: Number(e.target.value) })))} />
            </label>
            <label className="form-field">
              <span className="form-field__label">服装</span>
              <input className="form-field__input" type="number" value={r.costume} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { costume: Number(e.target.value) })))} />
            </label>
            <label className="form-field">
              <span className="form-field__label">表情</span>
              <input className="form-field__input" type="number" value={r.face} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { face: Number(e.target.value) })))} />
            </label>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span className="form-field__label">立绘编号</span>
              <input className="form-field__input" type="number" value={r.chaNum ?? ''} placeholder="自动" onChange={(e) => setChaNum(e.target.value)} />
            </label>
            <label className="form-field">
              <span className="form-field__label">SPEAK 函数</span>
              <input className="form-field__input form-field__input--mono" value={r.speakFn ?? ''} placeholder="自动分配" onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { speakFn: intOrNull(e.target.value) })))} />
            </label>
          </div>
        </section>
      </div>

      <section className="detail-section">
        <div className="detail-section__head">
          <h3 className="detail-section__title">
            立绘集
            <span className="detail-section__count">{poses.length} 组合</span>
            <span className="detail-section__count">{poses.reduce((s, p) => s + p.faces.length, 0)} 表情</span>
          </h3>
        </div>
        {poses.length === 0 ? (
          <p className="detail-section__empty">尚未导入立绘，点击下方「导入内置立绘文件」。</p>
        ) : (
          <div className="pose-grid">
            {poses.map((p, i) => (
              <div className="pose-tile" key={i}>
                {p.image ? (
                  <img className="pose-tile__img" src={assetUrl(p.image)} alt={`${r.name} 姿势${p.pose}/服装${p.costume}`} />
                ) : (
                  <span className="pose-tile__empty">无图</span>
                )}
                <div className="pose-tile__body">
                  <div className="pose-tile__fields">
                    <label className="pose-tile__field">
                      <span>姿势</span>
                      <input type="number" value={p.pose} onChange={(e) => setPose(i, { pose: Number(e.target.value) })} />
                    </label>
                    <label className="pose-tile__field">
                      <span>服装</span>
                      <input type="number" value={p.costume} onChange={(e) => setPose(i, { costume: Number(e.target.value) })} />
                    </label>
                  </div>
                  {p.faces.length > 0 && (
                    <div className="pose-tile__faces">
                      <span className="pose-tile__faces-title">表情</span>
                      <div className="face-thumbs">
                        {p.faces.map((f) => (
                          <span
                            className="face-thumb"
                            key={f.face}
                            title={`表情 ${f.face}`}
                            onMouseEnter={(e) => setFacePreview({ p, face: f, x: e.clientX, y: e.clientY })}
                            onMouseMove={(e) =>
                              setFacePreview((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev))
                            }
                            onMouseLeave={() => setFacePreview(null)}
                          >
                            <img src={assetUrl(f.image)} alt={`表情 ${f.face}`} />
                            <span className="face-thumb__num">{f.face}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {facePreview && (() => {
        const p = facePreview.p;
        const bodyW = p.bodyWidth ?? 0;
        const bodyH = p.bodyHeight ?? 0;
        const pad = 16;
        const maxW = Math.min(FACE_PREVIEW_W, window.innerWidth - pad * 2);
        let previewW = maxW;
        if (bodyW > 0 && bodyH > 0) {
          const maxH = window.innerHeight - pad * 2;
          if (previewW * (bodyH / bodyW) > maxH) {
            previewW = maxH / (bodyH / bodyW);
          }
        }
        const sx = bodyW > 0 ? previewW / bodyW : 1;
        const previewH = bodyH > 0 ? previewW * (bodyH / bodyW) : previewW;
        let left = facePreview.x + 16;
        let top = facePreview.y + 16;
        if (left + previewW + pad > window.innerWidth - 8) {
          left = facePreview.x - previewW - pad - 16;
        }
        if (top + previewH + pad > window.innerHeight - 8) {
          top = Math.max(8, window.innerHeight - previewH - pad - 8);
        }
        return (
          <div className="face-preview" style={{ left, top }}>
            <div className="face-preview__stage" style={{ width: previewW }}>
              {p.image ? (
                <img className="face-preview__body" src={assetUrl(p.image)} alt="" style={{ width: previewW }} />
              ) : null}
              <img
                className="face-preview__face"
                src={assetUrl(facePreview.face.image)}
                alt={`表情 ${facePreview.face.face}`}
                style={{
                  left: (p.faceX ?? 0) * sx,
                  top: (p.faceY ?? 0) * sx,
                  width: (p.faceWidth ?? 0) * sx,
                  height: (p.faceHeight ?? 0) * sx,
                }}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export interface ResourceManagerProps {
  readonly state: EditorState;
  readonly store: EditorStore;
  readonly onClose: () => void;
}

export function ResourceManager({ state, store, onClose }: ResourceManagerProps) {
  const [tab, setTab] = useState<Tab>('characters');
  const [importingCount, setImportingCount] = useState(0);
  const [openCharId, setOpenCharId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ readonly done: number; readonly total: number } | null>(null);
  const importing = importingCount > 0;

  /** 导入内置立绘文件（graph_bs.bin）：解码 → 按角色归类 → 批量填充内置角色立绘（一次 undo）。 */
  const importBuiltinSprites = async (file: File): Promise<void> => {
    setImportingCount((c) => c + 1);
    setImportProgress(null);
    try {
      const result = await importGraphBsFile(file, {
        maxDimension: 1024,
        onProgress: (done, total) => setImportProgress({ done, total }),
      });
      const edits: { readonly id: string; readonly character: CharacterResource }[] = [];
      const unmatched: string[] = [];
      for (const set of result.characters) {
        const target = state.resources.characters.find((c) => c.builtin && c.name === set.name);
        if (!target) {
          unmatched.push(set.name);
          continue;
        }
        edits.push({
          id: target.id,
          character: {
            ...target,
            ...(set.image !== undefined ? { image: set.image } : {}),
            poses: set.poses,
            pose: set.defaultPose,
            costume: set.defaultCostume,
            face: 0,
          },
        });
      }
      if (edits.length > 0) {
        store.dispatch(editCharacters(edits));
      }
      const note = unmatched.length > 0 ? `；未匹配内置角色：${unmatched.join('、')}` : '';
      window.alert(`内置立绘导入完成：${edits.length} 个角色，共 ${result.decoded} 张立绘${note}`);
    } catch (err) {
      window.alert(`内置立绘导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportingCount((c) => c - 1);
      setImportProgress(null);
    }
  };

  /** 导入内置背景文件（graph_bg.bin）：按编号去重保留默认变体，匹配底座 bgFn。 */
  const importBuiltinBackgrounds = async (file: File): Promise<void> => {
    setImportingCount((c) => c + 1);
    setImportProgress(null);
    try {
      const base = loadBaseGame(state.header.game).tables.backgrounds;
      const result = await importGraphBgFile(file, {
        maxDimension: 1280,
        baseBackgrounds: base,
        onProgress: (done, total) => setImportProgress({ done, total }),
      });
      if (result.backgrounds.length > 0) {
        store.dispatch(addBackgrounds(result.backgrounds));
      }
      window.alert(`内置背景导入完成：${result.backgrounds.length} 张背景${result.skipped > 0 ? `，跳过 ${result.skipped}` : ''}`);
    } catch (err) {
      window.alert(`内置背景导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportingCount((c) => c - 1);
      setImportProgress(null);
    }
  };

  /** 导入内置 CG（graph_vis.bin / graph_vish.bin）：全量导入为 CgResource（名称大写）。 */
  const importBuiltinCg = async (files: File[]): Promise<void> => {
    setImportingCount((c) => c + 1);
    setImportProgress(null);
    try {
      let total = 0;
      let skipped = 0;
      for (const file of files) {
        const result = await importCgBinFile(file, {
          maxDimension: 1024,
          onProgress: (done, count) => setImportProgress({ done, total: count }),
        });
        if (result.cgs.length > 0) {
          store.dispatch(addCgs(result.cgs));
        }
        total += result.cgs.length;
        skipped += result.skipped;
      }
      window.alert(`内置CG导入完成：${total} 张CG${skipped > 0 ? `，跳过 ${skipped}` : ''}`);
    } catch (err) {
      window.alert(`内置CG导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportingCount((c) => c - 1);
      setImportProgress(null);
    }
  };

  /** 导入内置音频（bgm.bin）：70 条 OGG → audio data URL。 */
  const importBuiltinAudios = async (file: File): Promise<void> => {
    setImportingCount((c) => c + 1);
    try {
      const result = await importBgmBinFile(file);
      if (result.audios.length > 0) {
        store.dispatch(addAudios(result.audios));
      }
      window.alert(`内置音频导入完成：${result.audios.length} 条${result.skipped > 0 ? `，跳过 ${result.skipped}` : ''}`);
    } catch (err) {
      window.alert(`内置音频导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportingCount((c) => c - 1);
    }
  };

  const openChar = openCharId !== null ? (state.resources.characters.find((c) => c.id === openCharId) ?? null) : null;

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
        <button type="button" role="tab" aria-selected={tab === 'cgs'} className={`workspace__tab${tab === 'cgs' ? ' workspace__tab--active' : ''}`} onClick={() => setTab('cgs')}>
          CG
        </button>
        <button type="button" role="tab" aria-selected={tab === 'audios'} className={`workspace__tab${tab === 'audios' ? ' workspace__tab--active' : ''}`} onClick={() => setTab('audios')}>
          音频
        </button>
      </div>

      <div className="workspace__body">
          {importing && (
            <div className="import-progress" role="status" aria-label="正在导入">
              <div className="import-progress__bar" />
              <span className="import-progress__text">
                {importProgress ? `正在导入… ${importProgress.done}/${importProgress.total}` : '正在导入…'}
              </span>
            </div>
          )}
          {tab === 'characters' && (
            openChar ? (
              <CharacterDetail key={openChar.id} r={openChar} store={store} onBack={() => setOpenCharId(null)} />
            ) : (
              <div className="resource-grid resource-grid--cards">
                {state.resources.characters.length === 0 && (
                  <div className="resource-empty">尚未导入内置立绘，点击下方「导入内置立绘文件」。</div>
                )}
                {state.resources.characters.map((r) => (
                  <CharacterStatCard key={r.id} r={r} onOpen={() => setOpenCharId(r.id)} />
                ))}
              </div>
            )
          )}

          {tab === 'backgrounds' && (
            <div className="resource-grid">
              {state.resources.backgrounds.length === 0 && (
                <div className="resource-empty">还没有背景，点击下方「导入内置背景文件」。</div>
              )}
              {state.resources.backgrounds.map((r) => (
                <article className="resource-card" key={r.id}>
                  <div className="resource-card__thumb">
                    {r.image ? <img src={assetUrl(r.thumb ?? r.image)} alt={r.name} loading="lazy" decoding="async" /> : <span>{r.name}</span>}
                  </div>
                  <header className="resource-card__head">
                    <input className="resource-card__name" value={r.name} onChange={(e) => store.dispatch(renameBackground(r.id, e.target.value))} />
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

          {tab === 'cgs' && (
            <div className="resource-grid">
              {state.resources.cgs.length === 0 && (
                <div className="resource-empty">尚未导入 CG，点击下方「导入内置CG文件」。</div>
              )}
              {state.resources.cgs.map((r) => (
                <article className="resource-card" key={r.id}>
                  <div className="resource-card__thumb">
                    {r.image ? <img src={assetUrl(r.thumb ?? r.image)} alt={r.name} loading="lazy" decoding="async" /> : <span>{r.name}</span>}
                  </div>
                  <header className="resource-card__head">
                    <span className="resource-card__name">{r.name}</span>
                    <button type="button" className="resource-card__remove" aria-label="删除CG" onClick={() => store.dispatch(removeCg(r.id))}>×</button>
                  </header>
                </article>
              ))}
            </div>
          )}

          {tab === 'audios' && (
            <div className="resource-grid resource-grid--audio">
              {state.resources.audios.length === 0 && (
                <div className="resource-empty">还没有音频，点击下方「导入内置音频文件」。</div>
              )}
              {state.resources.audios.map((r) => (
                <article className="resource-card resource-card--audio" key={r.id}>
                  <header className="resource-card__head">
                    <span className="resource-card__badge">{r.type}</span>
                    <input className="resource-card__name" value={r.label} placeholder="标签（如片头曲）" onChange={(e) => store.dispatch(editAudio(r.id, updateAudio(r, { label: e.target.value })))} />
                    <button type="button" className="resource-card__remove" aria-label="删除音频" onClick={() => store.dispatch(removeAudio(r.id))}>×</button>
                  </header>
                  {r.src && <audio className="resource-card__player" controls src={assetUrl(r.src)} />}
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
            <label className="btn btn--secondary">
              导入内置立绘文件
              <input
                type="file"
                accept=".bin"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void importBuiltinSprites(file);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {tab === 'backgrounds' && (
            <label className="btn btn--secondary">
              导入内置背景文件
              <input
                type="file"
                accept=".bin"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void importBuiltinBackgrounds(file);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {tab === 'cgs' && (
            <label className="btn btn--secondary">
              导入内置CG文件
              <input
                type="file"
                accept=".bin"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) {
                    void importBuiltinCg(files);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {tab === 'audios' && (
            <label className="btn btn--secondary">
              导入内置音频文件
              <input
                type="file"
                accept=".bin"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void importBuiltinAudios(file);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </footer>
    </div>
  );
}
