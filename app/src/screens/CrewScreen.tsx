// Crew: your own roster of agents. Give each one a name, a persona, and a
// rule for how and when it is called. An Activity Level decides that: it can
// review every build before it ships, let the Reasoning model bring it in on its
// own, or stay dormant until you ask for it by name. Scope each to specific
// projects, or let it work across all of them.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from '../components/BackBar.js';
import { SwipeRow } from '../components/SwipeRow.js';
import { ProjectMultiSelect } from '../components/ProjectMultiSelect.js';
import type { CrewActivityLevel, CrewAgent } from '../state/types.js';
import { ADVISOR_TEAM } from '../lib/crewPresets.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { CheckGlyph } from '../components/SheetGlyphs.js';
import {
  agentPresenceLine,
  busiestFirst,
  crewControl,
  crewHeadline,
  presenceTone,
  routinesForAgent,
} from '../lib/routines.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';

const LEVELS: Array<{ id: CrewActivityLevel; label: string; hint: string }> = [
  {
    id: 'review',
    label: 'Reviews the work',
    hint: 'Runs automatically before something ships or is relied on, like a standing reviewer.',
  },
  {
    id: 'auto',
    label: 'Joins on its own',
    hint: 'The Reasoning model can bring this member in on its own when a decision needs its view. More hands-off.',
  },
  {
    id: 'request',
    label: 'When you ask',
    hint: 'Stays dormant until you ask for it by name in a chat.',
  },
];

/** The door's one honest line: where routines run, and only while it is on.
 *  Away from the computer it says the same, then how to take control back. */
const ROUTINES_RUN_LINE = 'Routines run on your computer while it is on.';

type Draft = Omit<CrewAgent, 'id' | 'createdAt'> & { id?: string };

function emptyDraft(): Draft {
  return { name: '', persona: '', whenCalled: '', activityLevel: 'request', projectIds: [] };
}

function levelLabel(level: CrewActivityLevel): string {
  return LEVELS.find((l) => l.id === level)?.label ?? level;
}

export function CrewScreen() {
  const {
    settings,
    connectivity,
    createCrewAgent,
    updateCrewAgent,
    deleteCrewAgent,
    showToast,
    routines: routinesState,
    refreshRoutines,
    openCrewCommand,
  } = useApp();
  const control = crewControl({
    onDesktop: isDesktop() && Boolean(bridge()),
    hasDaemon: Boolean(settings.daemon),
    homeReachable: connectivity.homeReachable,
    preferRemoteHub: settings.preferRemoteHub,
  });
  const crew = settings.crew ?? [];
  const projects = settings.projects ?? [];
  const routines = routinesState.routines;
  // An empty crew leads with the advisor team, so only one action is filled.
  const firstCrew = crew.length === 0;
  // No computer paired and no routine: the door to Crew command is a quiet
  // row (D17). On the desktop, docked or away, or once a routine exists, it
  // is the hero again.
  const quietDoor = control.where === 'unpaired' && routines.length === 0;
  const titleRef = useRef<HTMLHeadingElement>(null);

  // The roster shows each member's presence, so the room asks the computer
  // once on arrival (the command center keeps it live).
  useEffect(() => {
    void refreshRoutines();
  }, [refreshRoutines]);

  const [draft, setDraft] = useState<Draft | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const deleting = crew.find((a) => a.id === confirmDelete);
  const editing = draft?.id ? crew.find((a) => a.id === draft.id) : undefined;

  const scopeLabel = (a: CrewAgent) => {
    if (a.projectIds.length === 0) return 'All projects';
    const names = projects.filter((p) => a.projectIds.includes(p.id)).map((p) => p.name);
    return names.length ? names.join(', ') : 'All projects';
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const persona = draft.persona.trim();
    if (!name || !persona) {
      showToast('A crew member needs a name and a persona.');
      return;
    }
    const payload = {
      name,
      persona,
      whenCalled: draft.whenCalled?.trim() || undefined,
      activityLevel: draft.activityLevel,
      projectIds: draft.projectIds,
    };
    // Held at the paid door (the sheet opened instead): keep the draft.
    const saved = draft.id
      ? await updateCrewAgent(draft.id, payload)
      : Boolean(await createCrewAgent(payload));
    if (!saved) return;
    setDraft(undefined);
    showToast(draft.id ? 'Crew member updated.' : `${name} joined your crew.`);
  };

  // A maintainer's advisory org, as a crew: eight named perspectives the
  // Reasoning model can bring in. Adds only the ones not already here, so the
  // tap is safe to repeat and never duplicates a member someone customized.
  const missingAdvisors = ADVISOR_TEAM.filter((p) => !crew.some((a) => a.name === p.name));
  const addAdvisorTeam = async () => {
    for (const p of missingAdvisors) {
      const id = await createCrewAgent({
        name: p.name,
        persona: p.persona,
        whenCalled: p.whenCalled,
        activityLevel: p.activityLevel,
        projectIds: [],
      });
      // Held at the paid door: the sheet is open, and nothing joined.
      if (!id) return;
    }
    showToast(
      missingAdvisors.length === 0
        ? 'Your advisor team is already here.'
        : missingAdvisors.length === 1
          ? `${missingAdvisors[0]!.name} joined your crew.`
          : `${missingAdvisors.length} advisors joined your crew.`,
    );
  };

  return (
    <div className="screen">
      <BackBar title="Crew" titleHiddenUntil={titleRef} />
      <div className="screen-inner">
        <h1 ref={titleRef}>Crew</h1>
        <p className="lead">
          Build your own agents. Each has a name, a persona, and a rule for how and when it is
          called. Point them at specific projects, or let them work across all of them.
        </p>

        {/* The door to the command center: the crew's unattended work, with
            a live line so the roster reads as a team, not a list. Before a
            computer is paired and with no routine, the room behind it can only
            say pair first, so the door is a plain card row and the dark hero
            waits until there is work to show (D17, 2026-10-07). */}
        {quietDoor ? (
          <button
            type="button"
            className="card card-disclosure crew-command-row press-fb press-fb--row"
            onClick={openCrewCommand}
          >
            <span className="crew-command-row-body">
              <span className="card-title">Crew command</span>
              <span className="sub">{ROUTINES_RUN_LINE}</span>
            </span>
            <span className="disclosure-chevron" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="crew-command-door press-fb press-fb--row"
            onClick={openCrewCommand}
          >
            <span className="crew-command-door-body">
              <span className="crew-command-door-kicker">
                Crew command
                {control.where === 'away' ? ' · View only' : control.can ? ' · In control' : ''}
              </span>
              <span className="crew-command-door-title">
                {routines.length ? 'Your crew at work' : 'Put your crew to work'}
              </span>
              <span className="crew-command-door-sub">
                {control.where === 'unpaired'
                  ? ROUTINES_RUN_LINE
                  : control.where === 'away'
                    ? `${ROUTINES_RUN_LINE} Reconnect to take control.`
                    : crewHeadline(routines, routinesState.runs)}
              </span>
            </span>
            <span className="cc-row-chevron" aria-hidden="true" />
          </button>
        )}

        <button
          className={`btn ${firstCrew ? 'ghost' : 'primary'} block press-fb crew-new`}
          onClick={() => setDraft(emptyDraft())}
        >
          New crew member
        </button>

        {missingAdvisors.length ? (
          <div className="card crew-advisors">
            <span className="eyebrow">Advisors</span>
            <h3 className="crew-advisors-title">A ready-made team, in one tap</h3>
            <p className="sub">
              Eight general advisors for whatever you are building. One reviews the work, three step
              in when a decision needs them, and four answer when asked. All advisory. You decide.
            </p>
            <button
              className={`btn ${firstCrew ? 'primary' : 'ghost'} block press-fb`}
              style={{ marginTop: 12 }}
              onClick={() => void addAdvisorTeam()}
            >
              {/* The line above already says eight; the count shows only
                  once part of the team is here. */}
              Add the advisor team
              {missingAdvisors.length < ADVISOR_TEAM.length ? ` (${missingAdvisors.length})` : ''}
            </button>
          </div>
        ) : null}

        {crew.length ? (
          <span className="eyebrow" style={{ marginTop: 18 }}>
            Your crew
          </span>
        ) : null}

        {/* The whole card is the Edit tap, and a swipe left deletes, the way
            Crew command's routines do (D18, 2026-10-07). The swipe's
            tap does nothing of its own: the card is a real button, so a tap,
            a key, or VoiceOver opens the editor, and the editor's foot holds
            Delete for a pointer or a screen reader. */}
        {crew.map((a) => (
          <SwipeRow
            key={a.id}
            variant="danger"
            label="Delete"
            className="crew-card-swipe"
            onTap={() => {}}
            onToggle={() => setConfirmDelete(a.id)}
          >
            <button
              type="button"
              className="card crew-card press-fb press-fb--row"
              onClick={() => setDraft({ ...a })}
            >
              <span className="card-row">
                <span className={`crew-monogram ${a.activityLevel}`} aria-hidden="true">
                  {(a.name.trim()[0] ?? '?').toUpperCase()}
                </span>
                <span className="grow">
                  <span className="card-title">{a.name}</span>
                  <span className="sub crew-card-meta">
                    {levelLabel(a.activityLevel)} · {scopeLabel(a)}
                  </span>
                </span>
              </span>
              <span className="sub crew-card-line">{a.whenCalled?.trim() || a.persona}</span>
              {(() => {
                const mine = routinesForAgent(routines, a);
                const line = agentPresenceLine(mine);
                if (!line) return null;
                const busiest = busiestFirst(mine)[0]!;
                return (
                  <span className="crew-presence">
                    <span
                      className={`cc-dot ${presenceTone(busiest.presence)}`}
                      aria-hidden="true"
                    />
                    {line}
                  </span>
                );
              })()}
            </button>
          </SwipeRow>
        ))}
      </div>

      {/* Editor sheet: identity, persona, call rule, activity level, projects. */}
      <Sheet open={Boolean(draft)} onClose={() => setDraft(undefined)}>
        {draft ? (
          <>
            <SheetHead
              title={draft.id ? 'Edit crew member' : 'New crew member'}
              onClose={() => setDraft(undefined)}
            />

            <div className="field">
              <label htmlFor="crew-member-name">Name</label>
              <input
                id="crew-member-name"
                placeholder="e.g. Security Reviewer, Ghostwriter, Contrarian"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="crew-member-persona">Persona</label>
              <textarea
                id="crew-member-persona"
                rows={4}
                placeholder="Who this agent is, how it thinks, and how it should speak."
                value={draft.persona}
                onChange={(e) => setDraft({ ...draft, persona: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="crew-member-when">How and when it is called (optional)</label>
              <input
                id="crew-member-when"
                placeholder="e.g. anything touching auth or payments"
                value={draft.whenCalled ?? ''}
                onChange={(e) => setDraft({ ...draft, whenCalled: e.target.value })}
              />
            </div>

            {/* All three levels in view, each with its line, so the choice is
                read before it is made, not after. */}
            <div className="field">
              <label id="crew-member-level">Activity level</label>
              <div className="mode-list" role="radiogroup" aria-labelledby="crew-member-level">
                {LEVELS.map((l) => {
                  const on = draft.activityLevel === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className="mode-row press-fb press-fb--row"
                      onClick={() => setDraft({ ...draft, activityLevel: l.id })}
                    >
                      <span className="mode-row-text">
                        <span className="mode-row-title">{l.label}</span>
                        <span className="mode-row-desc">{l.hint}</span>
                      </span>
                      {on ? (
                        <span className="mode-row-check" aria-hidden="true">
                          <CheckGlyph size={18} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label>Projects</label>
              <ProjectMultiSelect
                projects={projects}
                selected={draft.projectIds}
                onChange={(ids) => setDraft({ ...draft, projectIds: ids })}
              />
            </div>

            <div className="sheet-actions">
              <button
                className="btn primary"
                disabled={!draft.name.trim() || !draft.persona.trim()}
                onClick={() => void save()}
              >
                {draft.id ? 'Save' : 'Add to crew'}
              </button>
              {/* The quiet way to delete, for a pointer or a screen reader
                  (D18): the same confirm and toast the swipe opens, named
                  for the member as saved, not as typed. */}
              {editing ? (
                <button
                  type="button"
                  className="btn block crew-editor-delete press-fb"
                  onClick={() => {
                    setDraft(undefined);
                    setConfirmDelete(editing.id);
                  }}
                >
                  Delete {editing.name}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(undefined)}
        variant="confirm"
      >
        {confirmDelete ? (
          <>
            <h3>Delete {deleting?.name ?? 'this crew member'}?</h3>
            <p>Routines that use it keep their schedule. This cannot be undone.</p>
            <div className="confirm-row">
              <button className="btn ghost" onClick={() => setConfirmDelete(undefined)}>
                Keep
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const id = confirmDelete;
                  setConfirmDelete(undefined);
                  await deleteCrewAgent(id);
                  showToast('Crew member deleted.');
                }}
              >
                Delete
              </button>
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
