/**
 * 预览面板：canvas 直显真实引擎（rfvp-cli full 引擎）回传的 RGBA 帧 + 文本覆盖 + 点击推进。
 *
 * 文本队列由编辑器投影（buildPreviewScript）提供，用于本地推进文本游标（文本 UI 的
 * 引擎接管属 Phase 2）；场景画面完全由引擎 `frame` 事件驱动：把 base64 解码成 RGBA
 * 字节，1:1 写入 canvas，再由 CSS 按 `.preview__stage` 宽度等比缩放（不拉伸）。
 *
 * 缺桥（浏览器 / Storybook / Playwright）→ fake 模式（仅文本，canvas 空白）；
 * 编译 / 装载 / tick 失败 → error 模式。真实引擎就绪时点击推进会额外调用
 * client.advance()（引擎回传下一个 frame）。
 *
 * 预览保持游戏原始比例（4:3 / 16:9），画布自适应右栏宽度，不拉伸溢出。
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

/** 集中收集 prim 引用的图片 URL，异步装载并隔离单资源失败（供测试 / 未来复用）。 */
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
        // 单一资源损坏不阻断整个舞台。
      }
    }),
  );
  return textures;
}

export interface PreviewPanelProps {
  readonly state: EditorState;
  readonly ratio: PreviewRatio;
  readonly resourceRoot?: string;
  readonly onLocate?: (nodeId: string) => void;
}

type EngineMode = 'fake' | 'real' | 'error';

export function PreviewPanel({ state, ratio, resourceRoot, onLocate }: PreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 引擎帧到达前的 canvas 初始尺寸：保持游戏原始比例（4:3 / 16:9），帧到达后按帧尺寸覆写。
  const [defaultWidth, defaultHeight] = ratio === '16:9' ? [640, 360] : [640, 480];

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
        // full 引擎回传的完整 RGBA 帧：base64 解码后 1:1 写入 canvas。
        case 'frame': {
          const canvas = canvasRef.current;
          if (!canvas) {
            break;
          }
          const bytes = Uint8Array.from(atob(ev.data), (c) => c.charCodeAt(0));
          const expected = ev.width * ev.height * 4;
          if (bytes.length < expected) {
            break;
          }
          if (canvas.width !== ev.width || canvas.height !== ev.height) {
            canvas.width = ev.width;
            canvas.height = ev.height;
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            break;
          }
          const imageData = new ImageData(
            new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, expected),
            ev.width,
            ev.height,
          );
          ctx.putImageData(imageData, 0, 0);
          break;
        }
        // 无头 portable 引擎补的 prims 是系统 UI 矩形，不再参与渲染（场景画面由 frame 驱动）。
        case 'prims':
          break;
        case 'error':
          engineReadyRef.current = false;
          setEngineMode('error');
          setEngineError(
            ev.message.includes('tick failed')
              ? '真实引擎执行失败，已回退演示引擎'
              : ev.message,
          );
          break;
        default:
          break;
      }
    }
  }, []);

  // 订阅真实引擎事件（frame / done / error）
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

  // 文档 / 资源 / 资源根目录变化 → 重算投影文本队列 + 真实引擎重载（防抖）。
  useEffect(() => {
    const script: FakeScript = buildPreviewScript(state.document, state.header, state.resources);
    textsRef.current = script.texts;
    cursorRef.current = 0;
    setText(null);
    setChoices(null);
    setDone(false);
    setEngineError(null);
    setAudioHint(null);

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
      setEngineMode('real');
      void loadBaseBinary(state.header.game)
        .then((baseData) => {
          const { bytes, scriptEntry, labels } = compileEditorStateDetailed(state, baseData);
          return client.load(bytes, state.header.nls, scriptEntry, labels, resourceRoot);
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
  }, [state.document, state.header, state.resources, resourceRoot]);

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
      <div className="preview__stage" onClick={advance}>
        <canvas ref={canvasRef} width={defaultWidth} height={defaultHeight} />
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
