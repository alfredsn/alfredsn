// Daily build for everything README.md shows, in light and dark:
//   assets/header-*.svg     identity and four stats from the contribution calendar
//   assets/city-*.svg       the past year as an isometric city, one building per day
//   assets/coding-*.svg     this week's coding time by language, from WakaTime (if connected)
//   assets/canvas-*.svg     the community canvas, from data/canvas.json
//   assets/buttons/*.svg    the call-to-action buttons
// and the WakaTime block in README.md.
//
// Every number comes from an API at build time. Nothing is typed in by hand.
// Local preview without tokens: FIXTURE=path/to/days.json OUT_DIR=/tmp/out node .github/scripts/cards.mjs

import { writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { THEMES, card, cardTitle, esc, levelColor, shade, mix, LEVELS, button } from './lib/theme.mjs';
import { loadCanvas, renderCanvas } from './lib/canvas.mjs';
import { replaceBlock } from './lib/readme.mjs';

const LOGIN = process.env.PROFILE_LOGIN || 'alfredsn';
const TOKEN = process.env.METRICS_TOKEN || process.env.GITHUB_TOKEN;
const WAKATIME_KEY = process.env.WAKATIME_API_KEY;
const OUT_DIR = resolve(process.cwd(), process.env.OUT_DIR || 'assets');
const README = resolve(process.cwd(), 'README.md');
const RAW = `https://raw.githubusercontent.com/${LOGIN}/${LOGIN}/main`;

const IDENTITY = {
  name: 'Alfred Sahala Nainggolan',
  tagline: 'Full-stack software engineer, moving into AI engineering.',
};

// Labels for the call-to-action buttons. README.md links each one.
export const BUTTONS = {
  'ask-building': { label: 'What is Alfred building?' },
  'ask-stack': { label: "What's his stack?" },
  'ask-hire': { label: 'Is he open to work?' },
  'ask-own': { label: 'Ask your own question', primary: true, icon: 'spark' },
  paint: { label: 'Paint a pixel', primary: true, icon: 'pixel' },
  sign: { label: 'Sign the guestbook', icon: 'pen' },
};

// ---------------------------------------------------------------- GitHub data

const QUERY = `
query($login: String!) {
  user(login: $login) {
    avatarUrl(size: 160)
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date weekday contributionCount } }
      }
    }
  }
}`;

async function fetchProfile() {
  if (!TOKEN) throw new Error('No GITHUB_TOKEN / METRICS_TOKEN in environment.');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-cards' },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error(`GitHub API responded ${res.status} ${res.statusText}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data?.user) throw new Error(`User "${LOGIN}" not found.`);
  const { avatarUrl, contributionsCollection: cc } = body.data.user;
  return { avatarUrl, weeks: cc.contributionCalendar.weeks, total: cc.contributionCalendar.totalContributions };
}

/** Same shape as fetchProfile, from a flat [{date, contributionCount}] list. */
async function loadFixture(path) {
  const days = JSON.parse(await readFile(path, 'utf8')).map((d) => ({ ...d, weekday: new Date(`${d.date}T00:00Z`).getUTCDay() }));
  const weeks = [];
  for (const d of days) {
    if (!weeks.length || d.weekday === 0) weeks.push({ contributionDays: [] });
    weeks.at(-1).contributionDays.push(d);
  }
  return { avatarUrl: `https://github.com/${LOGIN}.png?size=160`, weeks, total: days.reduce((s, d) => s + d.contributionCount, 0) };
}

/** Embedded as a data URI: an SVG shown through <img> cannot load anything from the network. */
async function avatarDataUri(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch {
    return null;
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const utc = (date) => new Date(`${date}T00:00:00Z`);
// en-US for the parts: en-GB abbreviates September to "Sept".
const fmt = (date, opts) => utc(date).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const longDate = (date) => `${utc(date).getUTCDate()} ${fmt(date, { month: 'short' })} ${utc(date).getUTCFullYear()}`;
const shortDate = (date) => `${utc(date).getUTCDate()} ${fmt(date, { month: 'short' })}`;

function analyse({ weeks, total }, today) {
  const days = weeks.flatMap((w) => w.contributionDays).filter((d) => d.date <= today);
  const active = days.filter((d) => d.contributionCount > 0);

  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  const byWeekday = Array(7).fill(0);
  for (const d of days) byWeekday[d.weekday] += d.contributionCount;
  const topWeekday = byWeekday.indexOf(Math.max(...byWeekday));
  const busiest = active.reduce((best, d) => (d.contributionCount > (best?.contributionCount ?? 0) ? d : best), null);

  return { total, activeDays: active.length, longest, topWeekday: active.length ? WEEKDAYS[topWeekday] : 'n/a', busiest };
}

/** GitHub-style levels: quartiles of the non-zero days, so one huge day does not wash out the rest. */
function levelFn(days) {
  const counts = days.map((d) => d.contributionCount).filter((c) => c > 0).sort((a, b) => a - b);
  if (!counts.length) return () => 0;
  const q = (p) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))];
  const [a, b, c] = [q(0.25), q(0.5), q(0.75)];
  return (n) => (n <= 0 ? 0 : n <= a ? 1 : n <= b ? 2 : n <= c ? 3 : 4);
}

const exists = (path) => access(path).then(() => true, () => false);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- header card

function renderHeader(m, t, avatar) {
  const W = 880;
  const H = 240;
  const textX = avatar ? 120 : 32;

  const stats = [
    [m.total.toLocaleString('en-US'), 'contributions, past year'],
    [m.activeDays, 'days with a commit'],
    [plural(m.longest, 'day'), 'longest streak'],
    [m.topWeekday, 'most active weekday'],
  ]
    .map(
      ([value, label], i) => `  <g class="rise" style="animation-delay:${200 + i * 90}ms">
    <text x="${32 + i * 204}" y="188" font-size="28" font-weight="600" letter-spacing="-0.4" fill="${t.label}">${esc(value)}</text>
    <text x="${32 + i * 204}" y="212" font-size="13" fill="${t.secondary}">${esc(label)}</text>
  </g>`
    )
    .join('\n');

  const body = `  <defs><clipPath id="av"><circle cx="64" cy="64" r="32"/></clipPath></defs>
${avatar ? `  <g class="rise"><image href="${avatar}" x="32" y="32" width="64" height="64" clip-path="url(#av)"/>
  <circle cx="64" cy="64" r="31.5" fill="none" stroke="${t.separator}"/></g>` : ''}
  <g class="rise" style="animation-delay:60ms">
    <text x="${textX}" y="62" font-size="30" font-weight="600" letter-spacing="-0.6" fill="${t.label}">${esc(IDENTITY.name)}</text>
    <text x="${textX}" y="88" font-size="15" fill="${t.secondary}">${esc(IDENTITY.tagline)}</text>
  </g>
  <rect x="32" y="128" width="${W - 64}" height="1" fill="${t.separator}"/>
${stats}`;

  return card(
    W,
    H,
    t,
    `${IDENTITY.name}. ${IDENTITY.tagline} ${m.total} contributions in the past year across ${m.activeDays} days, longest streak ${m.longest} days, most active on ${m.topWeekday}s.`,
    body
  );
}

// ---------------------------------------------------------------- city card

// Axonometric axes: one step along a week, one step along a weekday. Both point down the
// screen, so drawing in order of (week + weekday) paints back to front.
const AX_WEEK = [12.5, 1.3];
const AX_DAY = [-7, 5.4];
const FOOT = 0.8; // footprint share of a cell; the rest is street
const MAX_H = 56;

function renderCity(data, m, t, today) {
  const W = 880;
  const weeks = data.weeks;
  const level = levelFn(weeks.flatMap((w) => w.contributionDays));
  const peak = Math.max(1, ...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)));

  const spanX = weeks.length * AX_WEEK[0] - 7 * AX_DAY[0];
  const ox = Math.round((W - spanX) / 2 - 7 * AX_DAY[0]);
  const oy = 92 + MAX_H;
  const at = (col, row) => [ox + col * AX_WEEK[0] + row * AX_DAY[0], oy + col * AX_WEEK[1] + row * AX_DAY[1]];
  const pt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;

  const lots = [];
  weeks.forEach((w, col) =>
    w.contributionDays.forEach((d) => {
      if (d.date <= today) lots.push({ col, row: d.weekday, d });
    })
  );
  lots.sort((a, b) => a.col + a.row - (b.col + b.row) || a.col - b.col);

  let pin = '';
  const buildings = lots.map(({ col, row, d }) => {
    const lv = level(d.contributionCount);
    const h = lv ? 6 + (MAX_H - 6) * Math.sqrt(d.contributionCount / peak) : 1.5;
    const top = levelColor(t, lv);
    const p0 = at(col, row);
    const p1 = [p0[0] + FOOT * AX_WEEK[0], p0[1] + FOOT * AX_WEEK[1]];
    const p3 = [p0[0] + FOOT * AX_DAY[0], p0[1] + FOOT * AX_DAY[1]];
    const p2 = [p1[0] + FOOT * AX_DAY[0], p1[1] + FOOT * AX_DAY[1]];
    const up = ([x, y]) => [x, y - h];
    const delay = Math.round(col * 14 + row * 8);

    if (m.busiest && d.date === m.busiest.date) {
      const [tx, ty] = up([(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2]);
      const label = `${d.contributionCount} on ${shortDate(d.date)}`;
      pin = `<g class="rise" style="animation-delay:1500ms">
    <line x1="${tx.toFixed(1)}" y1="${(ty - 3).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(ty - 26).toFixed(1)}" stroke="${t.label}" stroke-width="1"/>
    <circle cx="${tx.toFixed(1)}" cy="${(ty - 28).toFixed(1)}" r="2.5" fill="${t.label}"/>
    <text x="${(tx + 7).toFixed(1)}" y="${(ty - 24).toFixed(1)}" font-size="11" font-weight="600" fill="${t.label}">${esc(label)}</text>
  </g>`;
    }

    return `<g class="grow" style="animation-delay:${delay}ms">
      <polygon points="${[p3, p2, up(p2), up(p3)].map(pt).join(' ')}" fill="${shade(top, 0.62)}"/>
      <polygon points="${[p1, p2, up(p2), up(p1)].map(pt).join(' ')}" fill="${shade(top, 0.8)}"/>
      <polygon points="${[p0, p1, p2, p3].map(up).map(pt).join(' ')}" fill="${top}"/>
    </g>`;
  });

  // Month names along the front edge of the board.
  const months = [];
  let lastCol = -10;
  weeks.forEach((w, col) => {
    const first = w.contributionDays[0];
    const prev = col > 0 ? utc(weeks[col - 1].contributionDays[0].date).getUTCMonth() : -1;
    if (utc(first.date).getUTCMonth() !== prev && col - lastCol >= 3 && col < weeks.length - 1) {
      const [x, y] = at(col, 7.4);
      months.push(`<text x="${x.toFixed(1)}" y="${(y + 12).toFixed(1)}" font-size="11" fill="${t.tertiary}">${fmt(first.date, { month: 'short' })}</text>`);
      lastCol = col;
    }
  });

  const boardBottom = at(weeks.length, 7)[1];
  const notesY = Math.round(boardBottom + 40);
  const H = notesY + 76;

  const legendX = W - 32 - 5 * 14 - 34;
  const legend = LEVELS.map(
    (_, lv) => `<rect x="${legendX + lv * 14}" y="34" width="11" height="11" rx="2.5" fill="${levelColor(t, lv)}"/>`
  ).join('');

  const notes = [
    ['Busiest day', m.busiest ? `${fmt(m.busiest.date, { weekday: 'short' })} ${longDate(m.busiest.date)}, ${plural(m.busiest.contributionCount, 'contribution')}` : 'None yet'],
    ['Longest run', `${plural(m.longest, 'day')} in a row`],
    ['Rhythm', m.activeDays ? `Most work lands on ${m.topWeekday}s` : 'Quiet year'],
  ];
  const colW = (W - 64) / notes.length;
  const noteSvg = notes
    .map(
      ([k, v], i) => `<g class="rise" style="animation-delay:${1300 + i * 120}ms">
    <text x="${32 + i * colW}" y="${notesY + 22}" font-size="12" font-weight="600" fill="${t.label}">${esc(k)}</text>
    <text x="${32 + i * colW}" y="${notesY + 44}" font-size="13" fill="${t.secondary}">${esc(v)}</text>
  </g>`
    )
    .join('\n  ');

  const body = `${cardTitle(t, 'The past year, as a city', `One building per day, taller on busier days. From the GitHub API, updated ${longDate(today)}`)}
  <g class="rise">
    <text x="${legendX - 8}" y="44" text-anchor="end" font-size="11" fill="${t.tertiary}">Less</text>
    ${legend}
    <text x="${legendX + 5 * 14 + 4}" y="44" font-size="11" fill="${t.tertiary}">More</text>
  </g>
  <g>
    ${buildings.join('\n    ')}
  </g>
  <g class="rise" style="animation-delay:900ms">${months.join('')}</g>
  ${pin}
  <rect x="32" y="${notesY}" width="${W - 64}" height="1" fill="${t.separator}"/>
  ${noteSvg}`;

  return card(
    W,
    H,
    t,
    `The past year as an isometric city, one building per day. ${m.total} contributions on ${m.activeDays} days. ${notes
      .map(([k, v]) => `${k}: ${v}`)
      .join('. ')}.`,
    body
  );
}

// ---------------------------------------------------------------- coding card (WakaTime)

/** null means "not connected"; undefined means "connected but no fresh data, keep what's there". */
async function fetchWakaTime() {
  if (!WAKATIME_KEY && !process.env.WAKATIME_FIXTURE) return null;
  try {
    let data;
    if (process.env.WAKATIME_FIXTURE) {
      ({ data } = JSON.parse(await readFile(process.env.WAKATIME_FIXTURE, 'utf8')));
    } else {
      const res = await fetch('https://wakatime.com/api/v1/users/current/stats/last_7_days', {
        headers: { Authorization: `Basic ${Buffer.from(WAKATIME_KEY).toString('base64')}` },
      });
      if (!res.ok) {
        console.warn(`WakaTime responded ${res.status}; keeping the previous card.`);
        return undefined;
      }
      ({ data } = await res.json());
    }
    const languages = (data?.languages || []).filter((l) => l.total_seconds >= 60 && l.name !== 'Other').slice(0, 6);
    if (!languages.length) return undefined;
    return {
      total: data.human_readable_total_including_other_language || data.human_readable_total,
      average: data.human_readable_daily_average_including_other_language || data.human_readable_daily_average,
      languages,
    };
  } catch (err) {
    console.warn(`WakaTime request failed (${err.message}); keeping the previous card.`);
    return undefined;
  }
}

const hours = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

function renderCoding(w, t, today) {
  const W = 880;
  const rowH = 34;
  const top = 104;
  const H = top + w.languages.length * rowH + 28;
  const peak = w.languages[0].total_seconds;
  const barX = 440;
  const barW = 320;

  const rows = w.languages
    .map((l, i) => {
      const y = top + i * rowH;
      const share = l.total_seconds / peak;
      const color = mix(t.accent, t.card, LEVELS[Math.max(1, 4 - i)] ?? 0.32);
      return `<g class="rise" style="animation-delay:${200 + i * 90}ms">
    <text x="300" y="${y + 13}" font-size="13" font-weight="600" fill="${t.label}">${esc(l.name)}</text>
    <rect x="${barX}" y="${y + 2}" width="${barW}" height="14" rx="7" fill="${t.empty}"/>
    <rect class="fill" style="animation-delay:${300 + i * 90}ms" x="${barX}" y="${y + 2}" width="${Math.max(14, barW * share).toFixed(1)}" height="14" rx="7" fill="${color}"/>
    <text x="${W - 32}" y="${y + 13}" text-anchor="end" font-size="13" fill="${t.secondary}">${esc(hours(l.total_seconds))}</text>
  </g>`;
    })
    .join('\n  ');

  const body = `${cardTitle(t, 'This week in code', `Editor time by language, last 7 days. From WakaTime, updated ${longDate(today)}`)}
  <g class="rise" style="animation-delay:120ms">
    <text x="32" y="${top + 22}" font-size="28" font-weight="600" letter-spacing="-0.4" fill="${t.label}">${esc(w.total)}</text>
    <text x="32" y="${top + 46}" font-size="13" fill="${t.secondary}">coded this week</text>
    <text x="32" y="${top + 92}" font-size="20" font-weight="600" letter-spacing="-0.2" fill="${t.label}">${esc(w.average)}</text>
    <text x="32" y="${top + 114}" font-size="13" fill="${t.secondary}">daily average</text>
  </g>
  <rect x="268" y="${top - 4}" width="1" height="${w.languages.length * rowH - 12}" fill="${t.separator}"/>
  ${rows}`;

  return card(
    W,
    H,
    t,
    `${w.total} of coding this week. ${w.languages.map((l) => `${l.name} ${hours(l.total_seconds)}`).join(', ')}.`,
    body
  );
}

const picture = (name, alt) => `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${RAW}/assets/${name}-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="${RAW}/assets/${name}-light.svg">
  <img src="${RAW}/assets/${name}-light.svg" alt="${esc(alt)}" width="100%">
</picture>`;

// ---------------------------------------------------------------- main

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const data = process.env.FIXTURE ? await loadFixture(process.env.FIXTURE) : await fetchProfile();
  const metrics = analyse(data, today);
  const [avatar, waka, canvas] = await Promise.all([avatarDataUri(data.avatarUrl), fetchWakaTime(), loadCanvas()]);

  await mkdir(resolve(OUT_DIR, 'buttons'), { recursive: true });
  for (const [theme, t] of Object.entries(THEMES)) {
    const write = (name, svg) => writeFile(resolve(OUT_DIR, `${name}-${theme}.svg`), svg, 'utf8');
    await write('header', renderHeader(metrics, t, avatar));
    await write('city', renderCity(data, metrics, t, today));
    // The canvas belongs to the interaction workflow, which redraws it on every paint. Drawing
    // it here too would race with a visitor's push, so only fill it in when it is missing.
    const canvasFile = resolve(OUT_DIR, `canvas-${theme}.svg`);
    if (!(await exists(canvasFile))) await write('canvas', renderCanvas(canvas, t, longDate(canvas.log?.[0]?.at || today)));
    if (waka) await write('coding', renderCoding(waka, t, today));
    for (const [name, b] of Object.entries(BUTTONS)) await write(`buttons/${name}`, button(t, b.label, b));
  }

  // Show the coding card only while WakaTime is connected; on a failed fetch, leave it alone.
  if (waka !== undefined && !process.env.OUT_DIR) {
    const block = waka ? `\n### This week in code\n\n${picture('coding', `${waka.total} of coding this week, by language.`)}\n` : '';
    const readme = await readFile(README, 'utf8');
    await writeFile(README, replaceBlock(readme, 'coding', block), 'utf8');
  }

  const { busiest, ...rest } = metrics;
  console.log(JSON.stringify({ ...rest, busiest: busiest && `${busiest.date}:${busiest.contributionCount}`, wakatime: waka ? 'ok' : waka === null ? 'off' : 'kept' }));
}

main().catch((err) => {
  console.error(`Card generation failed: ${err.message}`);
  process.exit(1);
});
