import type { Meta, StoryObj } from '@storybook/react';
import { DEFAULT_PREFERENCES } from '../preferences/preferences.js';
import { Settings } from './Settings.js';

const meta = {
  title: 'Components/Settings',
  component: Settings,
} satisfies Meta<typeof Settings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    prefs: DEFAULT_PREFERENCES,
    update: () => undefined,
    onClose: () => undefined,
  },
};

export const LightAutoCompile: Story = {
  args: {
    prefs: { ...DEFAULT_PREFERENCES, theme: 'light', autoCompile: true },
    update: () => undefined,
    onClose: () => undefined,
  },
};
