/** Design tokens as typed JS constants — mirrors tokens.css */

export const fontFamily = {
  display: "'Cormorant Garamond', Georgia, serif",
  body: "'Instrument Sans', system-ui, sans-serif",
  mono: "'Space Grotesk', monospace",
} as const;

export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem',
  '4xl': '2.25rem',
  '5xl': '3rem',
  '6xl': '3.75rem',
  '7xl': '4.5rem',
} as const;

export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
  30: '120px',
} as const;

export const easing = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  outQuint: 'cubic-bezier(0.22, 1, 0.36, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

export const duration = {
  instant: '0s',
  fast: '0.15s',
  base: '0.3s',
  slow: '0.6s',
  slower: '0.8s',
  slowest: '1.2s',
} as const;

/** OKLCH color palette */
export const color = {
  ink: 'oklch(10% 0 0)',
  charcoal: 'oklch(25% 0 0)',
  ash: 'oklch(55% 0 0)',
  mist: 'oklch(92% 0 0)',
  cream: 'oklch(96% 0.005 350)',
  paper: 'oklch(98% 0 0)',
  white: 'oklch(99.5% 0 0)',
  accent: 'oklch(60% 0.25 350)',
  accentHover: 'oklch(52% 0.25 350)',
  accentDim: 'oklch(60% 0.25 350 / 0.15)',
  accentSoft: 'oklch(60% 0.25 350 / 0.25)',
  accentText: 'oklch(45% 0.22 350)',
} as const;

export const accentScale = {
  1: 'oklch(22% 0.15 350)',
  2: 'oklch(33% 0.20 350)',
  3: 'oklch(42% 0.23 350)',
  4: 'oklch(52% 0.25 350)',
  5: 'oklch(60% 0.25 350)',
  6: 'oklch(68% 0.22 350)',
  7: 'oklch(76% 0.18 350)',
  8: 'oklch(84% 0.12 350)',
  9: 'oklch(94% 0.05 350)',
} as const;

export const shadow = {
  none: 'none',
  sm: '0 1px 3px rgba(0, 0, 0, 0.06)',
  md: '0 4px 24px -4px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06)',
  lg: '0 20px 40px rgba(0, 0, 0, 0.08)',
  accent: '0 20px 60px oklch(60% 0.25 350 / 0.15)',
} as const;

export const radius = {
  none: '0',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;
