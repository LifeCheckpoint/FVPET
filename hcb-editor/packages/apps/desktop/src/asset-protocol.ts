/**
 * fvpet-asset:// 只读资产协议：把工程目录的 assets/ 映射为可流式加载的资源 URL。
 * URL 形如 fvpet-asset://asset/<base64url(工程目录绝对路径)>/<assets/ 下相对路径>。
 * 图片/音频经 <img>/<audio>/Pixi 按需加载（浏览器原生解码 + 缓存）。
 *
 * 关键点：手动实现 HTTP Range（206 + Content-Range + Accept-Ranges），
 * 否则 <audio> 无法计算总时长 / 拖动进度条。
 */

import { protocol } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

function mimeOfPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** 解析 Range 头（bytes=start-end / bytes=start- / bytes=-suffix）。 */
function parseRange(header: string | null, size: number): ByteRange | null {
  if (!header) {
    return null;
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || size <= 0) {
    return null;
  }
  const startStr = m[1]!;
  const endStr = m[2]!;
  if (startStr === '' && endStr === '') {
    return null;
  }
  if (startStr === '') {
    // suffix：最后 N 字节
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return null;
    }
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }
  const start = Number(startStr);
  let end = endStr === '' ? size - 1 : Number(endStr);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (start >= size || start > end) {
    return null;
  }
  end = Math.min(end, size - 1);
  return { start, end };
}

export function registerAssetProtocol(): void {
  protocol.handle('fvpet-asset', (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter((s) => s.length > 0);
      if (parts.length < 2) {
        return new Response('not found', { status: 404 });
      }
      const dir = Buffer.from(parts[0]!, 'base64url').toString('utf8');
      const rel = parts.slice(1).map((p) => decodeURIComponent(p)).join('/');
      const full = path.resolve(dir, rel);
      const root = path.resolve(dir, 'assets');
      if (full !== root && !full.startsWith(root + path.sep)) {
        return new Response('forbidden', { status: 403 });
      }

      const stat = fs.statSync(full);
      if (!stat.isFile()) {
        return new Response('not found', { status: 404 });
      }
      const size = stat.size;
      const mime = mimeOfPath(full);
      const range = parseRange(request.headers.get('range'), size);

      if (range) {
        const length = range.end - range.start + 1;
        const fd = fs.openSync(full, 'r');
        try {
          const buf = Buffer.alloc(length);
          fs.readSync(fd, buf, 0, length, range.start);
          return new Response(new Uint8Array(buf), {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
              'Content-Length': String(length),
              'Accept-Ranges': 'bytes',
            },
          });
        } finally {
          fs.closeSync(fd);
        }
      }

      const bytes = new Uint8Array(fs.readFileSync(full));
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : 'bad request', { status: 400 });
    }
  });
}
