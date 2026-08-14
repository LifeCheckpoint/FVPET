/**
 * 集成测试用 rfvp-cli 客户端：以二进制长度前缀协议解析 stdout。
 *
 * stdout 协议（与 rfvp-process-manager.ts 保持一致）：
 *   [u32 LE total_len][u8 kind][payload]
 * - kind 0 = JSON 事件（UTF-8）
 * - kind 1 = RGBA 帧：[u32 width][u32 height][width*height*4 字节]
 */

import { spawn } from 'node:child_process';

const MAX_MSG_LEN = 256 * 1024 * 1024;

export interface RfvpCliSession {
  readonly events: Record<string, unknown>[];
  readonly stderr: string;
  send(request: Record<string, unknown>): void;
  waitExit(): Promise<void>;
}

export function spawnRfvpCli(exe: string): RfvpCliSession {
  const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const events: Record<string, unknown>[] = [];
  let stderr = '';
  let chunks: Buffer[] = [];
  let buffered = 0;

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const peek = (n: number): Buffer | null => {
    if (buffered < n || chunks.length === 0) {
      return null;
    }
    const first = chunks[0]!;
    if (first.length >= n) {
      return first.subarray(0, n);
    }
    const out = Buffer.allocUnsafe(n);
    let remaining = n;
    let i = 0;
    while (remaining > 0) {
      const head = chunks[i]!;
      const take = Math.min(head.length, remaining);
      head.copy(out, n - remaining, 0, take);
      remaining -= take;
      i += 1;
    }
    return out;
  };

  const consume = (n: number): void => {
    buffered -= n;
    while (n > 0 && chunks.length > 0) {
      const head = chunks[0]!;
      if (head.length <= n) {
        n -= head.length;
        chunks.shift();
      } else {
        chunks[0] = head.subarray(n);
        n = 0;
      }
    }
  };

  const take = (n: number): Buffer | null => {
    if (buffered < n) {
      return null;
    }
    const out = Buffer.allocUnsafe(n);
    let remaining = n;
    while (remaining > 0) {
      const head = chunks[0]!;
      const copy = Math.min(head.length, remaining);
      head.copy(out, n - remaining, 0, copy);
      remaining -= copy;
      consume(copy);
    }
    return out;
  };

  const drain = (): void => {
    const HEADER = 5;
    while (buffered >= HEADER) {
      const head = peek(HEADER);
      if (!head) {
        return;
      }
      const len = head.readUInt32LE(0);
      if (len < 1 || len > MAX_MSG_LEN) {
        chunks = [];
        buffered = 0;
        return;
      }
      if (buffered < 4 + len) {
        return;
      }
      const msg = take(4 + len);
      if (!msg) {
        return;
      }
      const kind = msg[4];
      const payload = msg.subarray(5);
      if (kind === 0) {
        try {
          events.push(JSON.parse(payload.toString('utf8')) as Record<string, unknown>);
        } catch {
          // 忽略非协议输出。
        }
      } else if (kind === 1 && payload.length >= 8) {
        events.push({
          type: 'frame',
          width: payload.readUInt32LE(0),
          height: payload.readUInt32LE(4),
          format: 'rgba8',
          data: payload.subarray(8),
        });
      }
    }
  };

  child.stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    buffered += chunk.length;
    drain();
  });

  return {
    events,
    get stderr(): string {
      return stderr;
    },
    send(request: Record<string, unknown>): void {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    },
    waitExit(): Promise<void> {
      return new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
      });
    },
  };
}
