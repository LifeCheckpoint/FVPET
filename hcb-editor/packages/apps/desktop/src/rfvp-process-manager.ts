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
import * as readline from 'node:readline';

export interface RfvpLoadResult {
  readonly title: string | null;
  readonly screenSize: readonly [number, number] | null;
}

/** 主进程只关心事件 type 做 load 关联与转发，完整 schema 校验交给渲染层 zod。 */
type RawEvent = Record<string, unknown>;

const LOAD_TIMEOUT_MS = 15_000;

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

  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly eventHandlers = new Set<(event: RawEvent) => void>();
  private readonly exitHandlers = new Set<(code: number | null) => void>();

  private tempDir: string | null = null;
  private loadWaiter: {
    readonly resolve: (result: RfvpLoadResult) => void;
    readonly reject: (error: Error) => void;
  } | null = null;
  private loadTimeout: NodeJS.Timeout | null = null;

  /** 确保子进程已启动（幂等）。二进制缺失时抛错。 */
  start(): void {
    if (this.child) {
      return;
    }
    if (!fs.existsSync(this.binaryPath)) {
      throw new Error(`rfvp-cli 二进制不存在：${this.binaryPath}（先 cargo build -p rfvp-cli，或用 HCB_RFVP_CLI 指定）`);
    }

    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      this.handleLine(line);
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
      for (const handler of this.exitHandlers) {
        handler(code);
      }
    });
  }

  async load(bytes: Uint8Array, nls: string): Promise<RfvpLoadResult> {
    this.start();
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

      this.send({ op: 'load', hcbPath: file, nls });
    });
  }

  advance(): void {
    this.send({ op: 'advance' });
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
    this.clearLoadWaiter(new Error('引擎已关闭'));
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
