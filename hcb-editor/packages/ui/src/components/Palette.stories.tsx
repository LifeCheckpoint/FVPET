import type { Meta, StoryObj } from '@storybook/react';
import { Palette } from './Palette.js';

const meta = {
  title: 'Components/Palette',
  component: Palette,
} satisfies Meta<typeof Palette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onAdd: () => undefined,
    onOpenResources: () => undefined,
  },
};
