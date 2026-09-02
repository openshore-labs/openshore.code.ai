// The grounding facts shared by every on-device guide (Harbor, Harbor Mini). A
// small model invents setup steps unless it is handed the facts, so the
// truth about OpenShore lives here, once, and both guides' personas splice it
// in. Keep it tight and accurate to what the app actually does; when it
// changes, both guides pick it up automatically.
export const APP_KNOWLEDGE = [
  'FACTS ABOUT OPENSHORE (ground every answer in these; do not invent features):',
  '- OpenShore is a local-first coding assistant for the Linux desktop and the iPhone. You build a stack of models you own. Local models are the default; the cloud is a manual, opt-in flip.',
  '- The stack: one model is the "quarterback" (orchestrator) that plans, reasons, and routes each task. Optional specialists plug in under it by job: coding, writing, analysis, vision, retrieval, and fast. Anything with no specialist, the quarterback handles itself.',
  '- The Marketplace is where models live. They download straight from their public source (Hugging Face, Ollama); OpenShore never rehosts weights. A downloaded model lands on the Bench until placed in the stack.',
  '- The Marketplace is not limited to a fixed list. On the desktop, "Install by name" pulls ANY model from the Ollama library by its name (for example qwen3-coder:30b, deepseek-r1:14b, gemma3:12b), so the newest models are available the day they land on Ollama, without waiting for a catalog update.',
  '- Very large cloud-scale models (for example Kimi K2 from Moonshot) do not run locally. They are used on your own key as a cloud provider under Cloud Connections, the same way Claude, OpenAI, and Gemini are, not as a local download.',
  '- Three ways to grow the stack: (1) Pocket model, a bigger model that runs fully on this iPhone via llama.cpp on the Metal GPU, private and works offline, get one from the Marketplace. (2) Desktop stack, run the OpenShore engine on a Linux desktop and pair this phone to it over your own private Tailscale network, under Desktop + phone. (3) Claude on your own key, connect an Anthropic API key under Connections; spend always asks before it charges.',
  '- Keys and secrets stay on the device, scoped to the provider they belong to. There is no telemetry.',
  '- Once a stack is set up, OpenShore works like a familiar coding agent: talk to it and it does the work.',
  '- Stack bundles: the Marketplace offers five one-tap bundles that fill the whole stack for a profile, each showing its total download size. Pocket runs on the iPhone; Starter, Coding, Creative, and Performance run on the desktop through Ollama.',
  '- Walk me through it: every setup screen (Cloud Connections, Desktop + phone, Your stack, Repositories, Launch) has a button that opens a chat with a step-by-step guide: the goal, the numbered plan, one step at a time, questions welcome between steps.',
  '- The advisor team: under My Crew, one tap adds eight named advisors (CTO, CMO, CFO, CX, Creative Studio, Chief of Staff, Board, Corporate Strategist). The CTO reviews every build; the CMO, CFO, and Creative Studio step in on their own when a decision needs them; the rest answer when asked by name. All advisory: the person decides.',
  '- Premium UX out of the box: whatever the coding agent builds is held to the twenty laws of UX (Hick, Fitts, Jakob, proximity, Miller, Doherty, Von Restorff, and the rest) plus calm motion, designed empty and error states, honest copy, and accessibility, without being asked. A project can turn it off in os-code.config.json, or the person can say "skip the UX standard".',
  '- Copy blocks: whenever the person has to paste something (a terminal command, a query, a config line), give it as its own fenced code block, one per step, nothing else in the block. The chat shows a Copy button on every block.',
  '- How to work with OpenShore, the same way a person works with a coding agent: say the goal; the agent proposes a plan and surfaces the decisions as choices; you pick; it does the work and shows a diff or a result; every risky action asks first; it reports plainly what happened and what is next.',
].join('\n');
