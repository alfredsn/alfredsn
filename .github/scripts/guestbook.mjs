// Runs when someone opens an issue titled "guestbook...". Adds the issue author to
// data/guestbook.json, rewrites the wall in README.md, then thanks them and closes the issue.
//
// The only thing taken from the issue is the author's login, checked against GitHub's
// username rules. Titles and bodies are never written anywhere, so nobody can put text on the profile.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const DATA = resolve(process.cwd(), 'data/guestbook.json');
const README = resolve(process.cwd(), 'README.md');
const SHOWN = 36;

const START = '<!-- guestbook:start -->';
const END = '<!-- guestbook:end -->';

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'profile-guestbook',
    },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function load() {
  try {
    return JSON.parse(await readFile(DATA, 'utf8'));
  } catch {
    return [];
  }
}

function wall(entries) {
  if (!entries.length) return '<sub>Nobody yet. You could be first.</sub>';
  const faces = entries
    .slice(0, SHOWN)
    .map(
      ({ login }) =>
        `<a href="https://github.com/${login}" title="@${login}"><img src="https://github.com/${login}.png?size=96" width="44" height="44" alt="@${login}"></a>`
    )
    .join('\n');
  const more = entries.length > SHOWN ? ` The ${SHOWN} most recent are shown.` : '';
  const n = entries.length;
  return `${faces}\n\n<sub>${n} ${n === 1 ? 'person has' : 'people have'} signed.${more}</sub>`;
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const issue = event.issue;
  const user = issue.user;

  if (user.type !== 'User' || !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(user.login)) {
    console.log(`Skipping ${user.type} ${user.login}`);
    return;
  }

  // Second pass, run after the commit is pushed, so the visitor is only told once it is live.
  // ALREADY_SIGNED is the first pass's step output.
  if (process.argv[2] === 'reply') {
    const body =
      process.env.ALREADY_SIGNED === 'true'
        ? `You're already on the wall, @${user.login}. Thanks for coming back.`
        : `Thanks for stopping by, @${user.login}. Your avatar is on the wall now: https://github.com/${REPO.split('/')[0]}`;
    await api(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    await api(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    return;
  }

  const entries = await load();
  const already = entries.some((e) => e.login.toLowerCase() === user.login.toLowerCase());
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `already=${already}\n`, { flag: 'a' });

  if (!already) {
    entries.unshift({ login: user.login, signedAt: new Date().toISOString().slice(0, 10) });
    await mkdir(dirname(DATA), { recursive: true });
    await writeFile(DATA, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  }

  const readme = await readFile(README, 'utf8');
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a === -1 || b === -1) throw new Error('Guestbook markers missing from README.md');
  await writeFile(README, `${readme.slice(0, a + START.length)}\n${wall(entries)}\n${readme.slice(b)}`, 'utf8');

  console.log(already ? `${user.login} already signed` : `added ${user.login} (${entries.length} total)`);
}

main().catch((err) => {
  console.error(`Guestbook failed: ${err.message}`);
  process.exit(1);
});
