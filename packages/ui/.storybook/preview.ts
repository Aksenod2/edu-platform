import type { Preview } from '@storybook/react';
import '../src/tokens/tailwind.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'Nothing Dark',
      values: [
        { name: 'Nothing Dark', value: '#000000' },
        { name: 'Surface', value: '#0D0D0D' },
        { name: 'Elevated', value: '#161616' },
      ],
    },
    layout: 'centered',
  },
};

export default preview;
