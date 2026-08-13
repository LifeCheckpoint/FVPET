/**
 * 工程文件序列化 / 反序列化（契约即类型）。
 * 工程文件 = header + document（节点图）+ resources（资源表）+ selection + nextId，
 * 是编辑器的单一事实来源；raw 节点 bytes 经 base64 表示（见 hcb/ir/serialize）。
 */

import { z } from 'zod';
import { IrHeader, irNodeFromJson, irNodeToJson } from '@hcb-editor/hcb/ir';
import type { EditorState } from './state.js';

export const PROJECT_FILE_SCHEMA_VERSION = 1 as const;

const CharacterFaceSchema = z.object({
  face: z.number(),
  image: z.string(),
});

const CharacterPoseSchema = z.object({
  pose: z.number(),
  costume: z.number(),
  image: z.string(),
  faces: z.array(CharacterFaceSchema).default([]),
  faceX: z.number().optional(),
  faceY: z.number().optional(),
  faceWidth: z.number().optional(),
  faceHeight: z.number().optional(),
  bodyWidth: z.number().optional(),
  bodyHeight: z.number().optional(),
});

const CharacterResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  alias: z.string().optional(),
  speakFn: z.number().nullable(),
  builtin: z.boolean().optional(),
  chaNum: z.number().optional(),
  pose: z.number(),
  costume: z.number(),
  face: z.number(),
  image: z.string().optional(),
  poses: z.array(CharacterPoseSchema).optional(),
});

const BackgroundResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  variant: z.number(),
  bgFn: z.number().nullable(),
  image: z.string().optional(),
  thumb: z.string().optional(),
});

const AudioResourceSchema = z.object({
  id: z.string(),
  type: z.enum(['bgm', 'voice', 'se']),
  number: z.number(),
  label: z.string(),
  src: z.string().optional(),
});

const CgResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  thumb: z.string().optional(),
});

const DocNodeJson = z.object({
  id: z.string(),
  node: z.unknown(),
  x: z.number(),
  y: z.number(),
});

const DocEdgeJson = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.enum(['next', 'then', 'else', 'thread', 'jump']),
});

const ProjectFileJson = z.object({
  schemaVersion: z.literal(1),
  header: IrHeader,
  document: z.object({
    nodes: z.array(DocNodeJson),
    edges: z.array(DocEdgeJson),
    startNodeId: z.string(),
  }),
  resources: z.object({
    characters: z.array(CharacterResourceSchema),
    backgrounds: z.array(BackgroundResourceSchema),
    cgs: z.array(CgResourceSchema),
    audios: z.array(AudioResourceSchema),
  }),
  selection: z.object({ nodeId: z.string().nullable() }),
  nextId: z.number(),
});

export function serializeProject(state: EditorState): string {
  const json = {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    header: state.header,
    document: {
      nodes: state.document.nodes.map((n) => ({
        id: n.id,
        node: irNodeToJson(n.node),
        x: n.x,
        y: n.y,
      })),
      edges: state.document.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
      })),
      startNodeId: state.document.startNodeId,
    },
    resources: state.resources,
    selection: state.selection,
    nextId: state.nextId,
  };
  return JSON.stringify(json, null, 2);
}

export function deserializeProject(text: string): EditorState {
  const parsed = ProjectFileJson.parse(JSON.parse(text));
  const nodes = parsed.document.nodes.map((n) => ({
    id: n.id,
    node: irNodeFromJson(n.node),
    x: n.x,
    y: n.y,
  }));
  // zod 的 optional 推断为 `string | undefined`，而 exactOptionalPropertyTypes 下
  // CharacterResource.alias 不允许显式 undefined，此处显式剥离。
  const characters = parsed.resources.characters.map((c) => {
    const r: {
      id: string;
      name: string;
      speakFn: number | null;
      pose: number;
      costume: number;
      face: number;
      alias?: string;
      builtin?: boolean;
      chaNum?: number;
      image?: string;
      poses?: {
        pose: number;
        costume: number;
        image: string;
        faces: { face: number; image: string }[];
        faceX?: number;
        faceY?: number;
        faceWidth?: number;
        faceHeight?: number;
        bodyWidth?: number;
        bodyHeight?: number;
      }[];
    } = {
      id: c.id,
      name: c.name,
      speakFn: c.speakFn,
      pose: c.pose,
      costume: c.costume,
      face: c.face,
    };
    if (c.alias !== undefined) {
      r.alias = c.alias;
    }
    if (c.builtin !== undefined) {
      r.builtin = c.builtin;
    }
    if (c.chaNum !== undefined) {
      r.chaNum = c.chaNum;
    }
    if (c.image !== undefined) {
      r.image = c.image;
    }
    if (c.poses !== undefined) {
      r.poses = c.poses.map((p) => {
        const pose: {
          pose: number;
          costume: number;
          image: string;
          faces: { face: number; image: string }[];
          faceX?: number;
          faceY?: number;
          faceWidth?: number;
          faceHeight?: number;
          bodyWidth?: number;
          bodyHeight?: number;
        } = {
          pose: p.pose,
          costume: p.costume,
          image: p.image,
          faces: p.faces.map((f) => ({ face: f.face, image: f.image })),
        };
        if (p.faceX !== undefined) pose.faceX = p.faceX;
        if (p.faceY !== undefined) pose.faceY = p.faceY;
        if (p.faceWidth !== undefined) pose.faceWidth = p.faceWidth;
        if (p.faceHeight !== undefined) pose.faceHeight = p.faceHeight;
        if (p.bodyWidth !== undefined) pose.bodyWidth = p.bodyWidth;
        if (p.bodyHeight !== undefined) pose.bodyHeight = p.bodyHeight;
        return pose;
      });
    }
    return r;
  });
  const backgrounds = parsed.resources.backgrounds.map((b) => {
    const r: { id: string; name: string; variant: number; bgFn: number | null; image?: string; thumb?: string } = {
      id: b.id,
      name: b.name,
      variant: b.variant,
      bgFn: b.bgFn,
    };
    if (b.image !== undefined) {
      r.image = b.image;
    }
    if (b.thumb !== undefined) {
      r.thumb = b.thumb;
    }
    return r;
  });
  const audios = parsed.resources.audios.map((a) => {
    const r: { id: string; type: 'bgm' | 'voice' | 'se'; number: number; label: string; src?: string } = {
      id: a.id,
      type: a.type,
      number: a.number,
      label: a.label,
    };
    if (a.src !== undefined) {
      r.src = a.src;
    }
    return r;
  });
  const cgs = parsed.resources.cgs.map((c) => {
    const r: { id: string; name: string; image: string; thumb?: string } = {
      id: c.id,
      name: c.name,
      image: c.image,
    };
    if (c.thumb !== undefined) {
      r.thumb = c.thumb;
    }
    return r;
  });
  return {
    header: parsed.header,
    document: { nodes, edges: parsed.document.edges, startNodeId: parsed.document.startNodeId },
    resources: { characters, backgrounds, cgs, audios },
    selection: parsed.selection,
    nextId: parsed.nextId,
  };
}
