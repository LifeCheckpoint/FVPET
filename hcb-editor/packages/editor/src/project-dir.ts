/**
 * 工程目录序列化：工程 = project.json + assets/ 目录（资源文件落盘，内容寻址）。
 * - planProjectSave：把尚未落盘的 data URL 提取为 dirtyAssets，已落盘引用直接保留；
 *   返回 projectJson + 增量资产 + 被引用路径集合（主进程 GC 用）+ dataUrl→path 映射。
 * - deserializeProjectFromDir：只解析 project.json（资源保持相对路径引用，不内联二进制）。
 * - parseDataUrl / toDataUrl：浏览器单文件降级模式仍使用（分块 base64，避免大字符串卡顿）。
 */

import { deserializeProject, serializeProject } from './project-file.js';
import { isDataUrl } from './resources.js';
import type { EditorState } from './state.js';

export interface ProjectAsset {
  /** 相对路径，如 assets/<hash>-<len>.png */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ProjectSavePlan {
  readonly projectJson: string;
  /** 需要写入磁盘的新资源（尚未落盘的 data URL）。 */
  readonly dirtyAssets: readonly ProjectAsset[];
  /** 本次保存后仍被引用的资源相对路径（GC 白名单）。 */
  readonly referencedPaths: ReadonlySet<string>;
  /** data URL → 相对路径引用（保存成功后替换内存态）。 */
  readonly refs: Readonly<Record<string, string>>;
}

/** 解析 data URL 为字节。`Uint8Array.from` 走 C++ 级迭代，远快于逐字节循环。 */
export function parseDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (!m) {
    return null;
  }
  const mime = m[1]!;
  const binary = atob(m[2]!);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return { mime, bytes };
}

/** 分块 base64：避免超大字符串逐字节拼接与单次超大 fromCharCode 调用栈。 */
const BASE64_CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** 字节 → data URL（浏览器单文件降级模式用）。 */
export function toDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

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

const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
};

export function extOfMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin';
}

export function mimeOfPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * 内容哈希（双 64-bit 混合，混合内容长度）：生成稳定、内容寻址的文件名。
 * 非加密哈希即可满足资源去重需求；配合文件名中的长度后缀，碰撞概率可忽略。
 */
function hashAssetBytes(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    const k = bytes[i]!;
    h1 = Math.imul(h1 ^ k, 2654435761);
    h2 = Math.imul(h2 ^ k, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 = Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

/**
 * 规划一次目录保存：把尚未落盘的 data URL 提取为 dirtyAssets，
 * 已落盘引用直接保留；产出引用化后的 projectJson + GC 白名单。
 */
export function planProjectSave(state: EditorState): ProjectSavePlan {
  const dirtyAssets: ProjectAsset[] = [];
  const urlToPath = new Map<string, string>();
  const contentToPath = new Map<string, string>();
  const referencedPaths = new Set<string>();
  const refs: Record<string, string> = {};

  const externalize = (url: string | undefined): string | undefined => {
    if (url === undefined || url === '') {
      return url;
    }
    if (!isDataUrl(url)) {
      referencedPaths.add(url);
      return url;
    }
    const existing = urlToPath.get(url);
    if (existing) {
      return existing;
    }
    const parsed = parseDataUrl(url);
    if (!parsed) {
      return url;
    }
    const digest = hashAssetBytes(parsed.bytes);
    const key = `${parsed.bytes.length}:${digest}`;
    let path = contentToPath.get(key);
    if (!path) {
      path = `assets/${digest}-${parsed.bytes.length}.${extOfMime(parsed.mime)}`;
      contentToPath.set(key, path);
      dirtyAssets.push({ path, bytes: parsed.bytes });
    }
    urlToPath.set(url, path);
    refs[url] = path;
    referencedPaths.add(path);
    return path;
  };

  const projectState: EditorState = {
    ...state,
    resources: {
      characters: state.resources.characters.map((c) => {
        const image = externalize(c.image);
        return {
          ...c,
          ...(image !== undefined ? { image } : {}),
          ...(c.poses
            ? {
                poses: c.poses.map((p) => ({
                  ...p,
                  image: externalize(p.image) ?? p.image,
                  faces: p.faces.map((f) => ({ ...f, image: externalize(f.image) ?? f.image })),
                })),
              }
            : {}),
        };
      }),
      backgrounds: state.resources.backgrounds.map((b) => {
        const image = externalize(b.image);
        const thumb = externalize(b.thumb);
        return { ...b, ...(image !== undefined ? { image } : {}), ...(thumb !== undefined ? { thumb } : {}) };
      }),
      cgs: state.resources.cgs.map((c) => {
        const thumb = externalize(c.thumb);
        return { ...c, image: externalize(c.image) ?? c.image, ...(thumb !== undefined ? { thumb } : {}) };
      }),
      audios: state.resources.audios.map((a) => {
        const src = externalize(a.src);
        return { ...a, ...(src !== undefined ? { src } : {}) };
      }),
    },
  };

  return {
    projectJson: serializeProject(projectState),
    dirtyAssets,
    referencedPaths,
    refs,
  };
}

/** 打开工程目录：只解析 project.json，资源保持相对路径引用（二进制按需经协议加载）。 */
export function deserializeProjectFromDir(projectJson: string): EditorState {
  return deserializeProject(projectJson);
}
