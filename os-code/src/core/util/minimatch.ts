// A small, dependency-free glob matcher covering the subset OS Code uses:
// `*` (within a segment), `**` (across segments), `?`, and `{a,b}` groups.
// Deliberately not a full minimatch: predictable beats featureful in a
// permission engine.

function globToRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more whole segments; bare `**` matches anything.
        if (glob[i + 2] === '/') {
          re += '(?:[^/]*/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i += 1;
      } else {
        const options = glob
          .slice(i + 1, end)
          .split(',')
          .map((o) => o.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'));
        re += `(?:${options.join('|')})`;
        i = end + 1;
      }
    } else {
      re += c!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

const cache = new Map<string, RegExp>();

export function minimatch(path: string, glob: string): boolean {
  let re = cache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    cache.set(glob, re);
  }
  // A glob without a slash matches against the basename too, like .gitignore.
  if (re.test(path)) return true;
  if (!glob.includes('/')) {
    const base = path.split('/').pop() ?? path;
    return re.test(base);
  }
  return false;
}
