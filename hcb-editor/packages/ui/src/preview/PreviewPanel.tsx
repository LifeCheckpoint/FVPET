/**
 * 预览面板：Pixi 自绘 prim + 文本覆盖 + G[] 面板 + 点击推进。
 * 由 FakeEngine 驱动（buildPreviewScript 从当前文档生成脚本）。
 * 预览保持游戏原始比例（4:3 / 16:9），画布自适应右栏宽度，不拉伸溢出。
 * 立绘为占位矩形并标注角色名，作为「所见即所得」的轻量替代，真实 CG 由引擎回放补足。
 *
 * pixi 采用懒加载：仅在组件挂载（浏览器）时求值，避免 barrel import
 * 在 jsdom 测试环境触发 canvas 能力检测。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FakeEngine, type FakePrim, type FakeScript, type RfvpEvent } from '@hcb-editor/rfvp';
import type { EditorState } from '@hcb-editor/editor';
import { buildPreviewScript } from './buildPreviewScript.js';
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

function drawPrims(
  app: AppInstance,
  Graphics: GraphicsCtor,
  Text: TextCtor,
  prims: readonly FakePrim[],
): void {
  app.stage.removeChildren().forEach((child) => child.destroy());
  for (const prim of prims) {
    const g = new Graphics();
    g.roundRect(prim.x, prim.y, PRIM_W, PRIM_H, 6);
    g.fill({ color: PRIM_COLOR, alpha: prim.alpha });
    g.stroke({ color: 0x5b6b84, width: 1, alpha: prim.alpha });
    g.zIndex = prim.z;
    g.scale.set(prim.scale);
    g.angle = prim.rotate;
    app.stage.addChild(g);

    if (prim.label) {
      const label = new Text({
        text: prim.label,
        style: { fontSize: 13, fill: 0xc4ccd6, fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
      });
      label.anchor.set(0.5, 0);
      label.x = prim.x + PRIM_W / 2;
      label.y = prim.y + PRIM_H + 8;
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

export function PreviewPanel({ state, ratio, onLocate }: PreviewPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<AppInstance | null>(null);
  const graphicsRef = useRef<GraphicsCtor | null>(null);
  const textRef = useRef<TextCtor | null>(null);
  const primsRef = useRef<readonly FakePrim[]>([]);
  const engineRef = useRef<FakeEngine>(new FakeEngine());

  const [text, setText] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [globals, setGlobals] = useState<Readonly<Record<number, unknown>>>({});

  const [width, height] = ratio === '16:9' ? [640, 360] : [640, 480];

  // 初始化 / 销毁 Pixi（懒加载）
  useEffect(() => {
    let disposed = false;
    let app: AppInstance | null = null;

    loadPixi().then(({ Application, Graphics, Text }) => {
      if (disposed) {
        return;
      }
      graphicsRef.current = Graphics;
      textRef.current = Text;
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
          drawPrims(appInstance, Graphics, Text, primsRef.current);
        });
    });

    return () => {
      disposed = true;
      app?.destroy();
      appRef.current = null;
      graphicsRef.current = null;
      textRef.current = null;
    };
  }, [width, height]);

  // 文档变化 → 重载 FakeEngine 脚本并重绘 prim
  useEffect(() => {
    const script: FakeScript = buildPreviewScript(state.document, state.header);
    engineRef.current.load(script);
    primsRef.current = script.prims ?? [];
    setText(null);
    setDone(false);
    setGlobals({});
    const app = appRef.current;
    const Graphics = graphicsRef.current;
    const Text = textRef.current;
    if (app && Graphics && Text) {
      drawPrims(app, Graphics, Text, primsRef.current);
    }
  }, [state.document, state.header]);

  const applyEvents = useCallback((events: readonly RfvpEvent[]) => {
    for (const ev of events) {
      switch (ev.type) {
        case 'text':
          setText(ev.text);
          setDone(false);
          break;
        case 'done':
          setDone(true);
          break;
        case 'g':
          setGlobals((prev) => ({ ...prev, [ev.index]: ev.value }));
          break;
        case 'prims': {
          primsRef.current = ev.prims;
          const app = appRef.current;
          const Graphics = graphicsRef.current;
          const Text = textRef.current;
          if (app && Graphics && Text) {
            drawPrims(app, Graphics, Text, ev.prims);
          }
          break;
        }
        default:
          break;
      }
    }
  }, []);

  const advance = useCallback(() => {
    applyEvents(engineRef.current.advance());
  }, [applyEvents]);

  const skip = useCallback(() => {
    applyEvents(engineRef.current.skip());
  }, [applyEvents]);

  const labels = state.document.nodes.filter((n) => n.node.kind === 'label');

  return (
    <div className="preview">
      <div className="preview__toolbar">
        <button type="button" className="topbar-btn" onClick={skip}>跳过</button>
        <span className="preview__toolbar-hint">点击画面推进</span>
      </div>
      <div className="preview__stage" ref={hostRef} onClick={advance}>
        <div className="preview__stage-hint">{text === null && !done ? '点击推进' : ''}</div>
      </div>
      <div className="preview__textbox">
        {done ? '（完）' : text ?? ''}
      </div>
      <div className="preview__labels">
        <div className="preview__globals-title">label 断点</div>
        {labels.length === 0 ? (
          <div className="preview__globals-empty">无</div>
        ) : (
          labels.map((n) => (
            <button type="button" className="preview__label" key={n.id} onClick={() => onLocate?.(n.id)}>
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
