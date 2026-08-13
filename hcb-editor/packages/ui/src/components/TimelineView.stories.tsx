import type { Meta, StoryObj } from '@storybook/react';
import { TimelineView } from './TimelineView.js';
import { sampleDocument } from './storyFixtures.js';

const meta = {
  title: 'Views/TimelineView',
  component: TimelineView,
} satisfies Meta<typeof TimelineView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    document: sampleDocument(),
    activeNodeId: 'n3',
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
