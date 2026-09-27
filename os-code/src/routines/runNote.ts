// The frontmatter on a Crew run note (Vault M4, 4.9, CTO I13). Hand-written,
// never serialized by a YAML library (the vault core serializes no YAML, H2):
// every value is a JSON string, which YAML reads as a double-quoted scalar,
// so a routine named `Q3: "auth"` or a model named `qwen2.5:7b` can never be
// misread as a map, a number, or a date. The block is what lets a later run
// (or the person, in Obsidian) find this run by type, routine, and tag, and
// follow `previous` back through the routine's history.

/** A YAML double-quoted scalar holding exactly `value`. JSON escapes the
 *  quote, the backslash, and the C0 controls; the characters YAML refuses
 *  unescaped, or reads as a line break, are escaped here too. */
export function yamlString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** The routine's own tag, `crew/<slug>`: letters, digits, `_` and `-` only,
 *  the characters an Obsidian tag keeps. Undefined when nothing is left, or
 *  when only digits are (Obsidian does not treat an all-digit tag as a tag). */
export function crewTag(folder: string): string | undefined {
  const slug = folder
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug || !/\D/.test(slug)) return undefined;
  return `crew/${slug}`;
}

/** The wikilink to an earlier run note, by its full vault path (so two
 *  routines' notes from the same minute never collide), or undefined when
 *  the path cannot be written inside `[[...]]` (a record from before the
 *  folder rule, holding a bracket, a bar, a hash, or a caret). */
export function runNoteLink(notePath: string): string | undefined {
  const target = notePath.replace(/\.md$/i, '');
  if (!target || /[[\]|#^\r\n]/.test(target)) return undefined;
  return `[[${target}]]`;
}

export interface RunNoteFields {
  routine: string;
  project: string;
  model: string;
  session: string;
  started: string;
  state: string;
  /** The routine's folder under Crew/, for its tag. */
  folder: string;
  /** The previous run note's vault path, when there is one. */
  previousPath?: string;
}

/** The note's frontmatter block, closing newline included. */
export function runNoteFrontmatter(f: RunNoteFields): string {
  const tag = crewTag(f.folder);
  const tags = ['crew', ...(tag ? [tag] : [])].map(yamlString).join(', ');
  const previous = f.previousPath ? runNoteLink(f.previousPath) : undefined;
  const lines = [
    '---',
    `type: ${yamlString('crew-run')}`,
    `routine: ${yamlString(f.routine)}`,
    `project: ${yamlString(f.project)}`,
    `model: ${yamlString(f.model)}`,
    `session: ${yamlString(f.session)}`,
    `started: ${yamlString(f.started)}`,
    `state: ${yamlString(f.state)}`,
    `tags: [${tags}]`,
    ...(previous ? [`previous: ${yamlString(previous)}`] : []),
    '---',
  ];
  return `${lines.join('\n')}\n`;
}
