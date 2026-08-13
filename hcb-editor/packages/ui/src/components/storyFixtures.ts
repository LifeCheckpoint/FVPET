/**
 * Storybook 专用夹具：构造合法的 EditorDocument / EditorState / EditorStore。
 * 不参与生产代码路径（只被 *.stories.tsx 引用）。
 */

import {
  createProject,
  diaNode,
  EditorStore,
  labelNode,
  selsetNode,
  speakNode,
  type EditorDocument,
  type EditorState,
  type DocEdge,
  type DocNode,
} from '@hcb-editor/editor';

/** 构造一个线性剧情文档：START → speak → dia → selset，串 next 边。 */
export function sampleDocument(): EditorDocument {
  const nodes: readonly DocNode[] = [
    { id: 'start', node: labelNode('开始'), x: 0, y: 0 },
    { id: 'n2', node: speakNode('千和', '春天，樱花开了。', { alias: 'ちなつ' }), x: 240, y: 0 },
    { id: 'n3', node: diaNode('夜色降临，小镇安静下来。'), x: 480, y: 0 },
    { id: 'n4', node: selsetNode([{ text: '继续等待', label: 'wait' }, { text: '转身离开', label: 'leave' }]), x: 720, y: 0 },
  ];

  const edges: readonly DocEdge[] = [
    { id: 'e1', source: 'start', target: 'n2', kind: 'next' },
    { id: 'e2', source: 'n2', target: 'n3', kind: 'next' },
    { id: 'e3', source: 'n3', target: 'n4', kind: 'next' },
  ];

  return { nodes, edges, startNodeId: 'start' };
}

/** 构造带选中态的工程状态（选中 speak 节点 n2，含示例资源表）。 */
export function sampleState(): EditorState {
  const base = createProject({ game: 'sakura-moyu', nls: 'sjis' });
  return {
    ...base,
    document: sampleDocument(),
    resources: {
      characters: [
        { id: 'c1', name: '千和', alias: 'ちなつ', speakFn: 19542, pose: 1, costume: 0, face: 0 },
        { id: 'c2', name: '夜', speakFn: 19650, pose: 0, costume: 1, face: 2 },
      ],
      backgrounds: [
        { id: 'b1', name: '教室', variant: 0, bgFn: 226337 },
        { id: 'b2', name: '樱花道', variant: 1, bgFn: 226340 },
      ],
      audios: [
        { id: 'a1', type: 'bgm', number: 7, label: '片头曲' },
        { id: 'a2', type: 'se', number: 3, label: '开门声' },
      ],
    },
    selection: { nodeId: 'n2' },
    nextId: 5,
  };
}

/** 构造一个 headless store，供需要 store 的组件使用。 */
export function sampleStore(): EditorStore {
  return new EditorStore(sampleState());
}
