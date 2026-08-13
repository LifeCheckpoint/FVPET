/**
 * 预览面板：Pixi 自绘 prim + 文本覆盖 + G[] 面板 + 点击推进。
 *
 * 文本队列由编辑器投影（buildPreviewScript）提供；prim 有两级来源：
 *   1. 真实引擎（Electron 下经 window.rfvp 桥 → rfvp-cli）执行编译产物，
 *      回放 draw_solid 矩形作为 prim；缺桥 / 编译失败时回退。
 *   2. 回退：FakeScript.prims 的占位矩形（标注角色名）。
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
type TextureCtor = PixiModule['Texture'];

function drawPrims(
  app: AppInstance,
  Graphics: GraphicsCtor,
  Text: TextCtor,
  Sprite: SpriteCtor,
  Texture: TextureCtor,
  prims: readonly FakePrim[],
): void {
  app.stage.removeChildren().forEach((child) => child.destroy());
  for (const prim of prims) {
    const w = prim.fullscreen ? app.screen.width : prim.w && prim.w > 0 ? prim.w : PRIM_W;
    const h = prim.fullscreen ? app.screen.height : prim.h && prim.h > 0 ? prim.h : PRIM_H;
    if (prim.image) {
      const sprite = new Sprite(Texture.from(prim.image));
      sprite.width = w;
      sprite.height = h;
      sprite.x = prim.x;
      sprite.y = prim.y;
      sprite.zIndex = prim.z;
      sprite.alpha = prim.alpha;
      sprite.scale.set(prim.scale);
      sprite.angle = prim.rotate;
      app.stage.addChild(sprite);

      if (prim.face) {
        const sx = prim.face.bodyWidth > 0 ? w / prim.face.bodyWidth : 1;
        const sy = prim.face.bodyHeight > 0 ? h / prim.face.bodyHeight : 1;
        const face = new Sprite(Texture.from(prim.face.image));
        face.width = Math.max(1, prim.face.width * sx);
        face.height = Math.max(1, prim.face.height * sy);
        face.x = prim.x + prim.face.x * sx;
        face.y = prim.y + prim.face.y * sy;
        face.zIndex = prim.z + 0.5;
        face.alpha = prim.alpha;
        face.scale.set(prim.scale);
        face.angle = prim.rotate;
        app.stage.addChild(face);
      }
    } else {
      const g = new Graphics();
      g.roundRect(prim.x, prim.y, w, h, 6);
      g.fill({ color: PRIM_COLOR, alpha: prim.alpha });
      g.stroke({ color: 0x5b6b84, width: 1, alpha: prim.alpha });
      g.zIndex = prim.z;
      g.scale.set(prim.scale);
      g.angle = prim.rotate;
      app.stage.addChild(g);
    }

    if (prim.label) {
      const label = new Text({
        text: prim.label,
        style: { fontSize: 13, fill: 0xc4ccd6, fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
      });
      label.anchor.set(0.5, 0);
      label.x = prim.x + w / 2;
      label.y = prim.y + h + 8;
      label.zIndex = prim.z;
      app.stage.addChild(label);
    }
  }
}

export interface PreviewPanelProps {
  readonly state: EditorState;
  readonly ratio: PreviewRatio;
  readonly onLocate?: (nodeId: string) => void;
}

type EngineMode = 'fake' | 'real' | 'error';

const ENGINE_LABEL: Record<EngineMode, string> = {
  fake: '演示引擎',
  real: '真实引擎',
  error: '引擎错误（回退演示）',
};

export function PreviewPanel({ state, ratio, onLocate }: PreviewPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<AppInstance | null>(null);
  const graphicsRef = useRef<GraphicsCtor | null>(null);
  const textRef = useRef<TextCtor | null>(null);
  const spriteRef = useRef<SpriteCtor | null>(null);
  const textureRef = useRef<TextureCtor | null>(null);
  const primsRef = useRef<readonly FakePrim[]>([]);

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
  const [globals, setGlobals] = useState<Readonly<Record<number, unknown>>>({});
  const [engineMode, setEngineMode] = useState<EngineMode>(() =>
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
        // 真实引擎降级（tick 失败 / 进程退出）后，引擎的 done/prims 不可信，
        // 文本与回退 prim 改由投影队列驱动，故这里忽略引擎的终局与图元事件。
        case 'done':
          if (engineReadyRef.current) {
            setDone(true);
          }
          break;
        case 'g':
          setGlobals((prev) => ({ ...prev, [ev.index]: ev.value }));
          break;
        case 'audio':
          setAudioHint(
            `${ev.action === 'play' ? '播放' : ev.action === 'stop' ? '停止' : '加载'}音频 slot ${ev.channel}`,
          );
          break;
        case 'prims': {
          if (!engineReadyRef.current) {
            break;
          }
          primsRef.current = ev.prims;
          const app = appRef.current;
          const Graphics = graphicsRef.current;
          const Text = textRef.current;
          const Sprite = spriteRef.current;
          const Texture = textureRef.current;
          if (app && Graphics && Text && Sprite && Texture) {
            drawPrims(app, Graphics, Text, Sprite, Texture, ev.prims);
          }
          break;
        }
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

    loadPixi().then(({ Application, Graphics, Text, Sprite, Texture }) => {
      if (disposed) {
        return;
      }
      graphicsRef.current = Graphics;
      textRef.current = Text;
      spriteRef.current = Sprite;
      textureRef.current = Texture;
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
          drawPrims(appInstance, Graphics, Text, Sprite, Texture, primsRef.current);
        });
    });

    return () => {
      disposed = true;
      app?.destroy();
      appRef.current = null;
      graphicsRef.current = null;
      textRef.current = null;
      spriteRef.current = null;
      textureRef.current = null;
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
    setGlobals({});
    setEngineError(null);
    setAudioHint(null);

    const app = appRef.current;
    const Graphics = graphicsRef.current;
    const Text = textRef.current;
    const Sprite = spriteRef.current;
    const Texture = textureRef.current;
    if (app && Graphics && Text && Sprite && Texture) {
      drawPrims(app, Graphics, Text, Sprite, Texture, primsRef.current);
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
          const { bytes, labels } = compileEditorStateDetailed(state, baseData);
          return client.load(bytes, state.header.nls, labels);
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
        const audio = new Audio(next.audioSrc);
        void audio.play().catch(() => {});
      }
    } else {
      setDone(true);
    }
  }, []);

  const skip = useCallback(() => {
    const client = clientRef.current!;
    if (client.supported && engineReadyRef.current) {
      void client.skip();
    }
    cursorRef.current = textsRef.current.length;
    setText(null);
    setChoices(null);
    setDone(true);
  }, []);

  const labels = state.document.nodes.filter((n) => n.node.kind === 'label');

  return (
    <div className="preview">
      <div className="preview__toolbar">
        <button type="button" className="topbar-btn" onClick={skip}>跳过</button>
        <span className={`preview__engine preview__engine--${engineMode}`}>{ENGINE_LABEL[engineMode]}</span>
        <span className="preview__toolbar-hint">点击画面推进</span>
      </div>
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
      <div className="preview__globals">
        <div className="preview__globals-title">G[]</div>
        {Object.entries(globals).length === 0 ? (
          <div className="preview__globals-empty">空</div>
        ) : (
          Object.entries(globals).map(([index, value]) => (
            <div className="preview__global" key={index}>
              <span className="preview__global-index">G[{index}]</span>
              <span className="preview__global-value">{String(value)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
