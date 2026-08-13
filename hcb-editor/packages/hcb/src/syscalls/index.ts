/**
 * FVP syscall 语义数据库（数据 + zod 校验）。
 * 数据文件 syscall_spec.json 由 fvp_analysis 的 syscall语义数据库 搬运而来，
 * 领域知识数据化：换游戏/新作补 syscall，加数据不改代码。
 */

import { z } from 'zod';
import specJson from './syscall_spec.json';

export const SyscallParameterType = z.object({
  index: z.number(),
  type: z.string(),
  meaning: z.string(),
  confidence: z.string(),
});
export type SyscallParameterType = z.infer<typeof SyscallParameterType>;

export const SyscallControlFlow = z.object({
  yield: z.boolean(),
  wait: z.boolean(),
  sleep: z.boolean(),
  text_wait: z.boolean(),
  dissolve_wait: z.boolean(),
  starts_context: z.boolean(),
  exits_context: z.boolean(),
  halt: z.boolean(),
  conditional: z.boolean(),
  reason: z.string(),
});
export type SyscallControlFlow = z.infer<typeof SyscallControlFlow>;

export const SyscallSpec = z.object({
  name: z.string(),
  group: z.string(),
  handler: z.string(),
  arg_count: z.number(),
  parameter_types: z.array(SyscallParameterType),
  return_type: z.string(),
  affected_game_data_subsystems: z.array(z.string()),
  control_flow: SyscallControlFlow,
  implementation_status: z.string(),
  verification_status: z.string(),
  evidence_sources: z.array(z.string()),
  notes: z.array(z.string()),
});
export type SyscallSpec = z.infer<typeof SyscallSpec>;

export const SyscallDb = z.object({
  metadata: z.object({
    schema: z.string(),
    title: z.string(),
    description: z.string(),
    entry_count: z.number(),
    source_priority: z.array(z.string()),
    field_notes: z.record(z.string(), z.string()),
  }),
  syscalls: z.array(SyscallSpec),
});
export type SyscallDb = z.infer<typeof SyscallDb>;

const db: SyscallDb = SyscallDb.parse(specJson as unknown);

export function allSyscalls(): readonly SyscallSpec[] {
  return db.syscalls;
}

export function getSyscall(name: string): SyscallSpec | undefined {
  return db.syscalls.find((s) => s.name === name);
}

export function syscallNames(): ReadonlySet<string> {
  return new Set(db.syscalls.map((s) => s.name));
}
