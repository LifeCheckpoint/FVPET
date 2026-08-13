/**
 * 底座游戏注册表（数据）。
 * 换游戏 = 加一条数据 + 对应表文件，代码零改动。
 * 首个底座：sakura moyu（さくら、もゆ。）。
 */

export interface BaseGame {
  readonly id: string;
  readonly label: string;
}

export const BASE_GAMES: readonly BaseGame[] = [
  { id: 'sakura-moyu', label: 'sakura moyu（さくら、もゆ。）' },
];

export const DEFAULT_BASE_GAME: string = BASE_GAMES[0]!.id;
