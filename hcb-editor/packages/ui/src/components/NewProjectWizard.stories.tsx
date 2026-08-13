import type { Meta, StoryObj } from '@storybook/react';
import { NewProjectWizard } from './NewProjectWizard.js';
import { sampleStore } from './storyFixtures.js';

const meta = {
  title: 'Components/NewProjectWizard',
  component: NewProjectWizard,
} satisfies Meta<typeof NewProjectWizard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    store: sampleStore(),
    defaultNls: 'sjis',
    onClose: () => undefined,
  },
};
