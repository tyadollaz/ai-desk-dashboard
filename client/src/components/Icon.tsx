import type { ReactNode } from 'react';

export type IconName =
  | 'bus'
  | 'sun'
  | 'cloud'
  | 'cloud-sun'
  | 'rain'
  | 'storm'
  | 'calendar'
  | 'book'
  | 'activity'
  | 'heart'
  | 'home'
  | 'settings'
  | 'refresh'
  | 'eye'
  | 'eye-off'
  | 'logout'
  | 'moon'
  | 'monitor'
  | 'arrow-up-right'
  | 'sparkle'
  | 'footprints'
  | 'bed'
  | 'route';

const CLOUD = 'M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9.5a4.25 4.25 0 0 1 0 8.5Z';

const PATHS: Record<IconName, ReactNode> = {
  bus: (
    <>
      <rect x="4" y="3.5" width="16" height="14" rx="3" />
      <path d="M4 11h16M8 17.5V20M16 17.5V20" />
      <circle cx="8" cy="14.25" r=".6" />
      <circle cx="16" cy="14.25" r=".6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  cloud: <path d={CLOUD} transform="translate(0 -1)" />,
  'cloud-sun': (
    <>
      <path d="M12 3v1.5M4.6 6.1l1.1 1.1M19.4 6.1l-1.1 1.1M2.5 12H4" />
      <path d="M8 12.5a4 4 0 0 1 7.5-1.8" />
      <path d="M7.5 20a3.5 3.5 0 0 1-.4-6.98A5 5 0 0 1 16.6 13a3.5 3.5 0 0 1 0 7Z" />
    </>
  ),
  rain: (
    <>
      <path d="M7 15a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 6.5 4.25 4.25 0 0 1 17 15" />
      <path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5" />
    </>
  ),
  storm: (
    <>
      <path d="M7 15a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 6.5 4.25 4.25 0 0 1 17 15" />
      <path d="M12.5 12l-2.5 4h3l-2 4.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-13c-3.5 0-6 .5-8 2Z" />
      <path d="M12 6.5v13" />
    </>
  ),
  activity: <path d="M3 12h4l2.5-6.5 4 13L16 12h5" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z" />,
  home: <path d="M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1Z" />,
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.25" />
      <circle cx="9" cy="17" r="2.25" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1" />
      <path d="M17.5 3.5v3.7h-3.7M6.5 20.5v-3.7h3.7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 5.7A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.5A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5" />
      <path d="M15.5 7.5 20 12l-4.5 4.5M20 12H9.5" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2.5" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  'arrow-up-right': <path d="M7 17 17 7M8.5 7H17v8.5" />,
  sparkle: (
    <>
      <path d="M11 3.5 12.8 9 18.5 10.8 12.8 12.6 11 18.3 9.2 12.6 3.5 10.8 9.2 9Z" />
      <path d="M18.5 15.5v4M16.5 17.5h4" />
    </>
  ),
  footprints: (
    <>
      <path d="M8.5 4c2 0 3 1.8 3 4.2S10.5 12 8.5 12 5 10.6 5 8.2 6.5 4 8.5 4Z" />
      <path d="M6.5 15.5h4v1.5a2 2 0 0 1-2 2 2 2 0 0 1-2-2ZM15.5 8c1.7 0 3.5 1.3 3.5 3.7S17.5 16 15.5 16" />
    </>
  ),
  bed: (
    <>
      <path d="M3.5 18.5v-12M3.5 14h17v4.5M20.5 14v-2a3 3 0 0 0-3-3H11v5" />
      <circle cx="7" cy="10.5" r="1.5" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" />
    </>
  ),
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

/** Local stroke icons (1.75px). Decorative: callers label the surrounding control. */
export default function Icon({ name, size = 20, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
