/** Replace what sits between <!-- name:start --> and <!-- name:end --> in README.md. */
export function replaceBlock(readme, name, content) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const a = readme.indexOf(start);
  const b = readme.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error(`README.md is missing the ${name} markers`);
  return `${readme.slice(0, a + start.length)}\n${content.trim() ? `${content.trim()}\n` : ''}${readme.slice(b)}`;
}
