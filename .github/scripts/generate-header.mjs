// Builds the two cards README.md points at, in light and dark:
//   assets/header-*.svg  identity, live status, four stats from the contribution calendar
//   assets/year-*.svg    animated contribution calendar with annotations
//
// Every number comes from the GitHub GraphQL API at build time. Nothing is typed in by hand.
// Local preview without a token: FIXTURE=path/to/days.json node .github/scripts/generate-header.mjs

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const LOGIN = process.env.PROFILE_LOGIN || 'alfredsn';
const TOKEN = process.env.METRICS_TOKEN || process.env.GITHUB_TOKEN;
const OUT_DIR = resolve(process.cwd(), process.env.OUT_DIR || 'assets');

const IDENTITY = {
  name: 'Alfred Sahala Nainggolan',
  tagline: 'Software engineer in Indonesia. Mobile, web, and lately LLM tooling.',
};

// Semantic tokens, Apple-style: labels step down in three levels, and dark mode
// lifts the card one step above GitHub's canvas instead of inverting it.
const THEMES = {
  light: {
    card: '#FFFFFF',
    stroke: '#D0D7DE',
    label: '#1D1D1F',
    secondary: '#6E6E73',
    tertiary: '#8E8E93',
    separator: '#E5E5EA',
    empty: '#F2F2F7',
    accent: '#F4511E',
    live: '#34C759',
    idle: '#AEAEB2',
  },
  dark: {
    card: '#161B22',
    stroke: '#30363D',
    label: '#F5F5F7',
    secondary: '#A1A1A6',
    tertiary: '#7D7D84',
    separator: '#30363D',
    empty: '#21262D',
    accent: '#FF7043',
    live: '#30D158',
    idle: '#636366',
  },
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI Variable Display','Segoe UI',system-ui,Roboto,'Helvetica Neue',Arial,sans-serif";

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

// ---------------------------------------------------------------- data

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
  return {
    avatarUrl: `https://github.com/${LOGIN}.png?size=160`,
    weeks,
    total: days.reduce((s, d) => s + d.contributionCount, 0),
  };
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
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86_400_000);

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
  const lastActive = active.at(-1)?.date ?? null;
  const last7 = days.slice(-7).reduce((s, d) => s + d.contributionCount, 0);

  return {
    total,
    activeDays: active.length,
    longest,
    topWeekday: active.length ? WEEKDAYS[topWeekday] : 'n/a',
    busiest,
    lastActive,
    last7,
    sinceLast: lastActive ? daysBetween(lastActive, today) : Infinity,
  };
}

// ---------------------------------------------------------------- drawing helpers

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Rough advance width for the system UI stack, used only to size pills. */
const textWidth = (s, size) => [...s].reduce((w, ch) => w + (/[ il.,·']/.test(ch) ? 0.3 : /[A-Z0-9mw]/.test(ch) ? 0.66 : 0.54), 0) * size;

const STYLE = `
    text { font-family: ${FONT}; font-variant-numeric: tabular-nums; }
    .rise { animation: rise 900ms cubic-bezier(.22,1,.36,1) both; }
    .cell { animation: pop 520ms cubic-bezier(.34,1.4,.64,1) both; transform-box: fill-box; transform-origin: center; }
    .halo { animation: halo 2.4s cubic-bezier(.22,1,.36,1) infinite; transform-box: fill-box; transform-origin: center; }
    .ring { animation: ring 1.6s cubic-bezier(.22,1,.36,1) 1.4s 3 both; transform-box: fill-box; transform-origin: center; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    @keyframes pop  { from { opacity: 0; transform: scale(.3); } }
    @keyframes halo { 0% { opacity: .55; transform: scale(1); } 80%, 100% { opacity: 0; transform: scale(2.6); } }
    @keyframes ring { 0% { opacity: 0; transform: scale(2.2); } 60% { opacity: 1; transform: scale(1); } 100% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`;

const frame = (W, H, t, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
  <style>${STYLE}
  </style>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="16" fill="${t.card}" stroke="${t.stroke}"/>
${body}
</svg>
`;

// ---------------------------------------------------------------- header card

function status(m) {
  if (m.sinceLast <= 7) return { live: true, text: `Active this week · ${m.last7} contribution${m.last7 === 1 ? '' : 's'}` };
  if (m.lastActive) return { live: false, text: `Last contribution ${longDate(m.lastActive)}` };
  return { live: false, text: 'No contributions this year' };
}

function renderHeader(m, t, avatar) {
  const W = 880;
  const H = 240;
  const s = status(m);

  const pillH = 28;
  const pillW = Math.ceil(textWidth(s.text, 13) + 44);
  const pillX = W - 32 - pillW;
  const dotColor = s.live ? t.live : t.idle;
  const dotX = pillX + 16;
  const dotY = 32 + pillH / 2;

  const textX = avatar ? 120 : 32;

  const stats = [
    [m.total.toLocaleString('en-US'), 'contributions, past year'],
    [m.activeDays, 'days with a commit'],
    [`${m.longest} day${m.longest === 1 ? '' : 's'}`, 'longest streak'],
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

  <g class="rise" style="animation-delay:120ms">
    <rect x="${pillX}" y="32" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="none" stroke="${t.separator}"/>
    ${s.live ? `<circle class="halo" cx="${dotX}" cy="${dotY}" r="4" fill="${dotColor}"/>` : ''}
    <circle cx="${dotX}" cy="${dotY}" r="4" fill="${dotColor}"/>
    <text x="${dotX + 12}" y="${dotY + 4.5}" font-size="13" fill="${t.secondary}">${esc(s.text)}</text>
  </g>

  <rect x="32" y="128" width="${W - 64}" height="1" fill="${t.separator}"/>
${stats}`;

  return frame(
    W,
    H,
    t,
    `${IDENTITY.name}. ${IDENTITY.tagline} ${s.text}. ${m.total} contributions in the past year across ${m.activeDays} days, longest streak ${m.longest} days, most active on ${m.topWeekday}s.`,
    body
  );
}

// ---------------------------------------------------------------- year card

/** GitHub-style levels: quartiles of the non-zero days, so one huge day does not wash out the rest. */
function levelFn(days) {
  const counts = days.map((d) => d.contributionCount).filter((c) => c > 0).sort((a, b) => a - b);
  if (!counts.length) return () => 0;
  const q = (p) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))];
  const [a, b, c] = [q(0.25), q(0.5), q(0.75)];
  return (n) => (n <= 0 ? 0 : n <= a ? 1 : n <= b ? 2 : n <= c ? 3 : 4);
}

const LEVEL_OPACITY = [1, 0.32, 0.55, 0.78, 1];

function renderYear(data, m, t, today) {
  const W = 880;
  const H = 310;
  const pitch = 14;
  const size = 11;
  const weeks = data.weeks;
  const gridW = weeks.length * pitch - (pitch - size);
  const x0 = Math.round((W - gridW) / 2) + 12;
  const y0 = 116;
  const level = levelFn(weeks.flatMap((w) => w.contributionDays));

  const cells = [];
  const months = [];
  let lastMonthCol = -10;
  weeks.forEach((w, col) => {
    const first = w.contributionDays[0];
    const month = utc(first.date).getUTCMonth();
    const prev = col > 0 ? utc(weeks[col - 1].contributionDays[0].date).getUTCMonth() : -1;
    if (month !== prev && col - lastMonthCol >= 3 && col < weeks.length - 1) {
      months.push(`<text x="${x0 + col * pitch}" y="${y0 - 10}" font-size="11" fill="${t.tertiary}">${fmt(first.date, { month: 'short' })}</text>`);
      lastMonthCol = col;
    }
    for (const d of w.contributionDays) {
      if (d.date > today) continue;
      const lv = level(d.contributionCount);
      const x = x0 + col * pitch;
      const y = y0 + d.weekday * pitch;
      const delay = Math.round(col * 16 + d.weekday * 10);
      cells.push(
        `<rect class="cell" style="animation-delay:${delay}ms" x="${x}" y="${y}" width="${size}" height="${size}" rx="2.5" fill="${
          lv ? t.accent : t.empty
        }"${lv ? ` fill-opacity="${LEVEL_OPACITY[lv]}"` : ''}><title>${esc(
          `${d.contributionCount || 'No'} contribution${d.contributionCount === 1 ? '' : 's'} on ${longDate(d.date)}`
        )}</title></rect>`
      );
    }
  });

  // Ring the busiest day so the annotation below has something to point at.
  let ring = '';
  if (m.busiest) {
    const col = weeks.findIndex((w) => w.contributionDays.some((d) => d.date === m.busiest.date));
    const rx = x0 + col * pitch - 3;
    const ry = y0 + m.busiest.weekday * pitch - 3;
    ring = `<rect class="ring" x="${rx}" y="${ry}" width="${size + 6}" height="${size + 6}" rx="5" fill="none" stroke="${t.label}" stroke-width="1.5"/>`;
  }

  const dayLabels = [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ]
    .map(([d, l]) => `<text x="${x0 - 10}" y="${y0 + d * pitch + 9}" text-anchor="end" font-size="11" fill="${t.tertiary}">${l}</text>`)
    .join('\n    ');

  const legendX = W - 32 - 5 * pitch - 34;
  const legend = [0, 1, 2, 3, 4]
    .map(
      (lv, i) =>
        `<rect x="${legendX + i * pitch}" y="34" width="${size}" height="${size}" rx="2.5" fill="${lv ? t.accent : t.empty}"${
          lv ? ` fill-opacity="${LEVEL_OPACITY[lv]}"` : ''
        }/>`
    )
    .join('');

  const notes = [];
  if (m.busiest) {
    notes.push([
      'Busiest day',
      `${fmt(m.busiest.date, { weekday: 'short' })} ${longDate(m.busiest.date)} · ${m.busiest.contributionCount} contributions`,
      true,
    ]);
  }
  notes.push(['Longest run', `${m.longest} day${m.longest === 1 ? '' : 's'} in a row`]);
  notes.push(['Rhythm', m.activeDays ? `Most work lands on ${m.topWeekday}s` : 'Quiet year']);

  const colW = (W - 64) / notes.length;
  const noteSvg = notes
    .map(([k, v, marked], i) => {
      const x = 32 + i * colW;
      const mark = marked
        ? `<rect x="${x}" y="${y0 + 7 * pitch + 37}" width="10" height="10" rx="2.5" fill="none" stroke="${t.label}" stroke-width="1.5"/>`
        : '';
      const tx = marked ? x + 18 : x;
      return `<g class="rise" style="animation-delay:${1200 + i * 120}ms">
    ${mark}<text x="${tx}" y="${y0 + 7 * pitch + 46}" font-size="12" font-weight="600" fill="${t.label}">${esc(k)}</text>
    <text x="${x}" y="${y0 + 7 * pitch + 68}" font-size="13" fill="${t.secondary}">${esc(v)}</text>
  </g>`;
    })
    .join('\n  ');

  const body = `  <g class="rise">
    <text x="32" y="45" font-size="17" font-weight="600" letter-spacing="-0.2" fill="${t.label}">The past year, day by day</text>
    <text x="32" y="66" font-size="12" fill="${t.tertiary}">From the GitHub API · updated ${esc(longDate(today))}</text>
    <text x="${legendX - 8}" y="44" text-anchor="end" font-size="11" fill="${t.tertiary}">Less</text>
    ${legend}
    <text x="${legendX + 5 * pitch + 4}" y="44" font-size="11" fill="${t.tertiary}">More</text>
  </g>
  <g>
    ${months.join('\n    ')}
    ${dayLabels}
  </g>
  <g>
    ${cells.join('\n    ')}
  </g>
  ${ring}
  <rect x="32" y="${y0 + 7 * pitch + 14}" width="${W - 64}" height="1" fill="${t.separator}"/>
  ${noteSvg}`;

  return frame(
    W,
    H,
    t,
    `Contribution calendar for the past year. ${m.total} contributions on ${m.activeDays} days. ${notes
      .map(([k, v]) => `${k}: ${v}`)
      .join('. ')}.`,
    body
  );
}

// ---------------------------------------------------------------- main

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const data = process.env.FIXTURE ? await loadFixture(process.env.FIXTURE) : await fetchProfile();
  const metrics = analyse(data, today);
  const avatar = await avatarDataUri(data.avatarUrl);

  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, theme] of Object.entries(THEMES)) {
    await writeFile(resolve(OUT_DIR, `header-${name}.svg`), renderHeader(metrics, theme, avatar), 'utf8');
    await writeFile(resolve(OUT_DIR, `year-${name}.svg`), renderYear(data, metrics, theme, today), 'utf8');
  }

  const { busiest, ...rest } = metrics;
  console.log(JSON.stringify({ ...rest, busiest: busiest && `${busiest.date}:${busiest.contributionCount}` }));
}

main().catch((err) => {
  console.error(`Card generation failed: ${err.message}`);
  process.exit(1);
});
