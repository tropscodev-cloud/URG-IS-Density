import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          canvas: 'rgb(var(--color-bg-canvas) / <alpha-value>)',
          surface: 'rgb(var(--color-bg-surface) / <alpha-value>)',
          raised: 'rgb(var(--color-bg-raised) / <alpha-value>)',
          overlay: 'rgb(var(--color-bg-overlay) / <alpha-value>)',
          // One step lighter than bg-surface — the stacked "card section" background (sidebar
          // zones/alerts cards, right slide-over panel sections). Deliberately its own token
          // rather than reusing bg-raised: in the light theme bg-raised === bg-surface (both
          // white), so a card needs its own subtle off-white to read as elevated at all.
          card: 'rgb(var(--color-bg-card) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
          // A near-invisible 1px separator for card edges — mixes into the card's own
          // background rather than standing out the way the default border does.
          hairline: 'rgb(var(--color-border-hairline) / <alpha-value>)',
        },
        fg: {
          primary: 'rgb(var(--color-fg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-fg-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-fg-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          fg: 'rgb(var(--color-accent-fg) / <alpha-value>)',
        },
        // Theme-appropriate mix color for hover/selected-row overlays (white-mix in dark mode,
        // ink-mix in light mode) — used at low alpha, e.g. bg-scrim/8, so the same "pill
        // highlight" recipe reads correctly in both themes instead of a hardcoded white overlay
        // disappearing against a light-theme card.
        scrim: 'rgb(var(--color-scrim) / <alpha-value>)',
        severity: {
          info: 'rgb(var(--color-severity-info) / <alpha-value>)',
          warning: 'rgb(var(--color-severity-warning) / <alpha-value>)',
          critical: 'rgb(var(--color-severity-critical) / <alpha-value>)',
        },
        status: {
          online: 'rgb(var(--color-status-online) / <alpha-value>)',
          degraded: 'rgb(var(--color-status-degraded) / <alpha-value>)',
          reconnecting: 'rgb(var(--color-status-reconnecting) / <alpha-value>)',
          offline: 'rgb(var(--color-status-offline) / <alpha-value>)',
          misconfigured: 'rgb(var(--color-status-misconfigured) / <alpha-value>)',
          disabled: 'rgb(var(--color-status-disabled) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.8' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        // Right slide-over panel entrance (Audit/Reports/Event log) — slide + fade, compositor-
        // only properties (transform/opacity), matching the card language's motion rules.
        'slide-in-right': {
          from: { transform: 'translateX(8px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
