/**
 * 资源表模型：角色 / 背景 / 音频三张可编辑表。
 * - 角色、背景携带「底座游戏函数地址」字段；新增资源时地址为 null，
 *   由编译器 emitFunctionDef 在编译期自动分配。
 * - 音频仅数据（syscall 编号直传，无函数生成）。
 */

/** 立绘表情/姿势组合：同一角色可按 pose/costume/face 绑定不同图片。 */
export interface CharacterPose {
  readonly pose: number;
  readonly costume: number;
  readonly face: number;
  readonly image: string;
}

export interface CharacterResource {
  readonly id: string;
  readonly name: string;
  readonly alias?: string;
  /** 底座游戏已有 SPEAK 函数地址；新增资源为 null（编译期自动分配）。 */
  readonly speakFn: number | null;
  /** 内置标记：底座预置角色（speakFn 锁定，可补立绘，不可作为自定义角色重新生成）。 */
  readonly builtin?: boolean;
  /** 立绘编号（真实引擎 bsset 的 chaNum）；底座数据暂缺，用户可手填。 */
  readonly chaNum?: number;
  readonly pose: number;
  readonly costume: number;
  readonly face: number;
  /** 默认立绘 data URL（未命中表情集时兜底）。 */
  readonly image?: string;
  /** 表情集：pose/costume/face → 图片。bsset 预览按此匹配；未配置时为空。 */
  readonly poses?: CharacterPose[];
}

export interface BackgroundResource {
  readonly id: string;
  readonly name: string;
  readonly variant: number;
  /** 底座游戏背景函数地址；新增资源为 null。 */
  readonly bgFn: number | null;
  /** 背景图片 data URL。 */
  readonly image?: string;
}

export interface AudioResource {
  readonly id: string;
  readonly type: 'bgm' | 'voice' | 'se';
  readonly number: number;
  readonly label: string;
  /** 音频 data URL（用于试听）。 */
  readonly src?: string;
}

export interface ProjectResources {
  readonly characters: readonly CharacterResource[];
  readonly backgrounds: readonly BackgroundResource[];
  readonly audios: readonly AudioResource[];
}

export function emptyResources(): ProjectResources {
  return { characters: [], backgrounds: [], audios: [] };
}
