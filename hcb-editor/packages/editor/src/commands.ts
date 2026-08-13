/**
 * 命令集 + applyCommand（Immer patches）。
 * 所有修改走命令，undo/redo 用 Immer patches，零手写撤销逻辑。
 * 纯函数：applyCommand(state, cmd) -> { next, patches, inversePatches }。
 *
 * 分层约定：
 * - 低层 Command（可序列化）：驱动状态变更、进入 undo 栈的最小操作。
 * - 高层构造器（本文件后半部分）：UI 用它们拼装 Command，字段类型化。
 * - 连线合法性由 validateConnect / validateReconnect 声明，applyCommand 对非法连线抛错。
 */

import { enablePatches, produceWithPatches, type Patch } from 'immer';
import type { CondExpr, IrNode } from '@hcb-editor/hcb/ir';
import type { EdgeKind, EditorDocument, EditorState } from './state.js';
import { branchNode, jumpNode, labelNode, speakNode } from './node-factory.js';
import type { AudioResource, BackgroundResource, CharacterResource } from './resources.js';

// Immer patches 插件需在模块加载时启用一次
enablePatches();

export type Command =
  | { readonly kind: 'add_node'; readonly node: IrNode; readonly position: { readonly x: number; readonly y: number } }
  | { readonly kind: 'remove_node'; readonly id: string }
  | { readonly kind: 'move_node'; readonly id: string; readonly position: { readonly x: number; readonly y: number } }
  | { readonly kind: 'connect'; readonly source: string; readonly target: string; readonly kind2: EdgeKind }
  | { readonly kind: 'reconnect'; readonly source: string; readonly target: string; readonly kind2: EdgeKind }
  | { readonly kind: 'disconnect'; readonly edgeId: string }
  | { readonly kind: 'edit_node'; readonly id: string; readonly node: IrNode }
  | { readonly kind: 'select'; readonly nodeId: string | null }
  | { readonly kind: 'add_character'; readonly character: Omit<CharacterResource, 'id'> }
  | { readonly kind: 'add_characters'; readonly characters: readonly Omit<CharacterResource, 'id'>[] }
  | { readonly kind: 'remove_character'; readonly id: string }
  | { readonly kind: 'edit_character'; readonly id: string; readonly character: CharacterResource }
  | { readonly kind: 'edit_characters'; readonly edits: readonly { readonly id: string; readonly character: CharacterResource }[] }
  | { readonly kind: 'add_background'; readonly background: Omit<BackgroundResource, 'id'> }
  | { readonly kind: 'add_backgrounds'; readonly backgrounds: readonly Omit<BackgroundResource, 'id'>[] }
  | { readonly kind: 'remove_background'; readonly id: string }
  | { readonly kind: 'edit_background'; readonly id: string; readonly background: BackgroundResource }
  | { readonly kind: 'add_audio'; readonly audio: Omit<AudioResource, 'id'> }
  | { readonly kind: 'add_audios'; readonly audios: readonly Omit<AudioResource, 'id'>[] }
  | { readonly kind: 'remove_audio'; readonly id: string }
  | { readonly kind: 'edit_audio'; readonly id: string; readonly audio: AudioResource };

export interface ApplyResult {
  readonly next: EditorState;
  readonly patches: Patch[];
  readonly inversePatches: Patch[];
}

/** 校验连线端点与边类型约束；非法返回错误信息，合法返回 null。 */
function validateEdgeTargets(
  document: EditorDocument,
  source: string,
  target: string,
  kind: EdgeKind,
): string | null {
  if (source === target) {
    return '连线不能连接节点自身';
  }
  const src = document.nodes.find((n) => n.id === source);
  if (!src) {
    return `源节点不存在：${source}`;
  }
  const dst = document.nodes.find((n) => n.id === target);
  if (!dst) {
    return `目标节点不存在：${target}`;
  }
  switch (kind) {
    case 'then':
    case 'else': {
      if (src.node.kind !== 'branch') {
        return 'then/else 连线只能从 branch 节点出发';
      }
      if (dst.node.kind !== 'label') {
        return 'then/else 连线必须指向 label 节点';
      }
      return null;
    }
    case 'thread': {
      if (src.node.kind !== 'thread') {
        return 'thread 连线只能从 thread 节点出发';
      }
      if (dst.node.kind !== 'label') {
        return 'thread 连线必须指向 label 节点';
      }
      return null;
    }
    case 'jump': {
      if (src.node.kind !== 'jump') {
        return 'jump 连线只能从 jump 节点出发';
      }
      if (dst.node.kind !== 'label') {
        return 'jump 连线必须指向 label 节点';
      }
      return null;
    }
    case 'next':
      return null;
  }
}

/** 新建连线校验：在端点约束之上，额外禁止同一源节点的同类型重复出边。 */
export function validateConnect(
  document: EditorDocument,
  source: string,
  target: string,
  kind: EdgeKind,
): string | null {
  const error = validateEdgeTargets(document, source, target, kind);
  if (error) {
    return error;
  }
  const duplicated = document.edges.some((e) => e.source === source && e.kind === kind);
  if (duplicated) {
    return `源节点已存在 ${kind} 类型的出边`;
  }
  return null;
}

/** 重连校验：替换既有出边，因此不做重复出边检查。 */
export function validateReconnect(
  document: EditorDocument,
  source: string,
  target: string,
  kind: EdgeKind,
): string | null {
  return validateEdgeTargets(document, source, target, kind);
}

export function applyCommand(state: EditorState, cmd: Command): ApplyResult {
  if (cmd.kind === 'connect') {
    const error = validateConnect(state.document, cmd.source, cmd.target, cmd.kind2);
    if (error) {
      throw new Error(`connect 失败：${error}`);
    }
  } else if (cmd.kind === 'reconnect') {
    const error = validateReconnect(state.document, cmd.source, cmd.target, cmd.kind2);
    if (error) {
      throw new Error(`reconnect 失败：${error}`);
    }
  } else if (cmd.kind === 'remove_node' && cmd.id === state.document.startNodeId) {
    throw new Error('开始节点不可删除');
  }

  const [next, patches, inversePatches] = produceWithPatches(state, (draft) => {
    switch (cmd.kind) {
      case 'add_node': {
        const id = `n${draft.nextId}`;
        draft.document.nodes.push({ id, node: cmd.node, x: cmd.position.x, y: cmd.position.y });
        draft.nextId += 1;
        draft.selection.nodeId = id;
        break;
      }
      case 'remove_node': {
        const idx = draft.document.nodes.findIndex((n) => n.id === cmd.id);
        if (idx >= 0) {
          draft.document.nodes.splice(idx, 1);
        }
        draft.document.edges = draft.document.edges.filter(
          (e) => e.source !== cmd.id && e.target !== cmd.id,
        );
        if (draft.selection.nodeId === cmd.id) {
          draft.selection.nodeId = null;
        }
        break;
      }
      case 'move_node': {
        const n = draft.document.nodes.find((node) => node.id === cmd.id);
        if (n) {
          n.x = cmd.position.x;
          n.y = cmd.position.y;
        }
        break;
      }
      case 'connect': {
        const id = `e${draft.nextId}`;
        draft.document.edges.push({ id, source: cmd.source, target: cmd.target, kind: cmd.kind2 });
        draft.nextId += 1;
        break;
      }
      case 'reconnect': {
        draft.document.edges = draft.document.edges.filter(
          (e) => !(e.source === cmd.source && e.kind === cmd.kind2),
        );
        const id = `e${draft.nextId}`;
        draft.document.edges.push({ id, source: cmd.source, target: cmd.target, kind: cmd.kind2 });
        draft.nextId += 1;
        break;
      }
      case 'disconnect': {
        draft.document.edges = draft.document.edges.filter((e) => e.id !== cmd.edgeId);
        break;
      }
      case 'edit_node': {
        const n = draft.document.nodes.find((node) => node.id === cmd.id);
        if (n) {
          n.node = cmd.node;
        }
        break;
      }
      case 'select': {
        draft.selection.nodeId = cmd.nodeId;
        break;
      }
      case 'add_character': {
        const id = `c${draft.nextId}`;
        draft.resources.characters.push({ id, ...cmd.character });
        draft.nextId += 1;
        break;
      }
      case 'add_characters': {
        for (const character of cmd.characters) {
          const id = `c${draft.nextId}`;
          draft.resources.characters.push({ id, ...character });
          draft.nextId += 1;
        }
        break;
      }
      case 'remove_character': {
        const idx = draft.resources.characters.findIndex((r) => r.id === cmd.id);
        if (idx >= 0) {
          draft.resources.characters.splice(idx, 1);
        }
        break;
      }
      case 'edit_character': {
        const idx = draft.resources.characters.findIndex((r) => r.id === cmd.id);
        if (idx >= 0) {
          draft.resources.characters[idx] = cmd.character;
        }
        break;
      }
      case 'edit_characters': {
        for (const edit of cmd.edits) {
          const idx = draft.resources.characters.findIndex((r) => r.id === edit.id);
          if (idx >= 0) {
            draft.resources.characters[idx] = edit.character;
          }
        }
        break;
      }
      case 'add_background': {
        const id = `b${draft.nextId}`;
        draft.resources.backgrounds.push({ id, ...cmd.background });
        draft.nextId += 1;
        break;
      }
      case 'add_backgrounds': {
        for (const background of cmd.backgrounds) {
          const id = `b${draft.nextId}`;
          draft.resources.backgrounds.push({ id, ...background });
          draft.nextId += 1;
        }
        break;
      }
      case 'remove_background': {
        const idx = draft.resources.backgrounds.findIndex((r) => r.id === cmd.id);
        if (idx >= 0) {
          draft.resources.backgrounds.splice(idx, 1);
        }
        break;
      }
      case 'edit_background': {
        const idx = draft.resources.backgrounds.findIndex((r) => r.id === cmd.id);
        if (idx >= 0) {
          draft.resources.backgrounds[idx] = cmd.background;
        }
        break;
      }
      case 'add_audio': {
        const id = `a${draft.nextId}`;
        draft.resources.audios.push({ id, ...cmd.audio });
        draft.nextId += 1;
        break;
      }
      case 'add_audios': {
        for (const audio of cmd.audios) {
          const id = `a${draft.nextId}`;
          draft.resources.audios.push({ id, ...audio });
          draft.nextId += 1;
        }
        break;
      }
      case 'remove_audio': {
        const idx = draft.resources.audios.findIndex((r) => r.id === cmd.id);
        if (idx >= 0) {
          draft.resources.audios.splice(idx, 1);
        }
        break;
      }
      case 'edit_audio': {
        const idx = draft.resources.audios.findIndex((r) => r.id === cmd.id);
        if (idx >= 0) {
          draft.resources.audios[idx] = cmd.audio;
        }
        break;
      }
    }
  });

  return { next, patches, inversePatches };
}

// ---------------------------------------------------------------------------
// 高层命令构造器：UI 用它们拼装类型化的 Command，无需手写节点对象。
// ---------------------------------------------------------------------------

export function addNode(node: IrNode, position: { readonly x: number; readonly y: number }): Command {
  return { kind: 'add_node', node, position };
}

export function addLabelNode(name: string, position: { readonly x: number; readonly y: number }): Command {
  return addNode(labelNode(name), position);
}

export function addSpeakNode(
  speaker: string,
  text: string,
  position: { readonly x: number; readonly y: number },
  opts: { readonly alias?: string; readonly voice?: number } = {},
): Command {
  return addNode(speakNode(speaker, text, opts), position);
}

export function addDiaNode(text: string, position: { readonly x: number; readonly y: number }): Command {
  return addNode({ kind: 'dia', text }, position);
}

export function addBranchNode(cond: CondExpr, position: { readonly x: number; readonly y: number }): Command {
  return addNode(branchNode(cond, '', ''), position);
}

export function addJumpNode(target: string, position: { readonly x: number; readonly y: number }): Command {
  return addNode(jumpNode(target), position);
}

export function addCommentNode(text: string, position: { readonly x: number; readonly y: number }): Command {
  return addNode({ kind: 'comment', text }, position);
}

export function moveNode(id: string, position: { readonly x: number; readonly y: number }): Command {
  return { kind: 'move_node', id, position };
}

export function removeNode(id: string): Command {
  return { kind: 'remove_node', id };
}

export function connectNodes(source: string, target: string, kind2: EdgeKind): Command {
  return { kind: 'connect', source, target, kind2 };
}

export function reconnectNodes(source: string, target: string, kind2: EdgeKind): Command {
  return { kind: 'reconnect', source, target, kind2 };
}

export function disconnectEdge(edgeId: string): Command {
  return { kind: 'disconnect', edgeId };
}

export function editNode(id: string, node: IrNode): Command {
  return { kind: 'edit_node', id, node };
}

/**
 * 编辑 speak 节点字段：读取当前节点并与给定字段合并，返回完整替换命令。
 * 未提供的字段保持原值；可选字段暂不支持通过本函数清除（可用 editNode 整体替换）。
 */
export function editSpeakFields(
  state: EditorState,
  id: string,
  fields: {
    readonly speaker?: string;
    readonly alias?: string;
    readonly text?: string;
    readonly voice?: number;
  },
): Command {
  const found = state.document.nodes.find((n) => n.id === id);
  if (!found) {
    throw new Error(`editSpeakFields：节点不存在：${id}`);
  }
  if (found.node.kind !== 'speak') {
    throw new Error(`editSpeakFields：节点 ${id} 不是 speak 节点`);
  }
  const node = { ...found.node };
  if (fields.speaker !== undefined) node.speaker = fields.speaker;
  if (fields.text !== undefined) node.text = fields.text;
  if (fields.alias !== undefined) node.alias = fields.alias;
  if (fields.voice !== undefined) node.voice = fields.voice;
  return { kind: 'edit_node', id, node };
}

export function selectNode(nodeId: string | null): Command {
  return { kind: 'select', nodeId };
}

// ---------------------------------------------------------------------------
// 资源表命令构造器
// ---------------------------------------------------------------------------

export function addCharacter(character: Omit<CharacterResource, 'id'>): Command {
  return { kind: 'add_character', character };
}

export function addCharacters(characters: readonly Omit<CharacterResource, 'id'>[]): Command {
  return { kind: 'add_characters', characters };
}

export function removeCharacter(id: string): Command {
  return { kind: 'remove_character', id };
}

export function editCharacter(id: string, character: CharacterResource): Command {
  return { kind: 'edit_character', id, character };
}

export function editCharacters(edits: readonly { readonly id: string; readonly character: CharacterResource }[]): Command {
  return { kind: 'edit_characters', edits };
}

export function addBackground(background: Omit<BackgroundResource, 'id'>): Command {
  return { kind: 'add_background', background };
}

export function addBackgrounds(backgrounds: readonly Omit<BackgroundResource, 'id'>[]): Command {
  return { kind: 'add_backgrounds', backgrounds };
}

export function removeBackground(id: string): Command {
  return { kind: 'remove_background', id };
}

export function editBackground(id: string, background: BackgroundResource): Command {
  return { kind: 'edit_background', id, background };
}

export function addAudio(audio: Omit<AudioResource, 'id'>): Command {
  return { kind: 'add_audio', audio };
}

export function addAudios(audios: readonly Omit<AudioResource, 'id'>[]): Command {
  return { kind: 'add_audios', audios };
}

export function removeAudio(id: string): Command {
  return { kind: 'remove_audio', id };
}

export function editAudio(id: string, audio: AudioResource): Command {
  return { kind: 'edit_audio', id, audio };
}
