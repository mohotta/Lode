// One stroke-icon family (16px grid, 1.5 stroke). aria-hidden: every use sits next to a text label
// or inside a control that carries an aria-label.
interface P {
  size?: number;
  className?: string;
}

function Svg({ size = 16, className, children }: P & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export const PersonIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c.6-2.4 2.6-3.7 5-3.7s4.4 1.3 5 3.7" />
  </Svg>
);

export const SparkIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3z" />
    <path d="M12.5 11v3M11 12.5h3" />
  </Svg>
);

export const LinkIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 014 4l-1 1M9 11.5l-1 1a2.8 2.8 0 01-4-4l1-1" />
  </Svg>
);

export const WarnIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 2.2L14.3 13H1.7z" />
    <path d="M8 6.5v3M8 11.3v.2" />
  </Svg>
);

export const FolderIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
  </Svg>
);

export const HashIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 2.5L5 13.5M11 2.5l-1 11M3 6h10.5M2.5 10H13" />
  </Svg>
);

export const PlusIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

export const GearIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12.70 6.29 L14.43 6.52 L14.43 9.48 L12.70 9.71 L12.53 10.11 L13.60 11.50 L11.50 13.60 L10.11 12.53 L9.71 12.70 L9.48 14.43 L6.52 14.43 L6.29 12.70 L5.89 12.53 L4.50 13.60 L2.40 11.50 L3.47 10.11 L3.30 9.71 L1.57 9.48 L1.57 6.52 L3.30 6.29 L3.47 5.89 L2.40 4.50 L4.50 2.40 L5.89 3.47 L6.29 3.30 L6.52 1.57 L9.48 1.57 L9.71 3.30 L10.11 3.47 L11.50 2.40 L13.60 4.50 L12.53 5.89Z" />
    <circle cx="8" cy="8" r="2.1" />
  </Svg>
);

export const ChevronDownIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.5 6.5L8 10l3.5-3.5" />
  </Svg>
);

export const ChevronRightIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6.5 4.5L10 8l-3.5 3.5" />
  </Svg>
);

export const DotsIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
  </Svg>
);

export const VaultIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
    <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
  </Svg>
);

export const CheckIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
);

export const TrashIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Svg>
);

export const PencilIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
  </Svg>
);

export const ReturnIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12.5 3.5v4a2 2 0 01-2 2H4M6.5 7L4 9.5 6.5 12" />
  </Svg>
);

export const SunIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.3M8 13.2v1.3M14.5 8h-1.3M2.8 8H1.5M12.6 3.4l-.9.9M4.3 11.7l-.9.9M12.6 12.6l-.9-.9M4.3 4.3l-.9-.9" />
  </Svg>
);

export const MoonIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" />
  </Svg>
);

export const MonitorIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="8" rx="1.5" />
    <path d="M6 13.5h4" />
  </Svg>
);

export const CloseIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const NoteIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 2.5h5.5L12 5v8.5H4z" />
    <path d="M6 7.5h4M6 10h4" />
  </Svg>
);

export const CalendarIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
    <path d="M2.5 7h11M5.5 2v3M10.5 2v3" />
  </Svg>
);

export const ArrowLeftIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M13 8H3.5M7.5 4L3.5 8l4 4" />
  </Svg>
);

export const ArrowRightIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 8h9.5M8.5 4l4 4-4 4" />
  </Svg>
);

export const RefreshIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M13 8a5 5 0 01-8.9 3.1M3 8a5 5 0 018.9-3.1" />
    <path d="M12.5 2.5v2.8H9.7M3.5 13.5v-2.8h2.8" />
  </Svg>
);

export const UndoIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5.5 3.5L2.5 6.5l3 3" />
    <path d="M2.5 6.5h6.5a4 4 0 010 8H6" />
  </Svg>
);

export const CopyIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4A1.5 1.5 0 009 2.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5" />
  </Svg>
);

export const MinimizeIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 12.5h9" />
  </Svg>
);

export const ReviewIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2.5 8a5.5 5.5 0 109.6-3.7" />
    <path d="M12.5 2.5v2.3h-2.3M8 5v3.2l2 1.3" />
  </Svg>
);

export const SearchIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3 3" />
  </Svg>
);

export const DigestIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5 6h6M5 8.5h6M5 11h3.5" />
  </Svg>
);

export const GridIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </Svg>
);

export const ListIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
  </Svg>
);
