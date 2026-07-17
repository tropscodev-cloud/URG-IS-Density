export type RGBA = [number, number, number, number];

// Mirrors the CSS custom properties in index.css — deck.gl needs raw numeric arrays, so these
// are kept in one place and must be updated alongside the CSS palette if it ever changes.
export const SEVERITY_COLOR: Record<0 | 1 | 2, RGBA> = {
  0: [34, 197, 94, 220],
  1: [234, 179, 8, 230],
  2: [244, 63, 94, 240],
};

export const STATUS_COLOR: Record<string, RGBA> = {
  ONLINE: [34, 197, 94, 220],
  DEGRADED: [234, 179, 8, 220],
  RECONNECTING: [168, 85, 247, 220],
  OFFLINE: [113, 113, 122, 180],
  MISCONFIGURED: [244, 63, 94, 220],
  DISABLED: [82, 82, 91, 160],
};

/** Green → yellow → orange → dark red, matching the on-map legend exactly. */
export const HEATMAP_COLOR_RANGE: RGBA[] = [
  [34, 197, 94, 0],
  [34, 197, 94, 180],
  [234, 179, 8, 200],
  [249, 115, 22, 220],
  [153, 27, 27, 240],
];

export const HEATMAP_THRESHOLDS = [
  { label: 'Low', color: 'rgb(34,197,94)' },
  { label: 'Moderate', color: 'rgb(234,179,8)' },
  { label: 'High', color: 'rgb(249,115,22)' },
  { label: 'Critical', color: 'rgb(153,27,27)' },
];
