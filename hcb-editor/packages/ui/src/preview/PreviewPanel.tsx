/**
 * 预览面板：Pixi 自绘 prim + 文本覆盖 + 点击推进。
 *
 * 文本队列与场景画面（prim）均由编辑器投影（buildPreviewScript）提供：
 *   - texts：speak/dia/audio 线性化为文本队列；
 *   - prims：bgset/cgset/bsset 投影为真实立绘 / 背景图的占位矩形。
 *
 * 真实引擎（Electron 下经 window.rfvp 桥 → rfvp-cli）执行编译产物，只作为
 * 运行时校验补充 done / audio / error 信号；其 draw_solid 矩形（系统 UI 层）
 * 不覆盖编辑器投影的场景画面。缺桥 / 编译失败 / 节点不受支持时自动回退演示引擎。
 *
 * 预览保持游戏原始比例（4:3 / 16:9），画布自适应右栏宽度，不拉伸溢出。
 *
 * pixi 采用懒加载：仅在组件挂载（浏览器）时求值，避免 barrel import
 * 在 jsdom 测试环境触发 canvas 能力检测。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorState } from '@hcb-editor/editor';
import type { FakePrim, FakeScript, RfvpEvent } from '@hcb-editor/rfvp';
import { buildPreviewScript } from './buildPreviewScript.js';
import { loadBaseBinary } from './baseBinary.js';
import { compileEditorStateDetailed } from './compileFromState.js';
import { RfvpClient } from './RfvpClient.js';
import { assetUrl } from '../projectDir.js';
import type { PreviewRatio } from '../preferences/preferences.js';

// pixi 懒加载：需要模块命名空间类型，内联 import() 类型是唯一途径。
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PixiModule = typeof import('pixi.js');

const PRIM_COLOR = 0x3c4656;
const PRIM_W = 96;
const PRIM_H = 176;

let pixiPromise: Promise<PixiModule> | null = null;

function loadPixi(): Promise<PixiModule> {
  pixiPromise ??= import('pixi.js');
  return pixiPromise;
}

type AppInstance = InstanceType<PixiModule['Application']>;
type GraphicsCtor = PixiModule['Graphics'];
type TextCtor = PixiModule['Text'];
type SpriteCtor = PixiModule['Sprite'];
type AssetsApi = PixiModule['Assets'];
type TextureInstance = InstanceType<PixiModule['Texture']>;

/** Pixi v8 的 Texture.from(string) 只读缓存；集中收集并异步装载场景纹理。 */
export async function loadPrimTextures<T>(
  prims: readonly FakePrim[],
  load: (url: string) => Promise<T>,
): Promise<Map<string, T>> {
  const urls = new Set<string>();
  for (const prim of prims) {
    if (prim.image) {
      urls.add(assetUrl(prim.image) ?? prim.image);
    }
    if (prim.face) {
      urls.add(assetUrl(prim.face.image) ?? prim.face.image);
    }
  }
  const textures = new Map<string, T>();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        textures.set(url, await load(url));
      } catch {
        // 单一资源损坏不阻断整个舞台；绘制阶段会回退带角色名的占位框。
      }
    }),
  );
  return textures;
}

/**
 * Pixi v8 预览绘制：先异步解码全部 URL，再原子替换舞台；isCurrent 防止旧工程 /
 * 旧节点的慢请求覆盖新场景。
 */
async function drawPrims(
  app: AppInstance,
  Graphics: GraphicsCtor,
  Text: TextCtor,
  Sprite: SpriteCtor,
  Assets: AssetsApi,
  prims: readonly FakePrim[],
  isCurrent: () => boolean,
): Promise<void> {
  const textures = await loadPrimTextures<TextureInstance>(prims, (url) => Assets.load<TextureInstance>(url));
  if (!isCurrent()) {
    return;
  }

  app.stage.removeChildren().forEach((child) => child.destroy());
  for (const prim of prims) {
    const sourceW = prim.fullscreen ? app.screen.width : prim.w && prim.w > 0 ? prim.w : PRIM_W;
    const sourceH = prim.fullscreen ? app.screen.height : prim.h && prim.h > 0 ? prim.h : PRIM_H;
    const fit = prim.fullscreen ? 1 : Math.min(1, app.screen.height / sourceH);
    const w = sourceW * fit * prim.scale;
    const h = sourceH * fit * prim.scale;
    const alignedX =
      prim.align === 'center'
        ? (app.screen.width - w) / 2
        : prim.align === 'right'
          ? app.screen.width - w
          : 0;
    const x = (prim.align ? alignedX : prim.x) + (prim.align ? prim.x : 0);
    const y = prim.fullscreen ? prim.y : prim.align ? app.screen.height - h + prim.y : prim.y;
    const imageUrl = prim.image ? assetUrl(prim.image) ?? prim.image : undefined;
    const texture = imageUrl ? textures.get(imageUrl) : undefined;

    if (texture) {
      const sprite = new Sprite(texture);
      sprite.width = w;
      sprite.height = h;
      sprite.x = x;
      sprite.y = y;
      sprite.zIndex = prim.z;
      sprite.alpha = prim.alpha;
      sprite.angle = prim.rotate;
      app.stage.addChild(sprite);

      if (prim.face) {
        const faceUrl = assetUrl(prim.face.image) ?? prim.face.image;
        const faceTexture = textures.get(faceUrl);
        if (faceTexture) {
          const sx = prim.face.bodyWidth > 0 ? w / prim.face.bodyWidth : 1;
          const sy = prim.face.bodyHeight > 0 ? h / prim.face.bodyHeight : 1;
          const face = new Sprite(faceTexture);
          face.width = Math.max(1, prim.face.width * sx);
          face.height = Math.max(1, prim.face.height * sy);
          face.x = x + prim.face.x * sx;
          face.y = y + prim.face.y * sy;
          face.zIndex = prim.z + 0.5;
          face.alpha = prim.alpha;
          face.angle = prim.rotate;
          app.stage.addChild(face);
        }
      }
    } else {
      const g = new Graphics();
      g.roundRect(x, y, w, h, 6);
      g.fill({ color: PRIM_COLOR, alpha: prim.alpha });
      g.stroke({ color: 0x5b6b84, width: 1, alpha: prim.alpha });
      g.zIndex = prim.z;
      g.angle = prim.rotate;
      app.stage.addChild(g);

      if (prim.label) {
        const label = new Text({
          text: prim.label,
          style: { fontSize: 13, fill: 0xc4ccd6, fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
        });
        label.anchor.set(0.5, 0);
        label.x = x + w / 2;
        label.y = Math.min(app.screen.height - 20, y + h + 8);
        label.zIndex = prim.z;
        app.stage.addChild(label);
      }
    }
  }
}

export interface PreviewPanelProps {
  readonly state: EditorState;
  readonly ratio: PreviewRatio;
  readonly onLocate?: (nodeId: string) => void;
}

type EngineMode = 'fake' | 'real' | 'error';

export function PreviewPanel({ state, ratio, onLocate }: PreviewPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<AppInstance | null>(null);
  const graphicsRef = useRef<GraphicsCtor | null>(null);
  const textRef = useRef<TextCtor | null>(null);
  const spriteRef = useRef<SpriteCtor | null>(null);
  const assetsRef = useRef<AssetsApi | null>(null);
  const primsRef = useRef<readonly FakePrim[]>([]);
  const renderVersionRef = useRef(0);

  const clientRef = useRef<RfvpClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RfvpClient();
  }

  const textsRef = useRef<readonly { readonly text: string; readonly speaker?: string; readonly audioSrc?: string; readonly choices?: readonly string[] }[]>([]);
  const cursorRef = useRef(0);
  const engineReadyRef = useRef(false);

  const [text, setText] = useState<string | null>(null);
  const [choices, setChoices] = useState<readonly string[] | null>(null);
  const [done, setDone] = useState(false);
  const [, setEngineMode] = useState<EngineMode>(() =>
    clientRef.current!.supported ? 'real' : 'fake',
  );
  const [engineError, setEngineError] = useState<string | null>(null);
  const [audioHint, setAudioHint] = useState<string | null>(null);

  const [width, height] = ratio === '16:9' ? [640, 360] : [640, 480];

  const applyEvents = useCallback((events: readonly RfvpEvent[]) => {
    for (const ev of events) {
      switch (ev.type) {
        case 'text':
          setText(ev.text);
          setDone(false);
          break;
        // 引擎「真实执行」期间 done 才可信；降级（tick 失败 / 进程退出）后
        // engineReadyRef=false，终局改由投影文本队列驱动（advance 本地游标耗尽即完）。
        case 'done':
          if (engineReadyRef.current) {
            setDone(true);
          }
          break;
        case 'audio':
          setAudioHint(
            `${ev.action === 'play' ? '播放' : ev.action === 'stop' ? '停止' : '加载'}音频 slot ${ev.channel}`,
          );
          break;
        // 真实引擎（无头 VM）捕获的 draw_solid 矩形是系统 UI / 对话框 / 转场等
        // “UI 层”，不含立绘、背景等精灵（draw_sprite 被无头渲染器丢弃）。场景画面
        // 始终由编辑器投影的 FakeScript.prims（真实立绘 / 背景图）驱动，引擎 prims
        // 不再覆盖，以免把预览画面替换成系统 UI 矩形。
        case 'prims':
          break;
        case 'error':
          engineReadyRef.current = false;
          setEngineMode('error');
          setEngineError(
            ev.message.includes('tick failed')
              ? '真实引擎执行失败（该节点类型的真实执行尚不完整），已回退演示引擎'
              : ev.message,
          );
          break;
        default:
          break;
      }
    }
  }, []);

  // 初始化 / 销毁 Pixi（懒加载）
  useEffect(() => {
    let disposed = false;
    let app: AppInstance | null = null;

    loadPixi().then(({ Application, Graphics, Text, Sprite, Assets }) => {
      if (disposed) {
        return;
      }
      graphicsRef.current = Graphics;
      textRef.current = Text;
      spriteRef.current = Sprite;
      assetsRef.current = Assets;
      const appInstance = new Application();
      app = appInstance;
      return appInstance
        .init({ width, height, backgroundAlpha: 0, antialias: true })
        .then(() => {
          if (disposed) {
            appInstance.destroy();
            app = null;
            return;
          }
          appInstance.stage.sortableChildren = true;
          hostRef.current?.appendChild(appInstance.canvas);
          appRef.current = appInstance;
          const version = ++renderVersionRef.current;
          void drawPrims(
            appInstance,
            Graphics,
            Text,
            Sprite,
            Assets,
            primsRef.current,
            () => !disposed && version === renderVersionRef.current,
          );
        });
    });

    return () => {
      disposed = true;
      renderVersionRef.current += 1;
      app?.destroy();
      appRef.current = null;
      graphicsRef.current = null;
      textRef.current = null;
      spriteRef.current = null;
      assetsRef.current = null;
    };
  }, [width, height]);

  // 订阅真实引擎事件（prim / done / error）
  useEffect(() => {
    const client = clientRef.current!;
    const offEvent = client.subscribe((ev) => {
      applyEvents([ev]);
    });
    const offExit = client.subscribeExit(() => {
      engineReadyRef.current = false;
      setEngineMode('error');
      setEngineError('真实引擎进程已退出，已回退演示引擎');
    });
    return () => {
      offEvent();
      offExit();
    };
  }, [applyEvents]);

  // 文档/资源变化 → 重算投影队列 + 重绘回退 prim（同步，轻量）+ 真实引擎重载（防抖）。
  useEffect(() => {
    const script: FakeScript = buildPreviewScript(state.document, state.header, state.resources);
    textsRef.current = script.texts;
    cursorRef.current = 0;
    primsRef.current = script.prims ?? [];
    setText(null);
    setChoices(null);
    setDone(false);
    setEngineError(null);
    setAudioHint(null);

    const app = appRef.current;
    const Graphics = graphicsRef.current;
    const Text = textRef.current;
    const Sprite = spriteRef.current;
    const Assets = assetsRef.current;
    if (app && Graphics && Text && Sprite && Assets) {
      const version = ++renderVersionRef.current;
      void drawPrims(
        app,
        Graphics,
        Text,
        Sprite,
        Assets,
        primsRef.current,
        () => version === renderVersionRef.current,
      );
    }

    // 真实引擎重载防抖：连线/拖动会高频触发 state 变化，
    // 若每次立即走「5MB 解码 + 编译 + boot」会明显卡顿，改为暂停 500ms 后再跑。
    const timer = setTimeout(() => {
      const client = clientRef.current!;
      engineReadyRef.current = false;
      if (!client.supported) {
        setEngineMode('fake');
        return;
      }
      const hasContent = state.document.nodes.some(
        (n) => n.id !== state.document.startNodeId && n.node.kind !== 'label',
      );
      if (!hasContent) {
        setEngineMode('fake');
        return;
      }
      // 真实引擎（无头 VM）对依赖底座库函数调用者栈帧的演出块无法正确执行：
      // selset 的 sel_* / msgset 的 f_000349f1 会用 push_stack 负偏移读调用者局部变量，
      // 而编辑器的平铺脚本无该栈帧 → 栈溢出 / 越界。出现这些节点时回退演示引擎。
      const hasUnsupported = state.document.nodes.some(
        (n) =>
          n.id !== state.document.startNodeId && (n.node.kind === 'selset' || n.node.kind === 'msgset'),
      );
      if (hasUnsupported) {
        setEngineMode('fake');
        return;
      }
      setEngineMode('real');
      void loadBaseBinary(state.header.game)
        .then((baseData) => {
          const { bytes, scriptEntry, labels } = compileEditorStateDetailed(state, baseData);
          return client.load(bytes, state.header.nls, scriptEntry, labels);
        })
        .then(() => {
          engineReadyRef.current = true;
          setEngineMode('real');
          setEngineError(null);
        })
        .catch((err: unknown) => {
          engineReadyRef.current = false;
          setEngineMode('error');
          setEngineError(err instanceof Error ? err.message : String(err));
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [state.document, state.header, state.resources]);

  const advance = useCallback(() => {
    const client = clientRef.current!;
    if (client.supported && engineReadyRef.current) {
      void client.advance();
    }
    if (cursorRef.current < textsRef.current.length) {
      const next = textsRef.current[cursorRef.current]!;
      cursorRef.current += 1;
      setText(next.text);
      setChoices(next.choices ?? null);
      setDone(false);
      if (next.audioSrc) {
        const audio = new Audio(assetUrl(next.audioSrc) ?? next.audioSrc);
        void audio.play().catch(() => {});
      }
    } else {
      setDone(true);
    }
  }, []);

  const labels = state.document.nodes.filter((n) => n.node.kind === 'label');

  return (
    <div className="preview">
      {engineError && <div className="preview__engine-error">{engineError}</div>}
      <div className="preview__stage" ref={hostRef} onClick={advance}>
        <div className="preview__stage-hint">{text === null && !done ? '点击推进' : ''}</div>
      </div>
      <div className="preview__textbox">
        {done ? '（完）' : text ?? ''}
        {audioHint && <span className="preview__audio-hint">{audioHint}</span>}
      </div>
      {choices !== null && choices.length > 0 && (
        <div className="preview__choices">
          {choices.map((c, i) => (
            <button type="button" className="preview__choice" key={i} onClick={advance}>
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="preview__labels">
        <div className="preview__globals-title">label 断点</div>
        {labels.length === 0 ? (
          <div className="preview__globals-empty">无</div>
        ) : (
          labels.map((n) => (
            <button
              type="button"
              className="preview__label"
              key={n.id}
              onClick={() => {
                onLocate?.(n.id);
                if (clientRef.current?.supported && engineReadyRef.current && n.node.kind === 'label') {
                  void clientRef.current.jump(n.node.name);
                }
              }}
            >
              {n.node.kind === 'label' ? n.node.name : n.id}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
