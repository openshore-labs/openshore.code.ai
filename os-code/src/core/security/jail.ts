// Working-directory jail for file tools. Every path a tool touches resolves
// through here; anything that escapes the workspace root is refused with a
// clear reason, including symlink escapes.
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, dirname } from 'node:path';

export class JailViolation extends Error {
  constructor(
    public readonly requested: string,
    reason: string,
  ) {
    super(reason);
    this.name = 'JailViolation';
  }
}

export class Jail {
  readonly root: string;

  constructor(root: string) {
    // Resolve the root itself through symlinks once, so comparisons are stable.
    this.root = safeRealpath(resolve(root));
  }

  /**
   * Resolve a user- or model-supplied path to an absolute path inside the
   * jail. Throws JailViolation when the path escapes.
   */
  resolve(requested: string): string {
    const abs = isAbsolute(requested) ? resolve(requested) : resolve(this.root, requested);
    // Resolve through symlinks using the deepest existing ancestor, so a
    // symlink inside the tree cannot point writes outside it.
    const real = deepestRealpath(abs);
    if (!this.contains(real)) {
      throw new JailViolation(
        requested,
        `Path leaves the workspace: ${requested}. Tools only touch files under ${this.root}.`,
      );
    }
    return abs;
  }

  contains(absPath: string): boolean {
    const rel = relative(this.root, absPath);
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
  }
}

/**
 * Where `abs` really lies in the workspace at `root`, as a permission rule
 * judges it (D3): the deepest part that exists resolved through links (an
 * in-tree alias is judged by its target), relative to the real root, with
 * forward slashes (a backslash is a separator, the Windows spelling). The
 * model's own spelling never reaches a rule. A path outside the root comes
 * back starting with `..`; the jail refuses those before this is asked.
 */
export function realRelativePath(abs: string, root: string): string {
  const realRoot = safeRealpath(resolve(root));
  return relative(realRoot, deepestRealpath(resolve(abs))).replace(/\\/g, '/');
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Realpath of the deepest ancestor that exists, re-joined with the rest. */
function deepestRealpath(abs: string): string {
  let existing = abs;
  let tail = '';
  // Walk up until something exists, carrying the non-existent tail.
  for (;;) {
    try {
      const real = realpathSync(existing);
      return tail ? resolve(real, tail) : real;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return abs;
      tail = tail
        ? `${existing.slice(parent.length + 1)}${sep}${tail}`
        : existing.slice(parent.length + 1);
      existing = parent;
    }
  }
}
