/**
 * 节点种类图标：流程图节点卡片与调色板共用，保持同一套视觉语言。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';

const iconProps = {
  width: 13,
  height: 13,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function KindIcon({ kind }: { readonly kind: IrNode['kind'] }) {
  switch (kind) {
    case 'label':
      return (
        <svg {...iconProps}>
          <path d="M3.5 2.5h6.5l2.5 2.5v8.5h-9z" />
        </svg>
      );
    case 'speak':
      return (
        <svg {...iconProps}>
          <path d="M2.5 4.5h11v6h-5.5l-3 2.5v-2.5h-2.5z" />
        </svg>
      );
    case 'dia':
      return (
        <svg {...iconProps}>
          <path d="M2.5 6.5h11M2.5 9.5h8" />
        </svg>
      );
    case 'bgset':
      return (
        <svg {...iconProps}>
          <path d="M2.5 12.5 6 7l2.5 3 2-2.5 3 5" />
        </svg>
      );
    case 'bsset':
      return (
        <svg {...iconProps}>
          <circle cx="8" cy="4.5" r="2" />
          <path d="M4 13.5c0-2.5 1.8-4 4-4s4 1.5 4 4" />
        </svg>
      );
    case 'selset':
      return (
        <svg {...iconProps}>
          <path d="M3.5 4h9M3.5 8h9M3.5 12h5.5" />
        </svg>
      );
    case 'audio':
      return (
        <svg {...iconProps}>
          <path d="M6 11.5V3l6-1.5v8.5" />
          <circle cx="4.5" cy="11.5" r="1.6" />
          <circle cx="10.5" cy="10" r="1.6" />
        </svg>
      );
    case 'branch':
      return (
        <svg {...iconProps}>
          <path d="M8 2.5 13 8 8 13.5 3 8Z" />
        </svg>
      );
    case 'thread':
      return (
        <svg {...iconProps}>
          <path d="M8 2.5v11M8 7.5 3.5 4.5M8 7.5l4.5-3" />
        </svg>
      );
    case 'jump':
      return (
        <svg {...iconProps}>
          <path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" />
        </svg>
      );
    case 'raw':
      return (
        <svg {...iconProps}>
          <rect x="3.5" y="6.5" width="9" height="7" rx="1" />
          <path d="M5.5 6.5V5a2.5 2.5 0 0 1 5 0v1.5" />
        </svg>
      );
    case 'comment':
      return (
        <svg {...iconProps}>
          <path d="m9.5 2.5-3 11M11 2.5l-3 11" />
        </svg>
      );
  }
}
