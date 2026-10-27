// Project Wayfinder (founder, 2026-10-27): a project's own environment, set
// up the way an environment is in Claude Code. What every chat here starts
// with (its instructions), how much of the web its models reach (network
// access), and, for the coding sessions on the machine it runs on, its
// environment variables and a setup script. Each is wired into the harness:
// the instructions and the network line ride every chat's brief, network
// access shapes the search a chat may run and the agent's own web tools, and
// the variables and the script reach the session's commands
// (os-code/src/harness/projectEnv.ts). The chat in a project can fill these
// in too (lib/appActions.ts); this sheet is where the person sees and owns them.
import { useEffect, useRef, useState } from 'react';
import { lessonDoubtful } from 'os-code/protocol';
import { Switch } from './Switch.js';
import { parseEnvText, type ProjectNetwork } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import type { Project } from '../state/types.js';
import { readProjectEnvText, writeProjectEnvText } from '../lib/projectEnv.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';

/** The three network levels, as the sheet offers them. */
export const NETWORK_CHOICES: ReadonlyArray<{ id: ProjectNetwork; label: string; hint: string }> = [
  {
    id: 'full',
    label: 'Full',
    hint: 'Models here may search the web and open pages.',
  },
  {
    id: 'search',
    label: 'Search only',
    hint: 'Models here may search the web, and never open pages.',
  },
  {
    id: 'none',
    label: 'None',
    hint: 'No web search and no pages. A command you allow can still reach the network.',
  },
];

interface Draft {
  instructions: string;
  network: ProjectNetwork;
  env: string;
  setupScript: string;
}

function draftOf(project: Project, env: string): Draft {
  return {
    instructions: project.instructions ?? '',
    network: project.network ?? 'full',
    env,
    setupScript: project.setupScript ?? '',
  };
}

export function ProjectWayfinderSheet({
  project,
  open,
  editable,
  onClose,
}: {
  project: Project;
  open: boolean;
  /** An editor of the project; anyone else reads its instructions only. */
  editable: boolean;
  onClose: () => void;
}) {
  const { updateProject, showToast } = useApp();
  const [saved, setSaved] = useState<Draft | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();

  // Re-read what is kept each time the sheet opens: the variables live sealed
  // on this device, and the chat may have filled a field since. Only on open,
  // so the Lessons switch below never wipes an edit in progress.
  const latest = useRef(project);
  latest.current = project;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void readProjectEnvText(latest.current.id).then((env) => {
      if (!alive) return;
      const d = draftOf(latest.current, env);
      setSaved(d);
      setDraft(d);
    });
    return () => {
      alive = false;
    };
  }, [open, project.id]);

  const dirty =
    Boolean(draft && saved) &&
    (draft!.instructions !== saved!.instructions ||
      draft!.network !== saved!.network ||
      draft!.env !== saved!.env ||
      draft!.setupScript !== saved!.setupScript);
  const skipped = draft ? parseEnvText(draft.env).skipped : [];

  const save = async () => {
    if (!draft) return;
    await updateProject(project.id, {
      instructions: draft.instructions,
      network: draft.network === 'full' ? undefined : draft.network,
      setupScript: draft.setupScript.trim() ? draft.setupScript : undefined,
    });
    await writeProjectEnvText(project.id, draft.env);
    setSaved(draft);
    showToast('Project Wayfinder saved.');
    onClose();
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const choice = NETWORK_CHOICES.find((c) => c.id === (draft?.network ?? 'full'))!;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHead title="Project Wayfinder" onClose={onClose} />
      {!editable ? (
        <p className="project-instructions">
          {project.instructions?.trim() || 'No instructions yet.'}
        </p>
      ) : !draft ? (
        <p className="hint">Opening this project's setup.</p>
      ) : (
        <form
          className="wayfinder"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="field">
            <label htmlFor="wayfinder-instructions">Instructions</label>
            <textarea
              id="wayfinder-instructions"
              rows={5}
              placeholder="Context and rules every chat in this project follows."
              value={draft.instructions}
              onChange={(e) => set({ instructions: e.target.value })}
            />
          </div>

          <div className="field">
            <span className="field-label" id="wayfinder-network">
              Network access
            </span>
            <div className="segmented" role="tablist" aria-labelledby="wayfinder-network">
              {NETWORK_CHOICES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={draft.network === c.id}
                  className={`seg press-fb${draft.network === c.id ? ' active' : ''}`}
                  onClick={() => set({ network: c.id })}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="hint">{choice.hint}</p>
          </div>

          <div className="field">
            <label htmlFor="wayfinder-env">Environment variables</label>
            <textarea
              id="wayfinder-env"
              className="mono"
              rows={4}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={'MODE=dev\nPORT=3000'}
              value={draft.env}
              onChange={(e) => set({ env: e.target.value })}
            />
            <p className="hint">
              One NAME=value a line, for this project&apos;s coding sessions. Kept sealed on this
              device and sent only to the machine this project runs on. A value under a name like
              TOKEN or KEY is hidden from what the model reads back.
              {skipped.length
                ? ` ${skipped.length === 1 ? 'Line' : 'Lines'} ${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} not a variable and will be left out.`
                : ''}
            </p>
          </div>

          <div className="field">
            <label htmlFor="wayfinder-setup">Setup script</label>
            <textarea
              id="wayfinder-setup"
              className="mono"
              rows={4}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={'npm install'}
              value={draft.setupScript}
              onChange={(e) => set({ setupScript: e.target.value })}
            />
            <p className="hint">
              Runs once when a coding session opens, on the machine this project runs on, with the
              variables above. Its output shows in the chat.
            </p>
          </div>

          <ProjectLessons project={project} />

          <div className="sheet-actions">
            <button type="submit" className={dirty ? 'btn primary' : 'btn quiet'} disabled={!dirty}>
              Save
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/** Lessons (founder, 2026-10-27): the switch that lets the harness propose
 *  lessons from this project's setbacks, and the ones the person kept, each
 *  with where it came from and a Remove. A lesson that keeps riding into
 *  setbacks says it may be out of date; it is never removed on its own. Both
 *  apply at once, apart from Save above. */
function ProjectLessons({ project }: { project: Project }) {
  const { updateProject, setProjectLessons, showToast } = useApp();
  const kept = useApp((s) => s.projectLessons[project.id] ?? []);
  const on = project.lessons === true;
  return (
    <div className="field wayfinder-lessons">
      <div className="wayfinder-lessons-head">
        <span className="field-label" id="wayfinder-lessons">
          Lessons
        </span>
        <Switch
          checked={on}
          label="Learn from this project"
          onChange={(next) => {
            void updateProject(project.id, { lessons: next || undefined });
            showToast(next ? 'Lessons on for this project.' : 'Lessons off for this project.');
          }}
        />
      </div>
      <p className="hint">
        After a task that hits a setback (a failed check, a step you turned down, your correction),
        the chat offers one short lesson for next time. Nothing is kept until you tap Keep. Kept
        lessons stay sealed on this device, ride every chat here, and are cleared with your chats.
      </p>
      {kept.length ? (
        <div className="check-list">
          {kept.map((l) => (
            <div key={l.id} className="multiselect-row lesson-row">
              <span className="grow">
                {l.text}
                <span className="hint">
                  {' '}
                  · {lessonDoubtful(l) ? 'may be out of date, ' : ''}from {l.source}
                </span>
              </span>
              <button
                type="button"
                className="suggestion"
                aria-label={`Remove the lesson: ${l.text}`}
                onClick={() =>
                  void setProjectLessons(
                    project.id,
                    kept.filter((x) => x.id !== l.id),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : on ? (
        <p className="hint">No lessons kept yet.</p>
      ) : null}
    </div>
  );
}
