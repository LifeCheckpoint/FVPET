/**
 * 资源表模型：角色 / 背景 / 音频三张可编辑表。
 * - 角色、背景携带「底座游戏函数地址」字段；新增资源时地址为 null，
 *   由编译器 emitFunctionDef 在编译期自动分配。
 * - 音频仅数据（syscall 编号直传，无函数生成）。
 */

/** 替换表情切片：附属于某个「姿势 / 服装」立绘之下（第三级）。face=0 为 body 默认表情，不单独存图。 */
export interface CharacterFace {
  readonly face: number;
  readonly image: string;
}

/**
 * 立绘集：同一角色按「姿势 / 服装」绑定 body 立绘，表情作为其下第三级切片。
 * - image：body 立绘（含默认表情 face=0）。
 * - faces：替换表情（face >= 1），预览时按 faceX/faceY 叠加到 body 上。
 */
export interface CharacterPose {
  readonly pose: number;
  readonly costume: number;
  readonly image: string;
  /** 替换表情（face >= 1）。与其余资源字段一致，使用可变数组以兼容 Immer draft。 */
  readonly faces: CharacterFace[];
  /** 表情切片在 body 上的叠加偏移（像素，相对 body 左上角）。 */
  readonly faceX?: number;
  readonly faceY?: number;
  readonly faceWidth?: number;
  readonly faceHeight?: number;
  /** body 立绘原始像素尺寸（预览叠加表情时按比例缩放用）。 */
  readonly bodyWidth?: number;
  readonly bodyHeight?: number;
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
  /** 背景图片 data URL（预览用全图）。 */
  readonly image?: string;
  /** 背景缩略图 data URL（列表展示用，256px 平滑降采样，降低大量图片渲染卡顿）。 */
  readonly thumb?: string;
}

/**
 * 事件 CG 资源：与背景（编号引用）不同，CG 由 HCB 的「字符串名」引用
 * （cgset 节点 push_string 大写名 → call f_000373a5）。
 */
export interface CgResource {
  readonly id: string;
  /** CG 资源名（大写，如 ASAHI_E011A1）。 */
  readonly name: string;
  /** CG 图片 data URL（全屏预览）。 */
  readonly image: string;
  /** CG 缩略图 data URL（列表展示用，256px 平滑降采样）。 */
  readonly thumb?: string;
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
  readonly cgs: readonly CgResource[];
  readonly audios: readonly AudioResource[];
}

export function emptyResources(): ProjectResources {
  return { characters: [], backgrounds: [], cgs: [], audios: [] };
}
