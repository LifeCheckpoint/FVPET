import type { Meta, StoryObj } from '@storybook/react';
import { PropertyPanel } from './PropertyPanel.js';
import { sampleState, sampleStore } from './storyFixtures.js';

const meta = {
  title: 'Views/PropertyPanel',
  component: PropertyPanel,
} satisfies Meta<typeof PropertyPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SpeakSelected: Story = {
  args: { state: sampleState(), store: sampleStore() },
};

export const Empty: Story = {
  args: { state: { ...sampleState(), selection: { nodeId: null } }, store: sampleStore() },
};
