/**
 * RfvpProcessManager：Electron 主进程侧的 rfvp-cli 子进程管理。
 *
 * - 惰性拉起 rfvp-cli 二进制（dev 用 crates/rfvp-cli/target/debug，可用 HCB_RFVP_CLI 覆盖）。
 * - stdin 写行分隔 JSON 请求，stdout 按行解析 JSON 事件，stderr 透传日志。
 * - load(bytes, nls)：先把编译产物落盘为临时 .hcb，再发 load 请求，并等待对应
 *   ready / error 事件（串行单会话，因此无需 correlation id）。
 * - 事件与退出通过订阅器转发（主进程再广播到渲染层）。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface RfvpLoadResult {
  readonly title: string | null;
  readonly screenSize: readonly [number, number] | null;
}

/** 主进程只关心事件 type 做 load 关联与转发，完整 schema 校验交给渲染层 zod。 */
type RawEvent = Record<string, unknown>;

/** 与 [`protocol.ts`](hcb-editor/packages/rfvp/src/protocol.ts:8) 保持一致。 */
const PROTOCOL_VERSION = 2;
const LOAD_TIMEOUT_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

function resolveBinaryPath(): string {
  const override = process.env.HCB_RFVP_CLI;
  if (override && override.trim() !== '') {
    return override;
  }
  const exe = process.platform === 'win32' ? 'rfvp-cli.exe' : 'rfvp-cli';
  // dist/ → desktop → apps → packages → hcb-editor
  return path.resolve(__dirname, '..', '..', '..', '..', 'crates', 'rfvp-cli', 'target', 'debug', exe);
}

export class RfvpProcessManager {
  private readonly binaryPath = resolveBinaryPath();

  /** 帧消息（kind 1）长度上限：1280*720*4 + 8 头 ≈ 3.7MB，给足余量到 256MB 防失步。 */
  private static readonly MAX_MSG_LEN = 256 * 1024 * 1024;

  private child: ChildProcessWithoutNullStreams | null = null;
  /** stdout 二进制流缓冲（长度前缀消息，跨 chunk 累积）。 */
  private stdoutChunks: Buffer[] = [];
  private stdoutLen = 0;
  private readonly eventHandlers = new Set<(event: RawEvent) => void>();
  private readonly exitHandlers = new Set<(code: number | null) => void>();
  /** 主动 shutdown 时置位，避免把正常退出误判为崩溃。 */
  private shuttingDown = false;

  private tempDir: string | null = null;
  private loadWaiter: {
    readonly resolve: (result: RfvpLoadResult) => void;
    readonly reject: (error: Error) => void;
  } | null = null;
  private loadTimeout: NodeJS.Timeout | null = null;
  private handshakeWaiter: {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  } | null = null;
  private handshakeTimeout: NodeJS.Timeout | null = null;

  /** 确保子进程已启动并完成 handshake（幂等）。二进制缺失或协议不匹配时抛错。 */
  async start(): Promise<void> {
    if (this.child) {
      return;
    }
    if (!fs.existsSync(this.binaryPath)) {
      throw new Error(`rfvp-cli 二进制不存在：${this.binaryPath}（先 cargo build -p rfvp-cli，或用 HCB_RFVP_CLI 指定）`);
    }

    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;

    // stdout 是长度前缀的二进制消息流（kind 0 = JSON 事件，kind 1 = RGBA 帧），
    // 不再使用 readline 按行解析 JSON。
    child.stdout.on('data', (chunk: Buffer) => {
      this.appendStdout(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[rfvp-cli] ${chunk.toString()}`);
    });

    child.on('error', (err) => {
      this.broadcastEvent({ type: 'error', message: `rfvp-cli 启动失败：${err.message}` });
    });

    child.on('exit', (code) => {
      this.child = null;
      this.clearLoadWaiter(new Error('引擎进程已退出'));
      this.clearHandshakeWaiter(new Error('引擎进程已退出'));
      if (!this.shuttingDown) {
        this.broadcastEvent({ type: 'error', message: '真实引擎进程异常退出，已自动回退演示引擎；下次编辑将自动重启引擎' });
      }
      this.shuttingDown = false;
      for (const handler of this.exitHandlers) {
        handler(code);
      }
    });

    // 握手：校验 protocolVersion，失败则杀掉进程并抛错（下次 load 会重新拉起）。
    const handshake = new Promise<void>((resolve, reject) => {
      this.handshakeWaiter = { resolve, reject };
      this.handshakeTimeout = setTimeout(() => {
        this.clearHandshakeWaiter(new Error('引擎握手超时（protocolVersion 未确认）'));
      }, HANDSHAKE_TIMEOUT_MS);
    });
    this.send({ op: 'handshake', protocolVersion: PROTOCOL_VERSION });
    return handshake;
  }

  async load(
    bytes: Uint8Array,
    nls: string,
    scriptEntry: number,
    labels?: Readonly<Record<string, number>>,
    resourceRoot?: string,
  ): Promise<RfvpLoadResult> {
    await this.start();
    const child = this.child;
    if (!child) {
      throw new Error('rfvp-cli 未就绪');
    }

    const file = this.writeTempHcb(bytes);
    return new Promise<RfvpLoadResult>((resolve, reject) => {
      this.clearLoadWaiter(null);
      this.loadWaiter = { resolve, reject };
      this.loadTimeout = setTimeout(() => {
        this.clearLoadWaiter(new Error('引擎装载超时'));
      }, LOAD_TIMEOUT_MS);

      this.send({
        op: 'load',
        hcbPath: file,
        nls,
        scriptEntry,
        labels: labels ?? {},
        engine: 'full',
        resourceRoot: resourceRoot ?? '',
      });
    });
  }

  jump(label: string): void {
    this.send({ op: 'jump', label });
  }

  advance(): void {
    this.send({ op: 'advance' });
  }

  input(event: { kind: string; x: number; y: number }): void {
    this.send({ op: 'input', event });
  }

  step(): void {
    this.send({ op: 'step' });
  }

  skip(): void {
    this.send({ op: 'skip' });
  }

  dumpPrims(): void {
    this.send({ op: 'dump_prims' });
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.send({ op: 'shutdown' });
  }

  onEvent(handler: (event: RawEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  onExit(handler: (code: number | null) => void): () => void {
    this.exitHandlers.add(handler);
    return () => {
      this.exitHandlers.delete(handler);
    };
  }

  /** 应用退出时：终止子进程并清理临时文件。 */
  dispose(): void {
    this.shuttingDown = true;
    this.clearLoadWaiter(new Error('引擎已关闭'));
    this.clearHandshakeWaiter(new Error('引擎已关闭'));
    this.child?.kill();
    this.child = null;
    if (this.tempDir) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
      this.tempDir = null;
    }
  }

  private send(request: Record<string, unknown>): void {
    const child = this.child;
    if (!child) {
      throw new Error('rfvp-cli 未启动');
    }
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }

  private appendStdout(chunk: Buffer): void {
    this.stdoutChunks.push(chunk);
    this.stdoutLen += chunk.length;
    this.drainStdout();
  }

  /** 解析并消费 stdout 二进制消息：`[u32 LE len][u8 kind][payload]`。 */
  private drainStdout(): void {
    const HEADER = 5;
    while (this.stdoutLen >= HEADER) {
      const head = this.peekBytes(HEADER);
      if (!head) {
        return;
      }
      const len = head.readUInt32LE(0);
      if (len < 1 || len > RfvpProcessManager.MAX_MSG_LEN) {
        // 协议失步（不应发生）：丢弃缓冲，等待重新同步。
        this.stdoutChunks = [];
        this.stdoutLen = 0;
        return;
      }
      if (this.stdoutLen < 4 + len) {
        return;
      }
      const msg = this.takeBytes(4 + len);
      if (!msg) {
        return;
      }
      const kind = msg[4];
      const payload = msg.subarray(5);
      if (kind === 0) {
        this.handleLine(payload.toString('utf8'));
      } else if (kind === 1) {
        this.handleFrame(payload);
      }
    }
  }

  /** 读取前 n 字节视图（不消费）。 */
  private peekBytes(n: number): Buffer | null {
    if (this.stdoutLen < n || this.stdoutChunks.length === 0) {
      return null;
    }
    const first = this.stdoutChunks[0]!;
    if (first.length >= n) {
      return first.subarray(0, n);
    }
    const out = Buffer.allocUnsafe(n);
    let remaining = n;
    let i = 0;
    while (remaining > 0) {
      const head = this.stdoutChunks[i]!;
      const take = Math.min(head.length, remaining);
      head.copy(out, n - remaining, 0, take);
      remaining -= take;
      i += 1;
    }
    return out;
  }

  /** 消费并返回前 n 字节（拷贝，脱离 chunk 记账）。 */
  private takeBytes(n: number): Buffer | null {
    if (this.stdoutLen < n) {
      return null;
    }
    const out = Buffer.allocUnsafe(n);
    let remaining = n;
    while (remaining > 0) {
      const head = this.stdoutChunks[0]!;
      const take = Math.min(head.length, remaining);
      head.copy(out, n - remaining, 0, take);
      remaining -= take;
      this.consumeStdout(take);
    }
    return out;
  }

  private consumeStdout(n: number): void {
    this.stdoutLen -= n;
    while (n > 0 && this.stdoutChunks.length > 0) {
      const head = this.stdoutChunks[0]!;
      if (head.length <= n) {
        n -= head.length;
        this.stdoutChunks.shift();
      } else {
        this.stdoutChunks[0] = head.subarray(n);
        n = 0;
      }
    }
  }

  /** kind 1：`[u32 width][u32 height][width*height*4 RGBA]` → frame 事件（Buffer）。 */
  private handleFrame(payload: Buffer): void {
    if (payload.length < 8) {
      return;
    }
    const width = payload.readUInt32LE(0);
    const height = payload.readUInt32LE(4);
    const data = payload.subarray(8);
    this.broadcastEvent({ type: 'frame', width, height, format: 'rgba8', data });
  }

  private handleLine(line: string): void {
    if (line.trim() === '') {
      return;
    }
    let event: RawEvent;
    try {
      event = JSON.parse(line) as RawEvent;
    } catch {
      return;
    }

    // handshake 响应 = 无 title 的 ready（load 的 ready 必带 title），只做版本校验、不广播。
    if (event.type === 'ready' && !('title' in event)) {
      this.resolveHandshakeWaiter(event);
      return;
    }

    if (this.loadWaiter) {
      if (event.type === 'ready') {
        this.resolveLoadWaiter(event);
      } else if (event.type === 'error') {
        const message = typeof event.message === 'string' ? event.message : '引擎装载失败';
        this.clearLoadWaiter(new Error(message));
      }
    }

    this.broadcastEvent(event);
  }

  private resolveHandshakeWaiter(event: RawEvent): void {
    const waiter = this.handshakeWaiter;
    if (!waiter) {
      return;
    }
    if (event.protocolVersion !== PROTOCOL_VERSION) {
      this.clearHandshakeWaiter(
        new Error(`协议版本不匹配：引擎 ${String(event.protocolVersion)}，编辑器 ${PROTOCOL_VERSION}`),
      );
      return;
    }
    this.clearHandshakeWaiter(null);
    waiter.resolve();
  }

  private clearHandshakeWaiter(error: Error | null): void {
    const waiter = this.handshakeWaiter;
    this.handshakeWaiter = null;
    if (this.handshakeTimeout) {
      clearTimeout(this.handshakeTimeout);
      this.handshakeTimeout = null;
    }
    if (!waiter) {
      return;
    }
    if (error) {
      this.child?.kill();
      this.child = null;
      waiter.reject(error);
    } else {
      waiter.resolve();
    }
  }

  private resolveLoadWaiter(event: RawEvent): void {
    const waiter = this.loadWaiter;
    if (!waiter) {
      return;
    }
    this.clearLoadWaiter(null);
    const screen = event.screenSize;
    const screenSize: [number, number] | null =
      Array.isArray(screen) && screen.length >= 2
        ? [Number(screen[0]), Number(screen[1])]
        : null;
    waiter.resolve({
      title: typeof event.title === 'string' ? event.title : null,
      screenSize,
    });
  }

  private clearLoadWaiter(error: Error | null): void {
    const waiter = this.loadWaiter;
    this.loadWaiter = null;
    if (this.loadTimeout) {
      clearTimeout(this.loadTimeout);
      this.loadTimeout = null;
    }
    if (waiter && error) {
      waiter.reject(error);
    }
  }

  private broadcastEvent(event: RawEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  private writeTempHcb(bytes: Uint8Array): string {
    if (!this.tempDir) {
      this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcb-editor-'));
    }
    const file = path.join(this.tempDir, `script-${Date.now()}.hcb`);
    fs.writeFileSync(file, bytes);
    return file;
  }
}
