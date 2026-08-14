import { describe, expect, it } from 'vitest';
import { addNode, applyCommand, bssetNode, emptyState, projectToIr } from '@hcb-editor/editor';
import { buildPreviewScript, loadPrimTextures } from '@hcb-editor/ui';

describe('buildPreviewScript', () => {
  it('projects speak/dia into the text queue and bsset into prims', () => {
    let state = emptyState();
    const startId = state.document.startNodeId;
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'speak', speaker: 'クロ', text: '你好' }, position: { x: 100, y: 0 } }).next;
    const speakId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'dia', text: '……' }, position: { x: 200, y: 0 } }).next;
    const diaId = state.selection.nodeId!;
    state = applyCommand(state, addNode(bssetNode({ character: 'クロ', pose: 0, costume: 0, expression: 0, position: { x: 120, y: 40 }, layer: 1 }), { x: 300, y: 0 })).next;
    const bsId = state.selection.nodeId!;

    state = applyCommand(state, { kind: 'connect', source: startId, target: speakId, kind2: 'next' }).next;
    state = applyCommand(state, { kind: 'connect', source: speakId, target: diaId, kind2: 'next' }).next;
    state = applyCommand(state, { kind: 'connect', source: diaId, target: bsId, kind2: 'next' }).next;

    const script = buildPreviewScript(state.document, state.header);
    expect(script.texts).toEqual([
      { text: '你好', speaker: 'クロ' },
      { text: '……' },
    ]);
    expect(script.prims).toHaveLength(1);
    expect(script.prims[0]!.z).toBe(1);
    expect(script.prims[0]!.label).toBe('クロ');
  });

  it('projects selset choices and speak voice into the text queue', () => {
    let state = emptyState();
    const startId = state.document.startNodeId;
    state = applyCommand(state, {
      kind: 'add_node',
      node: { kind: 'selset', choices: [{ text: '去学校', label: 'go_school' }, { text: '回家', label: 'go_home' }], resultGlobal: 103 },
      position: { x: 100, y: 0 },
    }).next;
    const selId = state.selection.nodeId!;
    state = applyCommand(state, {
      kind: 'add_node',
      node: { kind: 'speak', speaker: 'クロ', text: '你好', voice: 3 },
      position: { x: 200, y: 0 },
    }).next;
    const speakId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'connect', source: startId, target: selId, kind2: 'next' }).next;
    state = applyCommand(state, { kind: 'connect', source: selId, target: speakId, kind2: 'next' }).next;
    state = applyCommand(state, {
      kind: 'add_audio',
      audio: { type: 'voice', number: 3, label: 'voice3', src: 'data:audio/x;base64,AAA' },
    }).next;

    const script = buildPreviewScript(state.document, state.header, state.resources);
    expect(script.texts).toEqual([
      { text: '请选择：', choices: ['去学校', '回家'] },
      { text: '你好', speaker: 'クロ', audioSrc: 'data:audio/x;base64,AAA' },
    ]);
  });

  it('loads projected image URLs asynchronously, deduplicates them and isolates failures', async () => {
    const loaded: string[] = [];
    const textures = await loadPrimTextures(
      [
        { id: 0, graphId: 0, x: 0, y: 0, z: -10, alpha: 1, scale: 1, rotate: 0, blend: 0, image: 'assets/bg.png' },
        {
          id: 1,
          graphId: 0,
          x: 0,
          y: 0,
          z: 0,
          alpha: 1,
          scale: 1,
          rotate: 0,
          blend: 0,
          image: 'assets/bg.png',
          face: { image: 'assets/broken-face.png', x: 0, y: 0, width: 1, height: 1, bodyWidth: 1, bodyHeight: 1 },
        },
      ],
      async (url) => {
        loaded.push(url);
        if (url.endsWith('broken-face.png')) {
          throw new Error('decode failed');
        }
        return `texture:${url}`;
      },
    );

    expect(loaded).toEqual(['assets/bg.png', 'assets/broken-face.png']);
    expect(textures.get('assets/bg.png')).toBe('texture:assets/bg.png');
    expect(textures.has('assets/broken-face.png')).toBe(false);
  });

  it('projects imported portrait dimensions, face overlay and loc alignment', () => {
    let state = emptyState();
    const startId = state.document.startNodeId;
    state = applyCommand(state, addNode(bssetNode({
      character: 'クロ',
      pose: 0,
      costume: 1,
      expression: 26,
      loc: 'm',
      z: 3,
      position: { x: 12, y: -8 },
      layer: 0,
    }), { x: 100, y: 0 })).next;
    const bsId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'connect', source: startId, target: bsId, kind2: 'next' }).next;
    const resources = {
      ...state.resources,
      characters: [{
        id: 'cro',
        name: 'クロ',
        speakFn: 4,
        image: 'assets/fallback.png',
        poses: [{
          pose: 0,
          costume: 1,
          image: 'assets/body.png',
          faces: [{ face: 26, image: 'assets/face.png' }],
          faceX: 221,
          faceY: 136,
          faceWidth: 179,
          faceHeight: 157,
          bodyWidth: 697,
          bodyHeight: 1477,
        }],
      }],
    };

    const prim = buildPreviewScript(state.document, state.header, resources).prims?.[0];
    expect(prim).toMatchObject({
      image: 'assets/body.png',
      w: 697,
      h: 1477,
      align: 'center',
      x: 12,
      y: -8,
      z: 0,
      face: { image: 'assets/face.png', x: 221, y: 136, width: 179, height: 157 },
    });
  });

  it('uses the projected IR ordering', () => {
    const state = emptyState();
    const ir = projectToIr(state.document, state.header);
    expect(ir.nodes).toHaveLength(0);
  });
});
