const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24', 'aria-hidden': true };

export const HomeIcon = () => (
  <svg {...base}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /></svg>
);
export const InboxIcon = () => (
  <svg {...base}><path d="M4 5h16v14H4z" /><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" /></svg>
);
export const PeopleIcon = () => (
  <svg {...base}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.7-3.2 3-5 5.5-5s4.8 1.8 5.5 5" /><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.6.6 2.7 2.2 3 4.7" /></svg>
);
export const ChartIcon = () => (
  <svg {...base}><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></svg>
);
export const GearIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);
export const SendIcon = () => (
  <svg {...base}><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
);
export const BackIcon = () => (
  <svg {...base}><path d="M15 5l-7 7 7 7" /></svg>
);
export const PauseIcon = () => (
  <svg {...base}><path d="M9 5v14M15 5v14" /></svg>
);
export const PlayIcon = () => (
  <svg {...base}><path d="M7 5l12 7-12 7z" /></svg>
);
export const StopIcon = () => (
  <svg {...base}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const PlusIcon = () => (
  <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
);
