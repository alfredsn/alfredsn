// Handles the two things a visitor can do from the profile by opening an issue:
//   "guestbook ..."  add their avatar to the wall
//   "pixel ..."      paint one cell of the community canvas (and join the wall)
//
// Two passes so nobody is told "done" before it is live:
//   node interact.mjs         do the work, write files, and save the reply to $RUNNER_TEMP/reply.md
//   (workflow commits and pushes)
//   node interact.mjs reply   post the saved reply and close the issue
//
// Visitor text is untrusted. Only the author's login (checked against GitHub's username rules),
// a cell like "F7", and a palette name are ever written to the repo.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { THEMES } from './lib/theme.mjs';
import { loadCanvas, saveCanvas, parseCell, parseColor, place, renderCanvas, PALETTE } from './lib/canvas.mjs';
import { replaceBlock } from './lib/readme.mjs';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const OWNER = REPO?.split('/')[0];
const ROOT = process.cwd();
const REPLY_FILE = resolve(process.env.RUNNER_TEMP || ROOT, 'reply.md');
const WALL_FILE = resolve(ROOT, 'data/guestbook.json');
const README = resolve(ROOT, 'README.md');

const LIMITS = { pixel: 10 }; // per person per 24 hours; the owner is exempt
const WALL_SHOWN = 36;

// ---------------------------------------------------------------- GitHub REST

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'profile-interact',
    },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** How many issues of this kind the person opened in the last 24 hours, including this one. */
async function recentCount(login, kind) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const issues = await api(`/issues?creator=${login}&state=all&since=${since}&per_page=100`);
  return issues.filter((i) => !i.pull_request && i.created_at >= since && i.title.toLowerCase().startsWith(kind)).length;
}

// ---------------------------------------------------------------- the wall

async function loadWall() {
  try {
    return JSON.parse(await readFile(WALL_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function renderWall(entries) {
  if (!entries.length) return '<sub>Nobody yet. You could be first.</sub>';
  const faces = entries
    .slice(0, WALL_SHOWN)
    .map(
      ({ login }) =>
        `<a href="https://github.com/${login}" title="@${login}"><img src="https://github.com/${login}.png?size=96" width="44" height="44" alt="@${login}"></a>`
    )
    .join('\n');
  const n = entries.length;
  const more = n > WALL_SHOWN ? ` The ${WALL_SHOWN} most recent are shown.` : '';
  return `${faces}\n\n<sub>${n} ${n === 1 ? 'person has' : 'people have'} left a mark.${more}</sub>`;
}

/** Adds the person to the wall if they are new. Returns true when they were already on it. */
async function joinWall(login, via) {
  const entries = await loadWall();
  const known = entries.some((e) => e.login.toLowerCase() === login.toLowerCase());
  if (!known) {
    entries.unshift({ login, via, at: new Date().toISOString().slice(0, 10) });
    await mkdir(resolve(ROOT, 'data'), { recursive: true });
    await writeFile(WALL_FILE, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  }
  const readme = await readFile(README, 'utf8');
  await writeFile(README, replaceBlock(readme, 'guestbook', renderWall(entries)), 'utf8');
  return known;
}

// ---------------------------------------------------------------- handlers

async function guestbook({ login }) {
  const known = await joinWall(login, 'guestbook');
  return known
    ? `You're already on the wall, @${login}. Thanks for coming back.`
    : `Thanks for stopping by, @${login}. Your avatar is on the wall now: https://github.com/${OWNER}`;
}

async function pixel({ login, title, body }) {
  // Issue form answers arrive as "### Cell\n\nF7"; a plain title like "pixel: F7 orange" works too.
  const text = `${title}\n${body || ''}`;
  const cell = parseCell(section(body, 'Cell') || title) || parseCell(text);
  const color = parseColor(section(body, 'Color') || title) || parseColor(text);
  if (!cell || !color) {
    return `I couldn't read a cell and a color from this, @${login}. Use a cell from A1 to X24 and one of: ${Object.keys(
      PALETTE
    ).join(', ')}, or erase. Example title: \`pixel: F7 orange\`.`;
  }

  if (login !== OWNER && (await recentCount(login, 'pixel')) > LIMITS.pixel) {
    return `You've painted ${LIMITS.pixel} pixels today, @${login}. Come back tomorrow and the canvas is yours again.`;
  }

  const state = place(await loadCanvas(), { cell, color, by: login, at: new Date().toISOString().slice(0, 10) });
  await saveCanvas(state);
  const today = new Date();
  const stamp = `${today.getUTCDate()} ${today.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${today.getUTCFullYear()}`;
  for (const [theme, t] of Object.entries(THEMES)) {
    await writeFile(resolve(ROOT, `assets/canvas-${theme}.svg`), renderCanvas(state, t, stamp), 'utf8');
  }
  await joinWall(login, 'pixel');

  return color === 'erase'
    ? `Erased ${cell}, @${login}. See the canvas: https://github.com/${OWNER}`
    : `Painted ${cell} ${color}, @${login}. It's live on the canvas now: https://github.com/${OWNER}`;
}

/** The answer under "### Heading" in an issue-form body. */
function section(body, heading) {
  const m = new RegExp(`###\\s*${heading}\\s*\\n+([\\s\\S]*?)(?=\\n###|$)`, 'i').exec(body || '');
  const value = m?.[1].trim();
  return value && value !== '_No response_' ? value : '';
}

// ---------------------------------------------------------------- main

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const issue = event.issue;

  if (process.argv[2] === 'reply') {
    let body;
    try {
      body = await readFile(REPLY_FILE, 'utf8');
    } catch {
      return; // first pass skipped this issue
    }
    await api(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    await api(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    return;
  }

  const user = issue.user;
  if (user.type !== 'User' || !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(user.login)) {
    console.log(`Skipping ${user.type} ${user.login}`);
    return;
  }

  const kind = issue.title.trim().toLowerCase().match(/^(guestbook|pixel)/)?.[1];
  const handlers = { guestbook, pixel };
  if (!kind) return;

  const reply = await handlers[kind]({ login: user.login, title: issue.title, body: issue.body });
  await writeFile(REPLY_FILE, reply, 'utf8');
  console.log(`${kind} for ${user.login}: done`);
}

main().catch((err) => {
  console.error(`Interaction failed: ${err.message}`);
  process.exit(1);
});
