/**
 * rfvp 子进程协议（zod 定义，唯一协议真理）。
 * 客户端（Electron 主进程 / UI）与 rfvp-cli 之间通过该协议通信。
 */

import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export const RfvpRequest = z.discriminatedUnion('op', [
  z.object({ op: z.literal('handshake'), protocolVersion: z.number() }),
  z.object({ op: z.literal('load'), hcbPath: z.string(), labels: z.record(z.number()).optional() }),
  z.object({ op: z.literal('jump'), label: z.string() }),
  z.object({ op: z.literal('step') }),
  z.object({ op: z.literal('advance') }), // 推进到下一个文本
  z.object({ op: z.literal('skip') }), // 快进
  z.object({ op: z.literal('get_g'), index: z.number() }),
  z.object({ op: z.literal('set_g'), index: z.number(), value: z.union([z.number(), z.string(), z.null()]) }),
  z.object({ op: z.literal('dump_prims') }),
  z.object({ op: z.literal('shutdown') }),
]);
export type RfvpRequest = z.infer<typeof RfvpRequest>;

export const RfvpEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    protocolVersion: z.number(),
    title: z.string().optional(),
    screenSize: z.tuple([z.number(), z.number()]).optional(),
  }),
  z.object({ type: z.literal('text'), slot: z.number(), text: z.string() }),
  z.object({ type: z.literal('waiting_text') }),
  z.object({ type: z.literal('audio'), channel: z.number(), action: z.enum(['load', 'play', 'stop']) }),
  z.object({ type: z.literal('thread'), slot: z.number(), status: z.number() }),
  z.object({
    type: z.literal('prims'),
    prims: z.array(
      z.object({
        id: z.number(),
        graphId: z.number(),
        x: z.number(),
        y: z.number(),
        z: z.number(),
        alpha: z.number(),
        scale: z.number(),
        rotate: z.number(),
        blend: z.number(),
        w: z.number().optional(),
        h: z.number().optional(),
      }),
    ),
  }),
  z.object({ type: z.literal('g'), index: z.number(), value: z.unknown() }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type RfvpEvent = z.infer<typeof RfvpEvent>;
