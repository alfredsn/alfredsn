// The community canvas: a 24×24 grid anyone can paint one cell of by opening an issue.
// State lives in data/canvas.json; this module reads it, applies a move, and draws it.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { card, cardTitle, esc } from './theme.mjs';

export const SIZE = 24;
export const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWX'.split('');
export const CANVAS_FILE = resolve(process.cwd(), 'data/canvas.json');

// Same swatches in both themes so a drawing looks the same to everyone.
export const PALETTE = {
  orange: '#FF7043',
  red: '#FF453A',
  yellow: '#FFD60A',
  green: '#30D158',
  sky: '#64D2FF',
  blue: '#0A84FF',
  purple: '#BF5AF2',
  pink: '#FF6FAE',
  white: '#FFFFFF',
  black: '#000000',
};

export async function loadCanvas() {
  try {
    return JSON.parse(await readFile(CANVAS_FILE, 'utf8'));
  } catch {
    return { pixels: {}, log: [] };
  }
}

export async function saveCanvas(state) {
  await mkdir(dirname(CANVAS_FILE), { recursive: true });
  await writeFile(CANVAS_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** "F7", "f 7", "F-07" -> "F7"; null when it is not a real cell. */
export function parseCell(text) {
  const m = /\b([A-Xa-x])\s*-?\s*0*(\d{1,2})\b/.exec(text || '');
  if (!m) return null;
  const row = Number(m[2]);
  if (row < 1 || row > SIZE) return null;
  return `${m[1].toUpperCase()}${row}`;
}

/** Accepts a palette name anywhere in the text, or "erase". */
export function parseColor(text) {
  const words = String(text || '').toLowerCase();
  if (/\berase\b/.test(words)) return 'erase';
  return Object.keys(PALETTE).find((name) => new RegExp(`\\b${name}\\b`).test(words)) ?? null;
}

export function place(state, { cell, color, by, at }) {
  if (color === 'erase') delete state.pixels[cell];
  else state.pixels[cell] = { color, by, at };
  state.log = [{ cell, color, by, at }, ...(state.log || [])].slice(0, 50);
  return state;
}

const cellXY = (cell) => [COLUMNS.indexOf(cell[0]), Number(cell.slice(1)) - 1];

export function renderCanvas(state, t, today) {
  const W = 880;
  const pitch = 14;
  const size = 12;
  const gx = 56;
  const gy = 104;
  const gridPx = SIZE * pitch - (pitch - size);
  const H = gy + gridPx + 40;

  const painted = Object.entries(state.pixels);
  const people = new Set(painted.map(([, p]) => p.by)).size;
  const last = state.log?.[0];

  const cells = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const cell = `${COLUMNS[x]}${y + 1}`;
      const p = state.pixels[cell];
      const fill = p ? PALETTE[p.color] : t.empty;
      // A hairline keeps white pixels visible on the light card and black ones on the dark card.
      const edge = p && (p.color === 'white' || p.color === 'black') ? ` stroke="${t.separator}" stroke-width="1"` : '';
      cells.push(
        `<rect class="pop" style="animation-delay:${Math.round((x + y) * 18)}ms" x="${gx + x * pitch}" y="${gy + y * pitch}" width="${size}" height="${size}" rx="2.5" fill="${fill}"${edge}/>`
      );
    }
  }

  const colLabels = COLUMNS.map(
    (c, i) =>
      `<text x="${gx + i * pitch + size / 2}" y="${gy - 8}" text-anchor="middle" font-size="9" fill="${t.tertiary}">${c}</text>`
  ).join('');
  const rowLabels = Array.from(
    { length: SIZE },
    (_, i) => `<text x="${gx - 8}" y="${gy + i * pitch + 9}" text-anchor="end" font-size="9" fill="${t.tertiary}">${i + 1}</text>`
  ).join('');

  let ping = '';
  if (last && state.pixels[last.cell]) {
    const [x, y] = cellXY(last.cell);
    ping = `<rect class="ping" x="${gx + x * pitch - 1}" y="${gy + y * pitch - 1}" width="${size + 2}" height="${size + 2}" rx="3.5" fill="none" stroke="${t.label}" stroke-width="1.5"/>`;
  }

  // Right column: what happened, then how to join in.
  const sx = gx + gridPx + 48;
  const swatches = Object.entries(PALETTE)
    .map(([name, color], i) => {
      const x = sx + (i % 4) * 92;
      const y = gy + 152 + Math.floor(i / 4) * 28;
      const edge = name === 'white' || name === 'black' ? ` stroke="${t.separator}"` : '';
      return `<rect x="${x}" y="${y}" width="14" height="14" rx="3.5" fill="${color}"${edge}/><text x="${x + 22}" y="${y + 11}" font-size="12" fill="${t.secondary}">${name}</text>`;
    })
    .join('\n    ');

  const lastLine = last
    ? `@${last.by} ${last.color === 'erase' ? 'erased' : `painted ${last.color} at`} ${last.cell}`
    : 'Nothing painted yet';

  const body = `${cardTitle(t, 'Community canvas', `Anyone can paint one cell. Updated ${today}`)}
  <g>${colLabels}${rowLabels}</g>
  <g>
    ${cells.join('\n    ')}
  </g>
  ${ping}
  <g class="rise" style="animation-delay:500ms">
    <text x="${sx}" y="${gy + 24}" font-size="28" font-weight="600" letter-spacing="-0.4" fill="${t.label}">${painted.length}</text>
    <text x="${sx}" y="${gy + 46}" font-size="13" fill="${t.secondary}">pixels painted by ${people} ${people === 1 ? 'person' : 'people'}</text>
    <text x="${sx}" y="${gy + 84}" font-size="12" font-weight="600" fill="${t.label}">Latest</text>
    <text x="${sx}" y="${gy + 104}" font-size="13" fill="${t.secondary}">${esc(lastLine)}</text>
    <text x="${sx}" y="${gy + 136}" font-size="12" font-weight="600" fill="${t.label}">Colors</text>
    ${swatches}
    <text x="${sx}" y="${gy + 244}" font-size="13" fill="${t.secondary}">Pick a cell and a color, then press Create.</text>
    <text x="${sx}" y="${gy + 264}" font-size="13" fill="${t.secondary}">A bot paints it within a minute.</text>
  </g>`;

  return card(W, H, t, `Community canvas with ${painted.length} painted pixels. ${lastLine}.`, body);
}
