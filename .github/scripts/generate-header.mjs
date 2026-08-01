import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const LOGIN = process.env.PROFILE_LOGIN || 'alfredsn';
const TOKEN = process.env.METRICS_TOKEN || process.env.GITHUB_TOKEN;
const OUT_DIR = resolve(process.cwd(), 'assets');

const IDENTITY = {
  name: 'Alfred Sahala Nainggolan',
  role: 'SOFTWARE ENGINEER',
  eyebrow: 'GITHUB.COM/ALFREDSN',
};

const SPARK_WEEKS = 26;

const THEMES = {
  light: {
    bg: '#FFFCFA',
    surface: '#FFF3EE',
    text: '#17120F',
    muted: '#8C817C',
    hairline: '#F0DED6',
    accent: '#FF7043',
    accentDeep: '#E64A19',
    barIdle: '#F5DDD4',
  },
  dark: {
    bg: '#0D1117',
    surface: '#161B22',
    text: '#E6EDF3',
    muted: '#7D8590',
    hairline: '#26221F',
    accent: '#FF8A65',
    accentDeep: '#FF7043',
    barIdle: '#241C18',
  },
};

const QUERY = `
query($login: String!) {
  user(login: $login) {
    createdAt
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name } }
        }
      }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function fetchProfile() {
  if (!TOKEN) throw new Error('No GITHUB_TOKEN / METRICS_TOKEN in environment.');

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${LOGIN}-profile-header`,
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });

  if (!res.ok) throw new Error(`GitHub API responded ${res.status} ${res.statusText}`);

  const body = await res.json();
  if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data?.user) throw new Error(`User "${LOGIN}" not found.`);

  return body.data.user;
}

function currentStreak(days, today = new Date().toISOString().slice(0, 10)) {
  const past = days.filter((d) => d.date <= today);

  let i = past.length - 1;
  if (i >= 0 && past[i].contributionCount === 0) i -= 1;

  let streak = 0;
  for (; i >= 0 && past[i].contributionCount > 0; i -= 1) streak += 1;
  return streak;
}

function topLanguage(repos) {
  const bytes = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      bytes.set(node.name, (bytes.get(node.name) || 0) + size);
    }
  }
  const ranked = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : '—';
}

function collect(user) {
  const weeks = user.contributionsCollection.contributionCalendar.weeks;
  const days = weeks.flatMap((w) => w.contributionDays);

  return {
    contributions: user.contributionsCollection.contributionCalendar.totalContributions,
    streak: currentStreak(days),
    repos: user.repositories.totalCount,
    language: topLanguage(user.repositories.nodes),
    since: new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    spark: weeks
      .slice(-SPARK_WEEKS)
      .map((w) => w.contributionDays.reduce((sum, d) => sum + d.contributionCount, 0)),
  };
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Advance-width estimate (Georgia bold averages ~0.55em) so a long name shrinks instead of colliding. */
const fitSize = (text, max, size, ratio = 0.55) => Math.min(size, Math.floor(max / (text.length * ratio)) || size);

function sparkline(values, { x, y, width, height }, t) {
  if (!values.length) return '';
  const peak = Math.max(...values, 1);
  const step = width / values.length;
  const barW = Math.max(3, step * 0.62);

  return values
    .map((v, i) => {
      const h = Math.max(2, (v / peak) * height);
      const bx = (x + i * step + (step - barW) / 2).toFixed(1);
      const by = (y + height - h).toFixed(1);
      return `<rect x="${bx}" y="${by}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${
        v > 0 ? t.accent : t.barIdle
      }" opacity="${v > 0 ? 0.35 + 0.65 * (v / peak) : 1}"/>`;
    })
    .join('\n    ');
}

function render(m, t) {
  const W = 880;
  const H = 310;
  const mono = "ui-monospace,'SF Mono','Cascadia Mono','Segoe UI Mono',Menlo,Consolas,monospace";
  const serif = "Georgia,'Iowan Old Style','Times New Roman',serif";

  const nameSize = fitSize(IDENTITY.name, 460, 34);
  const cells = [
    [m.contributions.toLocaleString('en-US'), 'CONTRIBUTIONS · 1Y'],
    [m.streak, 'DAY STREAK'],
    [m.repos, 'PUBLIC REPOS'],
    [m.language, 'PRIMARY LANGUAGE'],
  ];

  const metrics = cells
    .map(([value, label], i) => {
      const cx = 32 + i * 204;
      const size = String(value).length > 8 ? 20 : 27;
      return `<text x="${cx}" y="243" font-family="${serif}" font-size="${size}" font-weight="bold" fill="${
        t.text
      }">${esc(value)}</text>
    <text x="${cx}" y="264" font-family="${mono}" font-size="9" letter-spacing="1.6" fill="${t.muted}">${esc(
        label
      )}</text>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    IDENTITY.name
  )} — ${esc(IDENTITY.role)}. ${m.contributions} contributions in the last year, ${m.streak} day streak, ${
    m.repos
  } public repositories, primary language ${esc(m.language)}.">
  <defs>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${t.accent}"/>
      <stop offset="100%" stop-color="${t.accentDeep}"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${t.accent}"/>
      <stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" rx="6" fill="${t.bg}"/>
  <rect width="5" height="${H}" fill="url(#bar)"/>

  <rect x="32" y="28" width="4" height="12" rx="1" fill="${t.accent}"/>
  <text x="45" y="38" font-family="${mono}" font-size="10" font-weight="bold" letter-spacing="2.4" fill="${
    t.accent
  }">${esc(IDENTITY.eyebrow)}</text>

  <text x="32" y="98" font-family="${serif}" font-size="${nameSize}" font-weight="bold" fill="${t.text}">${esc(
    IDENTITY.name
  )}</text>
  <rect x="32" y="112" width="270" height="2.5" fill="url(#rule)"/>

  <text x="32" y="142" font-family="${mono}" font-size="11.5" font-weight="bold" letter-spacing="4" fill="${
    t.accent
  }">${esc(IDENTITY.role)}</text>
  <text x="32" y="165" font-family="${mono}" font-size="10.5" fill="${t.muted}">Indonesia &#183; on GitHub since ${esc(
    m.since
  )}</text>

  <text x="848" y="38" text-anchor="end" font-family="${mono}" font-size="9" letter-spacing="1.8" fill="${
    t.muted
  }">WEEKLY CONTRIBUTIONS &#183; LAST ${SPARK_WEEKS} WEEKS</text>
  <g>
    ${sparkline(m.spark, { x: 516, y: 70, width: 332, height: 100 }, t)}
  </g>
  <rect x="516" y="172" width="332" height="1" fill="${t.hairline}"/>

  <rect x="32" y="200" width="816" height="1" fill="${t.hairline}"/>
  <g>
    ${metrics}
  </g>

  <text x="32" y="292" font-family="${mono}" font-size="9" fill="${t.muted}">Regenerated daily from the GitHub API</text>
  <text x="848" y="292" text-anchor="end" font-family="${mono}" font-size="9" fill="${t.muted}">${esc(
    new Date().toISOString().slice(0, 10)
  )}</text>
</svg>
`;
}

async function main() {
  const metrics = collect(await fetchProfile());
  await mkdir(OUT_DIR, { recursive: true });

  for (const [name, theme] of Object.entries(THEMES)) {
    const file = resolve(OUT_DIR, `header-${name}.svg`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, render(metrics, theme), 'utf8');
    console.log(`wrote ${file}`);
  }

  console.log(
    `contributions=${metrics.contributions} streak=${metrics.streak} repos=${metrics.repos} lang=${metrics.language}`
  );
}

main().catch((err) => {
  console.error(`Header generation failed: ${err.message}`);
  process.exit(1);
});
