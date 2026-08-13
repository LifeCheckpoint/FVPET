import type { Meta, StoryObj } from '@storybook/react';
import { ScriptTextView } from './ScriptTextView.js';
import { sampleDocument } from './storyFixtures.js';

const meta = {
  title: 'Views/ScriptTextView',
  component: ScriptTextView,
} satisfies Meta<typeof ScriptTextView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    document: sampleDocument(),
    activeNodeId: 'n2',
    onLocate: () => undefined,
  },
};

export const Empty: Story = {
  args: {
    document: { nodes: [], edges: [], startNodeId: 'start' },
    activeNodeId: null,
    onLocate: () => undefined,
  },
};
