/**
 * 工程目录序列化：工程 = project.json + assets/ 目录（资源文件落盘）。
 * - serializeProjectToDir：把资源里的 data URL 外置为 assets 文件，project.json 里存相对路径。
 * - deserializeProjectFromDir：读回 assets，把相对路径内联为 data URL（供预览直接使用）。
 * 单文件 JSON（serializeProject/deserializeProject）仍保留，作为浏览器兜底。
 */

import { deserializeProject, serializeProject } from './project-file.js';
import type { EditorState } from './state.js';

export interface ProjectAsset {
  /** 相对路径，如 assets/res-0.png */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ProjectDirData {
  readonly projectJson: string;
  readonly assets: readonly ProjectAsset[];
}

function parseDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (!m) {
    return null;
  }
  const mime = m[1]!;
  const b64 = m[2]!;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mime, bytes };
}

function toDataUrl(mime: string, bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return `data:${mime};base64,${btoa(binary)}`;
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

function extOfMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin';
}

function mimeOfPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** 把资源里的 data URL 外置为 assets 文件，project.json 里存相对路径。 */
export function serializeProjectToDir(state: EditorState): ProjectDirData {
  const assets: ProjectAsset[] = [];
  let counter = 0;

  const externalize = (url: string | undefined): string | undefined => {
    if (!url || !url.startsWith('data:')) {
      return url;
    }
    const parsed = parseDataUrl(url);
    if (!parsed) {
      return url;
    }
    const path = `assets/res-${counter}.${extOfMime(parsed.mime)}`;
    counter += 1;
    assets.push({ path, bytes: parsed.bytes });
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
          ...(c.poses !== undefined
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
        return { ...b, ...(image !== undefined ? { image } : {}) };
      }),
      audios: state.resources.audios.map((a) => {
        const src = externalize(a.src);
        return { ...a, ...(src !== undefined ? { src } : {}) };
      }),
    },
  };

  return { projectJson: serializeProject(projectState), assets };
}

/** 读回 assets，把相对路径内联为 data URL（供预览直接使用）。 */
export function deserializeProjectFromDir(
  projectJson: string,
  assets: readonly ProjectAsset[],
): EditorState {
  const byPath = new Map(assets.map((a) => [a.path, a]));
  const state = deserializeProject(projectJson);

  const inline = (path: string | undefined): string | undefined => {
    if (!path || path.startsWith('data:')) {
      return path;
    }
    const asset = byPath.get(path);
    if (!asset) {
      return path;
    }
    return toDataUrl(mimeOfPath(path), asset.bytes);
  };

  return {
    ...state,
    resources: {
      characters: state.resources.characters.map((c) => {
        const image = inline(c.image);
        return {
          ...c,
          ...(image !== undefined ? { image } : {}),
          ...(c.poses !== undefined
            ? {
                poses: c.poses.map((p) => ({
                  ...p,
                  image: inline(p.image) ?? p.image,
                  faces: p.faces.map((f) => ({ ...f, image: inline(f.image) ?? f.image })),
                })),
              }
            : {}),
        };
      }),
      backgrounds: state.resources.backgrounds.map((b) => {
        const image = inline(b.image);
        return { ...b, ...(image !== undefined ? { image } : {}) };
      }),
      audios: state.resources.audios.map((a) => {
        const src = inline(a.src);
        return { ...a, ...(src !== undefined ? { src } : {}) };
      }),
    },
  };
}
