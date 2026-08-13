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
  editCharacters,
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
import { decodeHzc1, rgbaToPngDataUrl } from '../resources/hzc.js';
import { parseBinArchive } from '../resources/bin.js';
import { importGraphBsFile } from '../resources/graph-bs.js';

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

/** 角色统计卡片（列表视图）：缩略图 + 名称 + 统计数字，点击进入详情。 */
function CharacterStatCard({ r, onOpen }: { readonly r: CharacterResource; readonly onOpen: () => void }) {
  const poseCount = (r.poses ?? []).length;
  const stats: string[] = [`表情集 ${poseCount}`];
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
          <img src={r.image} alt={r.name} />
        ) : (
          <span className="resource-card__avatar" style={avatarStyle(r.name)}>
            {r.name.trim().slice(0, 1) || '?'}
          </span>
        )}
      </span>
      <span className="character-stat__body">
        <span className="character-stat__name">
          {r.builtin && <span className="resource-card__badge">内置</span>}
          {r.name}
        </span>
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
          {r.builtin && <span className="resource-card__badge">内置</span>}
        </div>
        {!r.builtin && (
          <button type="button" className="character-detail__delete" onClick={() => store.dispatch(removeCharacter(r.id))}>
            删除角色
          </button>
        )}
      </header>

      <div className="character-detail__grid">
        <section className="detail-section detail-section--preview">
          <div className="character-detail__stage">
            {r.image ? (
              <img className="character-detail__img" src={r.image} alt={r.name} />
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
              <input className="form-field__input" value={r.name} onChange={(e) => store.dispatch(editCharacter(r.id, updateCharacter(r, { name: e.target.value })))} />
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
            表情集 <span className="detail-section__count">{poses.length}</span>
          </h3>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => store.dispatch(editCharacter(r.id, updateCharacter(r, { poses: [...poses, { pose: r.pose, costume: r.costume, face: r.face, image: r.image ?? '' }] })))}
          >
            + 添加表情
          </button>
        </div>
        {poses.length === 0 ? (
          <p className="detail-section__empty">尚未配置表情集，点击「添加表情」开始。</p>
        ) : (
          <div className="pose-grid">
            {poses.map((p, i) => (
              <div className="pose-tile" key={i}>
                {p.image ? (
                  <img className="pose-tile__img" src={p.image} alt={`${r.name} ${p.pose}/${p.costume}/${p.face}`} />
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
                    <label className="pose-tile__field">
                      <span>表情</span>
                      <input type="number" value={p.face} onChange={(e) => setPose(i, { face: Number(e.target.value) })} />
                    </label>
                  </div>
                  <div className="pose-tile__actions">
                    <label className="pose-tile__action">
                      换图
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            void readFileAsDataUrl(file).then((url) => setPose(i, { image: url }));
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button type="button" className="pose-tile__action pose-tile__action--danger" onClick={() => store.dispatch(editCharacter(r.id, updateCharacter(r, { poses: poses.filter((_, j) => j !== i) })))}>
                      移除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
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
  const [queue, setQueue] = useState<PendingResource[]>([]);
  const [importingCount, setImportingCount] = useState(0);
  const [openCharId, setOpenCharId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ readonly done: number; readonly total: number } | null>(null);
  const queueSeq = useRef(0);
  const importing = importingCount > 0;

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
    setImportingCount((c) => c + 1);
    try {
      const items: Omit<PendingResource, 'id' | 'checked'>[] = [];
      for (const file of files) {
        const url = await readFileAsDataUrl(file);
        items.push({ kind: 'audio', name: file.name.replace(/\.[^.]+$/, ''), dataUrl: url });
      }
      enqueue(items);
    } finally {
      setImportingCount((c) => c - 1);
    }
  };

  /** 导入普通图片（PNG/JPG 等）：直接作为角色立绘候选。 */
  const importImages = async (files: File[]): Promise<void> => {
    setImportingCount((c) => c + 1);
    try {
      const items: Omit<PendingResource, 'id' | 'checked'>[] = [];
      for (const file of files) {
        const url = await readFileAsDataUrl(file);
        items.push({ kind: 'character', name: file.name.replace(/\.[^.]+$/, ''), dataUrl: url });
      }
      enqueue(items);
    } finally {
      setImportingCount((c) => c - 1);
    }
  };

  /** 导入 hzc/nvsg 立绘：解码 → PNG data URL，进导入队列（.bin 归档按条目）。 */
  const importHzc = async (files: File[]): Promise<void> => {
    setImportingCount((c) => c + 1);
    try {
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
          } catch (err) {
            // .bin 归档内允许混有非 hzc 条目，静默跳过；单文件失败则明确提示。
            if (!isBin) {
              window.alert(`hzc 解码失败：${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }
      enqueue(items);
    } finally {
      setImportingCount((c) => c - 1);
    }
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

  /** 拖拽导入：普通图片/hzc/bin → 立绘候选，音频 → 音频候选。 */
  const onDropFiles = (files: File[]): void => {
    const hzcFiles = files.filter((f) => /\.(hzc1|bin)$/i.test(f.name));
    const plainImages = files.filter((f) => f.type.startsWith('image/') && !/\.(hzc1|bin)$/i.test(f.name));
    const audios = files.filter((f) => f.type.startsWith('audio/'));
    void importImages(plainImages);
    void importHzc(hzcFiles);
    void importAudios(audios);
  };

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
          {importing && (
            <div className="import-progress" role="status" aria-label="正在导入">
              <div className="import-progress__bar" />
              <span className="import-progress__text">
                {importProgress ? `正在导入… ${importProgress.done}/${importProgress.total}` : '正在导入…'}
              </span>
            </div>
          )}
          {queue.length > 0 && (
            <div className="import-queue">
              <div className="import-queue__head">
                <span className="import-queue__title">
                  导入队列（{queue.filter((q) => q.checked).length}/{queue.length}）
                </span>
                <div className="import-queue__actions">
                  <button type="button" className="btn btn--secondary" disabled={importing} onClick={() => setQueue([])}>
                    清空
                  </button>
                  <button type="button" className="btn btn--primary" disabled={importing} onClick={commitQueue}>
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
            openChar ? (
              <CharacterDetail key={openChar.id} r={openChar} store={store} onBack={() => setOpenCharId(null)} />
            ) : (
              <div className="resource-grid resource-grid--cards">
                {state.resources.characters.length === 0 && (
                  <div className="resource-empty">还没有角色，点击下方「添加角色」。</div>
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
                导入立绘（图片 / hzc / bin）
                <input
                  type="file"
                  accept="image/*,.hzc1,.bin"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    const hzc = files.filter((f) => /\.(hzc1|bin)$/i.test(f.name));
                    const images = files.filter((f) => !/\.(hzc1|bin)$/i.test(f.name));
                    void importHzc(hzc).then(() => importImages(images));
                    e.target.value = '';
                  }}
                />
              </label>
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
