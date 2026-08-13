/**
 * IR JSON 序列化/反序列化。
 * raw 节点的 bytes 以 base64 字符串表示；反序列化时还原为 Uint8Array 并做 zod 校验。
 * 使用 atob/btoa（Node 16+ 与浏览器均内置），避免引入 Buffer 依赖。
 */

import { IrNode, IrScript, type IrNode as IrNodeT, type IrScript as IrScriptT } from './types.js';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function irNodeToJson(node: IrNodeT): unknown {
  if (node.kind === 'raw') {
    return { ...node, bytes: bytesToBase64(node.bytes) };
  }
  return node;
}

export function irNodeFromJson(data: unknown): IrNodeT {
  const revived = reviveRawBytes(data);
  return IrNode.parse(revived);
}

export function irScriptToJson(script: IrScriptT): unknown {
  return {
    ...script,
    nodes: script.nodes.map(irNodeToJson),
  };
}

export function irScriptFromJson(data: unknown): IrScriptT {
  const revived = reviveRawBytes(data);
  return IrScript.parse(revived);
}

function reviveRawBytes(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(reviveRawBytes);
  }
  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj['kind'] === 'raw' && typeof obj['bytes'] === 'string') {
      return { ...obj, bytes: base64ToBytes(obj['bytes']) };
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = reviveRawBytes(value);
    }
    return out;
  }
  return data;
}
