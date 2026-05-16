export const palette = {
  light: {
    background: '#f9f5d7', // Soft Cream Paper
    backgroundAccent: '#f2e5bc',
    surface: '#ffffff',
    surfaceStrong: '#ebdbb2',
    border: '#3c3836', // Darker, sharper borders
    text: '#282828',
    textSoft: '#7c6f64',
    accent: '#af3a03', // Deep Vermilion
    accentStrong: '#9d0006',
    success: '#79740e',
    info: '#076678', // Deep Blue
    danger: '#9d0006',
    reader: '#fbf1c7',
    shadow: 'rgba(40, 40, 40, 0.15)',
  },
  dark: {
    background: '#1d2021', // Deep Charcoal
    backgroundAccent: '#282828',
    surface: '#3c3836',
    surfaceStrong: '#504945',
    border: '#ebdbb2',
    text: '#fbf1c7',
    textSoft: '#d5c4a1',
    accent: '#fabd2f', // Gold
    accentStrong: '#fe8019',
    success: '#b8bb26',
    info: '#83a598',
    danger: '#fb4934',
    reader: '#282828',
    shadow: 'rgba(0, 0, 0, 0.4)',
  },
} as const;

export const spacing = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
} as const;


