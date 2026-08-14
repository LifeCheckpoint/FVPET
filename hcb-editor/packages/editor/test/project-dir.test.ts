import { describe, expect, it } from 'vitest';
import { applyPatches } from 'immer';
import {
  addBackground,
  applyCommand,
  deserializeProject,
  deserializeProjectFromDir,
  emptyState,
  planProjectSave,
  replaceAssetRefs,
} from '@hcb-editor/editor';

const IMG = 'data:image/png;base64,AAAA';

function withBackground(image: string) {
  return applyCommand(emptyState(), addBackground({ name: 'bg', variant: 0, bgFn: null, image })).next;
}

describe('planProjectSave（增量目录保存规划）', () => {
  it('把 data URL 提取为 dirtyAssets，并在 projectJson 中替换为相对路径引用', () => {
    const plan = planProjectSave(withBackground(IMG));

    expect(plan.dirtyAssets).toHaveLength(1);
    expect(plan.dirtyAssets[0]!.path).toMatch(/^assets\/[0-9a-f]{16}-\d+\.png$/);
    expect(plan.referencedPaths.has(plan.dirtyAssets[0]!.path)).toBe(true);
    expect(plan.refs[IMG]).toBe(plan.dirtyAssets[0]!.path);

    const restored = deserializeProjectFromDir(plan.projectJson);
    expect(restored.resources.backgrounds[0]!.image).toBe(plan.dirtyAssets[0]!.path);
  });

  it('相同内容的 data URL 去重为同一资源文件', () => {
    let state = withBackground(IMG);
    state = applyCommand(state, addBackground({ name: 'bg2', variant: 1, bgFn: null, image: IMG })).next;

    const plan = planProjectSave(state);
    expect(plan.dirtyAssets).toHaveLength(1);

    const bgs = deserializeProjectFromDir(plan.projectJson).resources.backgrounds;
    expect(bgs[0]!.image).toBe(bgs[1]!.image);
  });

  it('已落盘引用不产生 dirtyAssets，但进入 GC 白名单', () => {
    const plan = planProjectSave(withBackground('assets/abc-3.png'));

    expect(plan.dirtyAssets).toHaveLength(0);
    expect(plan.referencedPaths.has('assets/abc-3.png')).toBe(true);
    expect(plan.refs).toEqual({});
  });
});

describe('project file 兼容性', () => {
  it('兼容 v1 schemaVersion 的工程 JSON（data URL 资源不迁移）', () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' },
      document: { nodes: [], edges: [], startNodeId: 'start' },
      resources: { characters: [], backgrounds: [], cgs: [], audios: [] },
      selection: { nodeId: null },
      nextId: 1,
    });

    const state = deserializeProject(v1);
    expect(state.header.game).toBe('sakura-moyu');
    expect(state.document.nodes).toHaveLength(0);
  });
});

describe('replaceAssetRefs 命令', () => {
  it('把 data URL 替换为引用，并可撤销回退', () => {
    const state = withBackground(IMG);
    const plan = planProjectSave(state);
    const refPath = plan.dirtyAssets[0]!.path;

    const { next, inversePatches } = applyCommand(state, replaceAssetRefs(plan.refs));
    expect(next.resources.backgrounds[0]!.image).toBe(refPath);

    const undone = applyPatches(next, inversePatches);
    expect(undone.resources.backgrounds[0]!.image).toBe(IMG);
  });
});
