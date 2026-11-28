// One visual system for every SVG on the profile: tokens, type, motion, and the card frame.
// Change a value here and every card, button, and the canvas follow on the next build.

// Semantic tokens, Apple-style: labels step down in three levels, and dark mode lifts the
// card one step above GitHub's canvas instead of inverting it. `page` is GitHub's own
// background, used where a graphic sits directly on the page (the snake, buttons).
export const THEMES = {
  light: {
    page: '#FFFFFF',
    card: '#FFFFFF',
    stroke: '#D0D7DE',
    label: '#1D1D1F',
    secondary: '#6E6E73',
    tertiary: '#8E8E93',
    separator: '#E5E5EA',
    empty: '#F2F2F7',
    accent: '#F4511E',
    onAccent: '#FFFFFF',
  },
  dark: {
    page: '#0D1117',
    card: '#161B22',
    stroke: '#30363D',
    label: '#F5F5F7',
    secondary: '#A1A1A6',
    tertiary: '#7D7D84',
    separator: '#30363D',
    empty: '#21262D',
    accent: '#FF7043',
    onAccent: '#FFFFFF',
  },
};

/** Opacity of the accent at each activity level; level 0 uses `empty`. */
export const LEVELS = [0, 0.32, 0.55, 0.78, 1];

export const FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI Variable Display','Segoe UI',system-ui,Roboto,'Helvetica Neue',Arial,sans-serif";

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// ---------------------------------------------------------------- color math

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** `fg` laid over `bg` at opacity `a`, as an opaque color. */
export const mix = (fg, bg, a) => {
  const f = rgb(fg);
  const b = rgb(bg);
  return hex(f.map((v, i) => b[i] + (v - b[i]) * a));
};

/** Multiply toward black; used for the shaded faces of the city. */
export const shade = (color, k) => hex(rgb(color).map((v) => v * k));

/** Opaque fill for an activity level on a given surface. */
export const levelColor = (t, level, surface = t.card) => (level ? mix(t.accent, surface, LEVELS[level]) : t.empty);

// ---------------------------------------------------------------- type

/** Rough advance width for the system UI stack. Used only to size pills, so it errs wide. */
export const textWidth = (s, size, weight = 400) =>
  [...String(s)].reduce((w, ch) => w + (/[ il.,·'!|:]/.test(ch) ? 0.3 : /[A-Z0-9mwMW@]/.test(ch) ? 0.68 : 0.55), 0) *
  size *
  (weight >= 600 ? 1.04 : 1);

// ---------------------------------------------------------------- motion

// One easing family: a soft ease-out for entrances, a slight overshoot for things that pop.
export const STYLE = `
    text { font-family: ${FONT}; font-variant-numeric: tabular-nums; }
    .rise { animation: rise 900ms cubic-bezier(.22,1,.36,1) both; }
    .pop  { animation: pop 520ms cubic-bezier(.34,1.4,.64,1) both; transform-box: fill-box; transform-origin: center; }
    .grow { animation: grow 900ms cubic-bezier(.34,1.25,.64,1) both; transform-box: fill-box; transform-origin: 50% 100%; }
    .fill { animation: fill 1100ms cubic-bezier(.22,1,.36,1) both; transform-box: fill-box; transform-origin: 0 50%; }
    .ping { animation: ping 2.2s cubic-bezier(.22,1,.36,1) 1.6s infinite both; transform-box: fill-box; transform-origin: center; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    @keyframes pop  { from { opacity: 0; transform: scale(.3); } }
    @keyframes grow { from { transform: scaleY(0); } }
    @keyframes fill { from { transform: scaleX(0); } }
    @keyframes ping { 0% { opacity: .8; transform: scale(1); } 70%, 100% { opacity: 0; transform: scale(2.4); } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`;

/** Every card shares this frame: 16px continuous-ish corners, hairline stroke, one surface. */
export const card = (W, H, t, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
  <style>${STYLE}
  </style>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="16" fill="${t.card}" stroke="${t.stroke}"/>
${body}
</svg>
`;

/** Section title + subtitle used at the top of every card, so they all read the same way. */
export const cardTitle = (t, title, subtitle) => `  <g class="rise">
    <text x="32" y="45" font-size="17" font-weight="600" letter-spacing="-0.2" fill="${t.label}">${esc(title)}</text>
    ${subtitle ? `<text x="32" y="66" font-size="12" fill="${t.tertiary}">${esc(subtitle)}</text>` : ''}
  </g>`;

/**
 * A button as an image, so README links look like real controls.
 * `primary` is the filled accent; anything else is the quiet outlined style.
 */
export function button(t, label, { primary = false, icon = '' } = {}) {
  const H = 40;
  const size = 14;
  const iconW = icon ? 22 : 0;
  const W = Math.ceil(textWidth(label, size, 600) + 40 + iconW);
  const fg = primary ? t.onAccent : t.label;
  const glyph = icon ? `<path d="${ICONS[icon]}" transform="translate(18 ${H / 2 - 8})" fill="none" stroke="${fg}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
  <style>text { font-family: ${FONT}; }</style>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="${(H - 1) / 2}" fill="${primary ? t.accent : t.page}" stroke="${
    primary ? t.accent : t.stroke
  }"/>
  ${glyph}
  <text x="${(W + iconW) / 2}" y="${H / 2 + 5}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${fg}">${esc(label)}</text>
</svg>
`;
}

// 16×16 line icons, drawn on the same stroke as the buttons.
const ICONS = {
  spark: 'M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1',
  pixel: 'M2 2h5v5H2zM9 9h5v5H9zM9 2h5v5H9z',
  pen: 'M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3',
  arrow: 'M3 8h10M9 4l4 4-4 4',
};
