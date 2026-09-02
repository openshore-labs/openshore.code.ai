// The seeded prompt behind /init: explore the repo and write OSCODE.md. Pure
// (no Node imports) so the app can import it through os-code/protocol.
export const INIT_PROMPT = [
  'Explore this repository and write an OSCODE.md at its root: the standing instructions a coding agent needs to work here well.',
  'Cover, briefly and concretely: what the project is, how to build and run it, how to run the tests and the lint, the code conventions you can see (formatting, naming, file layout), anything a newcomer would get wrong, and the commands to run before a commit.',
  'Read the real files (package manifests, config, CI, the README, a few source files) before writing anything. Do not invent commands; only list ones you found.',
  'Keep it under 120 lines. Use headings and short bullets. Never use em dashes.',
  'If an OSCODE.md, CLAUDE.md, or AGENTS.md already exists, improve it in place instead of writing a second file.',
].join(' ');
