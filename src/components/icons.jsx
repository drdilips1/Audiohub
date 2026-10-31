const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.35-4.35',
  library: 'M4 4h3v16H4zM9.5 4h3v16h-3zM15 4.8l2.9-.8 4 15.4-2.9.8z',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.4-2.1.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.4-1.4L14.2 2h-4l-.4 2.6a7 7 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.4 1.4l.4 2.6h4l.4-2.6a7 7 0 0 0 2.4-1.4l2.4 1 2-3.4z',
  play: 'M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  back: 'M15 5l-7 7 7 7',
  down: 'M5 9l7 7 7-7',
  up: 'M5 15l7-7 7 7',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  next: 'M5 5l10 7-10 7zM17 5h2v14h-2z',
  prev: 'M19 5 9 12l10 7zM5 5h2v14H5z',
  plus: 'M12 5v14M5 12h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.6v.4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  heart: 'M12 20s-7.5-4.6-9.3-9.4C1.5 7.1 3.8 4 7 4c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.2 0 5.5 3.1 4.3 6.6C19.5 15.4 12 20 12 20z',
  book: 'M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h13v-4',
  headphones: 'M3 14v-2a9 9 0 0 1 18 0v2M3 14h3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm18 0h-3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  chart: 'M4 20h16M7 16v-5M12 16V6M17 16v-8',
  chevron: 'M9 6l6 6-6 6',
  car: 'M5 11l1.6-4.4A2 2 0 0 1 8.5 5.3h7a2 2 0 0 1 1.9 1.3L19 11M3.5 11h17a.5.5 0 0 1 .5.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5.5a.5.5 0 0 1 .5-.5zM5 18v2h3v-2M16 18v2h3v-2M6.5 14.5h2M15.5 14.5h2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  replay: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4',
  close: 'M6 6l12 12M18 6 6 18',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  puzzle: 'M10 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h-2a2 2 0 0 0 0 4h2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 0 0-4 0v2H6a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  palette: 'M12 3a9 9 0 0 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 11h.01M10 7h.01M15 7h.01',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  alert: 'M12 3 2 20h20zM12 10v4M12 17v.01',
  cloud: 'M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 17.8 9.1 4.5 4.5 0 0 1 17.5 18z',
  database: 'M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zM4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  sparkle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  ai: 'M5 5h14v10H10l-5 4zM9 10h.01M12 10h.01M15 10h.01',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  scale: 'M12 4v16M8 20h8M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  covers: 'M3 3h5v5H3zM9.5 3h5v5h-5zM16 3h5v5h-5zM3 9.5h5v5H3zM9.5 9.5h5v5h-5zM16 9.5h5v5h-5zM3 16h5v5H3zM9.5 16h5v5h-5zM16 16h5v5h-5z',
  shelves: 'M3 9h18M3 15h18M3 21h18M5 9V4h3v5M10 9V5h3v4M16 15v-5h3v5M5 15v-4h3v4M11 21v-4h3v4M16 21v-5h3v5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  xray: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7.5 17a4.5 4.5 0 0 1 9 0',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  upload: 'M12 16V5m0 0-4 4m4-4 4 4M5 20h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  podcast: 'M12 7.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM12 13.5V21M8 14a5.5 5.5 0 1 1 8 0M5.2 16.8a9.5 9.5 0 1 1 13.6 0',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  flame: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7z',
};

export function Icon({ name, size = 22, fill = false, stroke = 2, class: cls, style }) {
  const solid = fill || name === 'play' || name === 'pause' || name === 'next' || name === 'prev';
  return (
    <svg
      class={'icon ' + (cls || '')}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={P[name]} />
    </svg>
  );
}

export function SkipIcon({ seconds, forward, size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      {forward ? <path d="M24 9a11 11 0 1 0 3 7.5M24 3v6h-6" /> : <path d="M8 9a11 11 0 1 1-3 7.5M8 3v6h6" />}
      <text x="16" y="20.5" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">
        {seconds}
      </text>
    </svg>
  );
}
