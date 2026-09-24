# CX on Zed's first-run page (2026-09-24)

The founder photographed Zed's "Welcome to Zed" setup page and asked whether
any of its options belong in the Harbor Lite walk and, where it makes sense, in
Settings. This is CX's memo, condensed but faithful. What was built from it is
in `os-code/PROGRESS.md` (log, 2026-09-24) and `os-code/DECISIONS.md`.

**Verdict.** Take one idea from Zed's page, fix the honesty bug it exposed,
and skip the rest. Zed's first run sets up an editor. OpenShore is a
chat-driven coding app with no editor in it: there is no keymap, CodeMirror,
or Monaco in `app/src`, and "vim" appears only in comments saying the
terminal can run it.

**Must-fix.** The repo step and the `open-a-repo` guide both promised "every
edit shows you a diff first, and every command asks before it runs". But
`DEFAULT_PERMISSION_MODE` is `acceptEdits` (`app/src/lib/permissionMode.ts`),
which means edits go through and only commands ask. The copy had to match the
default, whatever else was decided.

## Rulings, one per Zed option

1. **Theme: Settings only, already built.** This device > Appearance offers
   System, Light, and Dark, and defaults to System. A walk step here would cost
   attention and give nothing back. Named themes would be a new visual system,
   not onboarding.
2. **Base keymap: skip.** There is no editor to bind keys to.
3. **Agent setup: adapt, not a step.** This already exists as CLI Pairing,
   which is opt-in and chosen per project. A new person has no project yet,
   and OpenShore never installs another company's agent. So it becomes a
   guide opener, "Can I use Claude Code or Codex here?", and Harbor Lite
   points the person to the project's Currents.
4. **Import settings: adapt into one sentence.** The engine already follows
   OSCODE.md, CLAUDE.md, and AGENTS.md (`os-code/src/core/agent/instructions.ts`).
   The walk says so when the repository connects. Nothing is imported.
5. **Vim mode: skip.** Same reason as the keymap.
6. **Trust all projects by default: adapt into a choice about edits in the
   repo step.** A global trust switch trades trust for convenience. The
   question a new person can actually answer is narrower, and it only
   matters once there is code to edit.
7. **Anonymous usage data: skip, and never on by default.** The privacy sheet
   and the site both promise no telemetry and no phone-home. "Help improve the
   test build" stays off by default, kept on the device, and exported by hand.
8. **Crash reports: skip for now.** There is no crash reporter. If one comes,
   crashes go into the same local activity log under the same switch. There
   is never a second switch that sends data.

## What was built

The walk stays at four steps. When the repository connects, the guide says
the step is done, mentions the instruction files, and asks one question:
should OpenShore ask before each edit, or let edits go through and show each
diff in the chat? Commands ask either way. The buttons are **Ask me first**
and **Let edits flow**, with neither preselected, plus a quiet **Decide
later**. The walk waits for a tap. Plan and Bypass stay in the chat's mode
pill.

The same choice lives on in Settings, in a new **Approvals** group above
Terminal. The row is "When the agent edits", with Ask first and Accept edits
as the options. It is a device setting, not per project, because it is
personal comfort rather than a workflow requirement. Per-project trust for
shell already exists as "Always allow in this project".

## Metrics (opt-in, on the device)

`guided_setup_step_done`, `permission_mode_chosen`, `permission_mode_deferred`,
and `permission_mode_changed {from, to, source}`. The last is the regret
signal. The change helped if the time to the first accepted edit does not
grow, and if fewer than one in five people who choose in the walk switch modes
during their first session.

## Elevations (not built yet)

- The first coding chat's mode pill carries one line: "Ask first: I'll check
  before each edit."
- When the agent follows an instruction file, a small card says "Following
  CLAUDE.md".

**One thing.** Make the walk's promise match the default before the next test
build.
