import type { Meta, StoryObj } from '@storybook/react';
import { ResourceManager } from './ResourceManager.js';
import { sampleState, sampleStore } from './storyFixtures.js';

const meta = {
  title: 'Views/ResourceManager',
  component: ResourceManager,
} satisfies Meta<typeof ResourceManager>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { state: sampleState(), store: sampleStore(), onClose: () => undefined },
};
