/**
 * 编辑器外壳：三栏布局 + 顶栏（撤销重做 / 资源 / 设置 / 新建工程）。
 * 左 = 节点调色板 + 资源入口；中 = 流程图主画布；右 = 属性 / 剧本文本切换。
 */

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { deserializeProject, replaceAssetRefs } from '@hcb-editor/editor';
import { openTextFile, saveBinaryFile } from '../fileDialog.js';
import { getActiveProjectDir, openProjectDir, saveProjectDir, saveProjectDirAs, setActiveProjectDir } from '../projectDir.js';
import { loadBaseBinary } from '../preview/baseBinary.js';
import { compileEditorState } from '../preview/compileFromState.js';
import { useEditorStore } from '../store/useEditorStore.js';
import { usePreferences } from '../preferences/usePreferences.js';
import { deriveResourceRoot } from '../preferences/preferences.js';
import { Palette } from './Palette.js';
import { PropertyPanel } from './PropertyPanel.js';
import { ScriptTextView } from './ScriptTextView.js';
import { TimelineView } from './TimelineView.js';
import { ResourceManager } from './ResourceManager.js';
import { Settings } from './Settings.js';
import { NewProjectWizard } from './NewProjectWizard.js';
import { FlowCanvas, type FlowCanvasHandle } from '../flow/FlowCanvas.js';
import { PreviewPanel } from '../preview/PreviewPanel.js';
import type { CreatableNodeKind } from '../theme/meta.js';

type RightView = 'property' | 'script' | 'timeline';
type MainView = 'editor' | 'workspace';

/** 分隔条拖拽：mousedown 后全局监听 mousemove/mouseup，按增量回调。 */
function dragResize(e: ReactMouseEvent, cursor: string, onMove: (dx: number, dy: number) => void): void {
  e.preventDefault();
  let lastX = e.clientX;
  let lastY = e.clientY;
  const onMouseMove = (ev: MouseEvent): void => {
    onMove(ev.clientX - lastX, ev.clientY - lastY);
    lastX = ev.clientX;
    lastY = ev.clientY;
  };
  const onMouseUp = (): void => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  document.body.style.cursor = cursor;
  document.body.style.userSelect = 'none';
}

export function AppShell() {
  const { store, state } = useEditorStore();
  const { prefs, update } = usePreferences();
  const flowRef = useRef<FlowCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rightView, setRightView] = useState<RightView>('property');
  const [view, setView] = useState<MainView>('editor');
  const [showSettings, setShowSettings] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [hasProject, setHasProject] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  // 面板尺寸（可拖拽调节，内存态，不持久化）。
  const [rightWidth, setRightWidth] = useState(() => Math.max(320, Math.round(window.innerWidth * 0.38)));
  const [previewRatio, setPreviewRatio] = useState(0.55);
  const rightRef = useRef<HTMLElement>(null);

  const clampRight = (w: number): number => Math.min(window.innerWidth - 400, Math.max(320, w));

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [prefs.theme]);

  const addNode = (kind: CreatableNodeKind) => {
    flowRef.current?.add(kind);
  };

  const locateNode = (nodeId: string) => {
    flowRef.current?.locate(nodeId);
  };
/** 保存工程：已保存过则静默写回原目录；否则弹「另存为」并记录目录。 */
const saveProject = () => {
  if (savedPath) {
    void saveProjectDirAs(savedPath, state)
      .then((refs) => {
        if (Object.keys(refs).length > 0) {
          store.dispatch(replaceAssetRefs(refs));
        }
        store.markSaved();
      })
      .catch(() => {
        // 写回失败（目录被移动等）静默忽略，可改用「另存为」。
      });
    return;
  }
  void saveProjectDir(state).then(({ path, refs }) => {
    if (path) {
      setSavedPath(path);
      setActiveProjectDir(path);
      if (Object.keys(refs).length > 0) {
        store.dispatch(replaceAssetRefs(refs));
      }
      store.markSaved();
    }
  });
};

/** 另存为：始终弹目录选择对话框，保存到新目录并切换活动工程。 */
const saveProjectAs = () => {
  void saveProjectDir(state).then(({ path, refs }) => {
    if (path) {
      setSavedPath(path);
      setActiveProjectDir(path);
      if (Object.keys(refs).length > 0) {
        store.dispatch(replaceAssetRefs(refs));
      }
      store.markSaved();
    }
  });
};

// 自动保存：保存过工程目录后，状态变化 3 秒静默写回（Electron 专有，浏览器忽略）。
useEffect(() => {
  if (!savedPath || !store.isDirty) {
    return;
  }
  const timer = setTimeout(() => {
    void saveProjectDirAs(savedPath, state)
      .then((refs) => {
        if (Object.keys(refs).length > 0) {
          store.dispatch(replaceAssetRefs(refs));
        }
        store.markSaved();
      })
      .catch(() => {
        // 自动保存失败（目录被移动等）静默忽略，不打断用户。
      });
  }, 3000);
  return () => clearTimeout(timer);
}, [savedPath, state, store]);
function parentDir(filePath: string): string | null {
  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return separator > 0 ? filePath.slice(0, separator) : null;
}

const openProject = (file: File) => {
  void file.text().then((text) => {
    store.load(deserializeProject(text));
    // Electron 的 File 对象可能携带 path；普通浏览器没有该字段。
    const filePath = (file as File & { readonly path?: string }).path;
    const dir = filePath ? parentDir(filePath) : null;
    setSavedPath(dir);
    setActiveProjectDir(dir);
    setHasProject(true);
  });
};

const openProjectDialog = () => {
  void openProjectDir().then(async (loaded) => {
    if (loaded) {
      store.load(loaded);
      setSavedPath(getActiveProjectDir());
      setHasProject(true);
      return;
    }

    // Electron 下允许直接选择 F:/.../project.json；必须保留其父目录，
    // 否则 project.json 中的 assets/... 会被 Pixi 当作应用目录相对 URL。
    const picked = await openTextFile();
    if (picked?.path) {
      store.load(deserializeProject(picked.text));
      const dir = parentDir(picked.path);
      setSavedPath(dir);
      setActiveProjectDir(dir);
      setHasProject(true);
      return;
    }
    fileInputRef.current?.click();
  });
};

const exportHcb = () => {
  void (async () => {
    try {
      const baseData = await loadBaseBinary(state.header.game);
      const bytes = compileEditorState(state, baseData);
      await saveBinaryFile('project.hcb', bytes);
      if (!baseData) {
        window.alert('已导出脚本-only 产物（不含底座库，不可独立运行）。请在 Electron 中配置底座游戏 HCB 以导出可运行 .hcb。');
      }
    } catch (err) {
      window.alert(
        `编译失败：${err instanceof Error ? err.message : String(err)}（角色/背景需存在于底座或资源管理器中）`,
      );
    }
  })();
  };

  return (
    <div className="app">
      <header className="app__topbar">
        <span className="app__brand">
          FVP 剧情编辑器
          {store.isDirty && <span className="app__dirty" title="有未保存的改动"> *</span>}
        </span>
        <nav className="app__views" role="tablist" aria-label="主视图">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'editor'}
            className={`app__view${view === 'editor' ? ' app__view--active' : ''}`}
            disabled={!hasProject}
            onClick={() => setView('editor')}
          >
            剧情编辑器
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'workspace'}
            className={`app__view${view === 'workspace' ? ' app__view--active' : ''}`}
            disabled={!hasProject}
            onClick={() => setView('workspace')}
          >
            资源工作台
          </button>
        </nav>
        <div className="app__topbar-actions">
          <button type="button" className="topbar-btn" disabled={!store.canUndo} onClick={() => store.undo()}>
            撤销
          </button>
          <button type="button" className="topbar-btn" disabled={!store.canRedo} onClick={() => store.redo()}>
            重做
          </button>
          <button type="button" className="topbar-btn" disabled={!hasProject} onClick={saveProject}>
            保存工程
          </button>
          <button type="button" className="topbar-btn" disabled={!hasProject} onClick={saveProjectAs}>
            另存为
          </button>
          <button type="button" className="topbar-btn" onClick={openProjectDialog}>
            打开工程
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                openProject(file);
              }
              e.target.value = '';
            }}
          />
          <button type="button" className="topbar-btn" disabled={!hasProject} onClick={exportHcb}>
            导出 .hcb
          </button>
          <button type="button" className="topbar-btn" disabled={!hasProject} onClick={() => setView('workspace')}>
            资源
          </button>
          <button type="button" className="topbar-btn" onClick={() => setShowSettings(true)}>
            设置
          </button>
          <button type="button" className="topbar-btn topbar-btn--accent" onClick={() => setShowWizard(true)}>
            新建工程
          </button>
        </div>
      </header>

      {!hasProject ? (
        <div className="app__empty">
          <div className="app__empty-card">
            <div className="app__empty-title">FVP 剧情编辑器</div>
            <p className="app__empty-hint">新建或打开一个工程开始编辑剧情。</p>
            <div className="app__empty-actions">
              <button type="button" className="btn btn--primary" onClick={() => setShowWizard(true)}>新建工程</button>
              <button type="button" className="btn btn--secondary" onClick={openProjectDialog}>打开工程</button>
            </div>
          </div>
        </div>
      ) : view === 'editor' ? (
        <div className="app__body">
          <Palette onAdd={addNode} onOpenResources={() => setView('workspace')} />

          <main className="app__canvas">
          <ReactFlowProvider>
            <FlowCanvas ref={flowRef} state={state} store={store} />
          </ReactFlowProvider>
          {state.document.nodes.length <= 2 && (
            <div className="canvas-empty">
              <div className="canvas-empty__title">从「开始」节点出发，搭建剧情</div>
              <ol className="canvas-empty__steps">
                <li>从左侧「节点」拖入一个节点（如台词 / 旁白）</li>
                <li>从「开始」节点右侧的圆点拖线连到它 —— 只有从开始可达的节点才会纳入剧情</li>
                <li>选中节点，在右下「属性」里编辑内容</li>
                <li>右上角预览实时呈现演出效果</li>
              </ol>
            </div>
          )}
          </main>

          <div
            className="app__resizer app__resizer--col"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={(e) => dragResize(e, 'col-resize', (dx) => setRightWidth((w) => clampRight(w - dx)))}
          />

          <section className="app__right" ref={rightRef} style={{ width: rightWidth }}>
            <div className="app__preview" style={{ flex: `${previewRatio} 1 0` }}>
              <PreviewPanel
                state={state}
                ratio={prefs.previewRatio}
                resourceRoot={deriveResourceRoot(prefs.graphBgBinPath, prefs.graphBsBinPath)}
                onLocate={locateNode}
              />
            </div>
            <div
              className="app__resizer app__resizer--row"
              role="separator"
              aria-orientation="horizontal"
              onMouseDown={(e) =>
                dragResize(e, 'row-resize', (_dx, dy) => {
                  const h = rightRef.current?.clientHeight ?? 400;
                  setPreviewRatio((r) => Math.min(0.85, Math.max(0.2, r + dy / h)));
                })
              }
            />
            <div className="app__info" style={{ flex: `${1 - previewRatio} 1 0` }}>
            <div className="app__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={rightView === 'property'}
                className={`app__tab${rightView === 'property' ? ' app__tab--active' : ''}`}
                onClick={() => setRightView('property')}
              >
                属性
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightView === 'script'}
                className={`app__tab${rightView === 'script' ? ' app__tab--active' : ''}`}
                onClick={() => setRightView('script')}
              >
                剧本
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightView === 'timeline'}
                className={`app__tab${rightView === 'timeline' ? ' app__tab--active' : ''}`}
                onClick={() => setRightView('timeline')}
              >
                时间线
              </button>
            </div>
            <div className="app__info-content">
              {rightView === 'property' ? (
                <PropertyPanel state={state} store={store} />
              ) : rightView === 'script' ? (
                <ScriptTextView document={state.document} activeNodeId={state.selection.nodeId} onLocate={locateNode} />
              ) : (
                <TimelineView document={state.document} activeNodeId={state.selection.nodeId} onLocate={locateNode} />
              )}
            </div>
          </div>
        </section>
        </div>
      ) : (
        <ResourceManager state={state} store={store} onClose={() => setView('editor')} />
      )}

      {showSettings && <Settings prefs={prefs} update={update} onClose={() => setShowSettings(false)} />}
      {showWizard && (
        <NewProjectWizard
          store={store}
          defaultNls={prefs.defaultNls}
          onClose={(created) => {
            setShowWizard(false);
            if (created) {
              setHasProject(true);
            }
          }}
        />
      )}
    </div>
  );
}
