import type { Meta, StoryObj } from '@storybook/react';
import {
  audioNode,
  bgsetNode,
  branchNode,
  bssetNode,
  commentNode,
  diaNode,
  labelNode,
  rawNode,
  selsetNode,
  speakNode,
  threadNode,
  type DocNode,
} from '@hcb-editor/editor';
import { NodeCard } from './NodeCard.js';

function card(node: DocNode['node'], id = 'demo'): DocNode {
  return { id, node, x: 0, y: 0 };
}

const meta = {
  title: 'Components/NodeCard',
  component: NodeCard,
  args: { selected: false },
} satisfies Meta<typeof NodeCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Label: Story = { args: { node: card(labelNode('start')) } };
export const Speak: Story = { args: { node: card(speakNode('千和', '春天，樱花开了。', { alias: 'ちなつ', voice: 12 })) } };
export const Dia: Story = { args: { node: card(diaNode('夜色降临，小镇安静下来。')) } };
export const Bgset: Story = { args: { node: card(bgsetNode('bg_240', { variant: 1, transition: 'fade' })) } };
export const Bsset: Story = {
  args: {
    node: card(
      bssetNode({ character: '千和', pose: 1, costume: 0, expression: 2, position: { x: 0, y: 0 }, layer: 1 }),
    ),
  },
};
export const Selset: Story = {
  args: { node: card(selsetNode([{ text: '继续等待', label: 'wait' }, { text: '转身离开', label: 'leave' }])) },
};
export const Audio: Story = { args: { node: card(audioNode('bgm', 7, { loop: true })) } };
export const Branch: Story = { args: { node: card(branchNode({ op: 'eq', a: 0, b: 0 }, 'end', 'alt')) } };
export const Thread: Story = { args: { node: card(threadNode(3, 'side_story')) } };
export const Comment: Story = { args: { node: card(commentNode('// 这里是批注')) } };
export const Raw: Story = { args: { node: card(rawNode(new Uint8Array([0x00, 0x01, 0x02, 0x03]))) } };

export const Selected: Story = { args: { node: card(speakNode('千和', '被选中的台词卡')), selected: true } };
