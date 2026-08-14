/**
 * 预览面板：canvas 直显真实引擎（rfvp-cli full 引擎）回传的 RGBA 帧 + 文本覆盖 + 点击推进。
 *
 * 点击转发：把舞台 canvas 上的点击坐标反算回引擎虚拟分辨率（用引擎帧实际宽高，按
 * event_handler 同款 letterbox 公式），再发 `client.input({ kind: 'pointer_up', ... })`，
 * 让真实引擎自己推进剧情并响应 selset 选项。
 *
 * 文本 UI 说明：Phase 2 实测发现 headless 引擎帧为纯色（`input-smoke` 验证
 * perFrameDistinct=[1,1,1,1]，即 msgset+dia 也未在帧内绘制消息窗口/文字），因此文本与
 * 选项仍由编辑器投影（buildPreviewScript）驱动，HTML textbox/choices 覆盖层保留。
 *
 * 缺桥（浏览器 / Storybook / Playwright）→ fake 模式（仅文本，canvas 空白）；
 * 编译 / 装载 / tick 失败 → error 模式。
 *
 * 预览保持游戏原始比例（4:3 / 16:9），画布自适应右栏宽度，不拉伸溢出。
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
  /** 最近一帧引擎帧的虚拟分辨率（点击坐标反算的基准）。 */
  const frameSizeRef = useRef<{ readonly width: number; readonly height: number } | null>(null);
  /** 已收到真实引擎 RGBA frame（引擎帧内含文本框/文字/选项）。 */
  const frameReceivedRef = useRef(false);

  const [text, setText] = useState<string | null>(null);
  const [choices, setChoices] = useState<readonly string[] | null>(null);
  const [done, setDone] = useState(false);
  /** 驱动 React 重渲染：真实引擎出帧后隐藏 HTML 文本/选项覆盖层。 */
  const [frameReceived, setFrameReceived] = useState(false);
  const [, setEngineMode] = useState<EngineMode>(() =>
    clientRef.current!.supported ? 'real' : 'fake',
  );
  const [engineError, setEngineError] = useState<string | null>(null);
  const [audioHint, setAudioHint] = useState<string | null>(null);

  // position 事件 → 节点定位：onLocate 以 ref 保持最新（applyEvents 为空依赖闭包）。
  const onLocateRef = useRef(onLocate);
  onLocateRef.current = onLocate;
  /** 全部节点 id → 编译后绝对地址（position 事件反查当前执行到的精确节点）。 */
  const nodeAddrByIdRef = useRef<ReadonlyMap<string, number>>(new Map());
  const lastLocatedNodeIdRef = useRef<string | null>(null);

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
        // 引擎执行位置：反查「不超过 pc 的最大节点地址」→ 对应节点 → 精确高亮定位。
        case 'position': {
          let bestAddr = -1;
          let bestNodeId: string | null = null;
          for (const [nodeId, addr] of nodeAddrByIdRef.current) {
            if (addr <= ev.pc && addr > bestAddr) {
              bestAddr = addr;
              bestNodeId = nodeId;
            }
          }
          if (bestNodeId !== null && lastLocatedNodeIdRef.current !== bestNodeId) {
            lastLocatedNodeIdRef.current = bestNodeId;
            onLocateRef.current?.(bestNodeId);
          }
          break;
        }
        // full 引擎回传的完整 RGBA 帧：二进制通道（Uint8Array）零拷贝建 ImageData 写入 canvas。
        case 'frame': {
          const canvas = canvasRef.current;
          if (!canvas) {
            break;
          }
          const data = ev.data;
          const expected = ev.width * ev.height * 4;
          if (data.length < expected) {
            break;
          }
          if (canvas.width !== ev.width || canvas.height !== ev.height) {
            canvas.width = ev.width;
            canvas.height = ev.height;
          }
          frameSizeRef.current = { width: ev.width, height: ev.height };
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            break;
          }
          const imageData = new ImageData(
            new Uint8ClampedArray(data.buffer, data.byteOffset, expected),
            ev.width,
            ev.height,
          );
          ctx.putImageData(imageData, 0, 0);
          frameReceivedRef.current = true;
          setFrameReceived(true);
          break;
        }
        // 无头 portable 引擎补的 prims 是系统 UI 矩形，不再参与渲染（场景画面由 frame 驱动）。
        case 'prims':
          break;
        case 'error':
          engineReadyRef.current = false;
          frameReceivedRef.current = false;
          setFrameReceived(false);
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
      frameReceivedRef.current = false;
      setFrameReceived(false);
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

    // 重置位置映射（编译结果异步到达前先清空，避免旧映射残留）。
    nodeAddrByIdRef.current = new Map();
    lastLocatedNodeIdRef.current = null;

    // 真实引擎重载防抖：连线/拖动会高频触发 state 变化，
    // 若每次立即走「5MB 解码 + 编译 + boot」会明显卡顿，改为暂停 500ms 后再跑。
    const timer = setTimeout(() => {
      const client = clientRef.current!;
      engineReadyRef.current = false;
      frameSizeRef.current = null;
      frameReceivedRef.current = false;
      setFrameReceived(false);
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
          const { bytes, scriptEntry, labels, nodeAddrs } = compileEditorStateDetailed(state, baseData);
          nodeAddrByIdRef.current = new Map(Object.entries(nodeAddrs));
          return client.load(bytes, state.header.nls, scriptEntry, labels, resourceRoot);
        })
        .then((loaded) => {
          if (loaded?.screenSize) {
            frameSizeRef.current = {
              width: loaded.screenSize[0],
              height: loaded.screenSize[1],
            };
          }
          engineReadyRef.current = true;
          setEngineMode('real');
          setEngineError(null);
        })
        .catch((err: unknown) => {
          engineReadyRef.current = false;
          frameReceivedRef.current = false;
          setFrameReceived(false);
          setEngineMode('error');
          setEngineError(err instanceof Error ? err.message : String(err));
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [state.document, state.header, state.resources, resourceRoot]);

  /** 本地投影游标推进（文本/选项仍由投影驱动；引擎帧已验证不含文字）。 */
  const advanceProjection = useCallback(() => {
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

  /**
   * 无坐标推进入口（selset 选择按钮）。
   * 真实引擎模式只转发 advance（引擎自己推进文本）；fake/降级模式走本地投影游标。
   */
  const advance = useCallback(() => {
    const client = clientRef.current!;
    if (client.supported && engineReadyRef.current) {
      void client.advance();
      return;
    }
    advanceProjection();
  }, [advanceProjection]);

  /**
   * 舞台坐标反算：canvas 显示尺寸 → 引擎虚拟分辨率（event_handler 同款 letterbox 公式）。
   * 帧尺寸未就绪时返回 null。
   */
  const mapStageToVirtual = useCallback(
    (clientX: number, clientY: number): { readonly x: number; readonly y: number } | null => {
      const frame = frameSizeRef.current;
      const canvas = canvasRef.current;
      if (!frame || !canvas) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const vw = frame.width;
      const vh = frame.height;

      // event_handler 同款 letterbox 反算：scale = min(cw/vw, ch/vh)。
      const scale = Math.min(cw / vw, ch / vh);
      const offX = (cw - vw * scale) / 2;
      const offY = (ch - vh * scale) / 2;

      let vx = (clientX - rect.left - offX) / scale;
      let vy = (clientY - rect.top - offY) / scale;
      vx = Math.max(0, Math.min(vw - 1, vx));
      vy = Math.max(0, Math.min(vh - 1, vy));
      return { x: Math.round(vx), y: Math.round(vy) };
    },
    [],
  );

  /** mousemove → pointer_move（rAF 节流），引擎据此更新光标 / 悬停高亮。 */
  const movePendingRef = useRef(false);
  const pendingMoveRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const flushMove = useCallback(() => {
    movePendingRef.current = false;
    const p = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (p) {
      void clientRef.current!.input({ kind: 'pointer_move', x: p.x, y: p.y });
    }
  }, []);

  const handleStageMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const client = clientRef.current!;
      if (!(client.supported && engineReadyRef.current)) {
        return;
      }
      const p = mapStageToVirtual(event.clientX, event.clientY);
      if (!p) {
        return;
      }
      pendingMoveRef.current = p;
      if (!movePendingRef.current) {
        movePendingRef.current = true;
        requestAnimationFrame(flushMove);
      }
    },
    [mapStageToVirtual, flushMove],
  );

  /** mousedown → pointer_down：真实引擎按下沿推进 / 命中 selset 选项。 */
  const handleStageDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const client = clientRef.current!;
      if (client.supported && engineReadyRef.current) {
        const p = mapStageToVirtual(event.clientX, event.clientY);
        if (p) {
          void client.input({ kind: 'pointer_down', x: p.x, y: p.y });
        }
        return;
      }
      // fake / 降级模式：down 不推进，交给 up 统一推进（避免一次点击双推进）。
    },
    [mapStageToVirtual],
  );

  /** mouseup → pointer_up：真实引擎响应抬起；fake / 降级模式走本地投影游标推进。 */
  const handleStageUp = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const client = clientRef.current!;
      if (client.supported && engineReadyRef.current) {
        const p = mapStageToVirtual(event.clientX, event.clientY);
        if (p) {
          void client.input({ kind: 'pointer_up', x: p.x, y: p.y });
        } else {
          // 帧尺寸尚未就绪（首帧未到）时退回合成点击。
          void client.advance();
        }
        return;
      }
      advanceProjection();
    },
    [mapStageToVirtual, advanceProjection],
  );

  const labels = state.document.nodes.filter((n) => n.node.kind === 'label');

  // 真实引擎已出帧 → 引擎帧内含文本框 / 文字 / 选项，隐藏编辑器 HTML 覆盖层；
  // 无桥 fake 模式 / 引擎未就绪 → 保留投影驱动的 HTML 覆盖层兜底。
  const hideEngineOverlay =
    clientRef.current!.supported && engineReadyRef.current && frameReceived;

  return (
    <div className="preview">
      {engineError && <div className="preview__engine-error">{engineError}</div>}
      <div
        className="preview__stage"
        onMouseDown={handleStageDown}
        onMouseUp={handleStageUp}
        onMouseMove={handleStageMove}
      >
        <canvas ref={canvasRef} width={defaultWidth} height={defaultHeight} />
        {!hideEngineOverlay && (
          <div className="preview__stage-hint">{text === null && !done ? '点击推进' : ''}</div>
        )}
      </div>
      {!hideEngineOverlay && (
        <div className="preview__textbox">
          {done ? '（完）' : text ?? ''}
          {audioHint && <span className="preview__audio-hint">{audioHint}</span>}
        </div>
      )}
      {!hideEngineOverlay && choices !== null && choices.length > 0 && (
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
