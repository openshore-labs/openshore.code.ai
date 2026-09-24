// Currents, chosen per project. A current is a workflow choice, so it lives in
// a project's settings, not the app's: different projects run simultaneously
// with different currents selected. Connecting a current (its endpoint + key)
// is still a device-local, connect-once step (the sheets below write global
// settings); only WHICH current is active is per project.
//
// Two groups, Harness above Agentic, mirroring what used to sit in Settings.
// Each row is the two-part gate made visible for THIS project: the switch and
// the honest state line. The proper nouns live in the rosters, never here,
// except the two group titles (allow-listed in the guard tests).
import { useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';
import { Switch } from './Switch.js';
import { CurrentConnectSheet } from './CurrentConnectSheet.js';
import { HarnessCurrentConnectSheet } from './HarnessCurrentConnectSheet.js';
import { ForgetCurrentConfirm } from './ForgetCurrentConfirm.js';
import { hapticCommit } from '../lib/haptics.js';
import {
  AGENTIC_CURRENTS,
  AGENTIC_CURRENTS_BETA_LINE,
  activeCurrent,
  currentConfigured,
  currentInfo,
  currentState,
  currentStateLabel,
  currentStateLine,
  projectCurrentsSettings,
  type AgenticCurrentId,
} from '../lib/currents.js';
import {
  HARNESS_CURRENTS,
  HARNESS_CURRENTS_BETA_LINE,
  activeHarnessCurrent,
  harnessCurrentConfigured,
  harnessCurrentInfo,
  harnessCurrentState,
  harnessCurrentStateLine,
  projectHarnessSettings,
  type HarnessCurrentId,
} from '../lib/harnessCurrents.js';

/** One Agentic Current row, scoped to a project's selection. */
function AgenticRow({
  projectId,
  id,
  onOpen,
}: {
  projectId: string;
  id: AgenticCurrentId;
  onOpen: () => void;
}) {
  const { settings, currentProbes, setAgenticCurrent } = useApp();
  const project = settings.projects?.find((p) => p.id === projectId);
  const view = projectCurrentsSettings(project, settings.currentConnections);
  const info = currentInfo(id);
  const state = currentState(id, view, currentProbes);
  const on = activeCurrent(view) === id;
  const anchor = useRef<HTMLSpanElement>(null);
  const flip = (next: boolean) => {
    const rect = anchor.current?.getBoundingClientRect();
    const at = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth - 40, y: window.innerHeight / 2 };
    if (next) hapticCommit();
    void setAgenticCurrent(projectId, id, next, at);
    if (next && !currentConfigured(id, view)) onOpen();
  };
  return (
    <SettingsRow
      label={info.label}
      sub={currentStateLine(id, view, currentProbes)}
      subWrap
      value={
        <span className="settings-row-actions">
          {!info.available && state !== 'on' ? (
            <span className="pill muted" title={info.needs}>
              Arriving
            </span>
          ) : state === 'ready' ? (
            <span className="pill ok">{currentStateLabel(state)}</span>
          ) : null}
          <button type="button" className="linklike press-fb" onClick={onOpen}>
            {currentConfigured(id, view) ? 'Edit' : 'Set up'}
          </button>
        </span>
      }
      trailing={
        <span ref={anchor} className="settings-row-switch">
          <Switch checked={on} label={info.label} onChange={flip} />
        </span>
      }
    />
  );
}

/** One Harness Current row, scoped to a project's selection. */
function HarnessRow({
  projectId,
  id,
  onOpen,
}: {
  projectId: string;
  id: HarnessCurrentId;
  onOpen: () => void;
}) {
  const { settings, harnessCurrentProbes, setHarnessCurrent } = useApp();
  const project = settings.projects?.find((p) => p.id === projectId);
  const view = projectHarnessSettings(project, settings.harnessCurrentConnections);
  const info = harnessCurrentInfo(id);
  const state = harnessCurrentState(id, view, harnessCurrentProbes);
  const on = activeHarnessCurrent(view) === id;
  const anchor = useRef<HTMLSpanElement>(null);
  const flip = (next: boolean) => {
    const rect = anchor.current?.getBoundingClientRect();
    const at = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth - 40, y: window.innerHeight / 2 };
    if (next) hapticCommit();
    void setHarnessCurrent(projectId, id, next, at);
    if (next && !harnessCurrentConfigured(id, view)) onOpen();
  };
  return (
    <SettingsRow
      label={info.label}
      sub={harnessCurrentStateLine(id, view, harnessCurrentProbes)}
      subWrap
      value={
        <span className="settings-row-actions">
          {state === 'ready' ? <span className="pill ok">{currentStateLabel(state)}</span> : null}
          <button type="button" className="linklike press-fb" onClick={onOpen}>
            {harnessCurrentConfigured(id, view) ? 'Edit' : 'Set up'}
          </button>
        </span>
      }
      trailing={
        <span ref={anchor} className="settings-row-switch">
          <Switch checked={on} label={info.label} onChange={flip} />
        </span>
      }
    />
  );
}

/** Both currents groups for one project, plus the connect sheets. `index` is
 *  the settings-group animation index to start from (two groups are used). */
export function ProjectCurrents({ projectId, index }: { projectId: string; index: number }) {
  const [agenticSheet, setAgenticSheet] = useState<AgenticCurrentId | undefined>();
  const [harnessSheet, setHarnessSheet] = useState<HarnessCurrentId | undefined>();
  const disconnectCurrent = useApp((s) => s.disconnectCurrent);
  const disconnectHarnessCurrent = useApp((s) => s.disconnectHarnessCurrent);
  // The connection waiting on a forget confirm (its roster label rides along).
  const [forgetting, setForgetting] = useState<
    | { group: 'agentic'; id: AgenticCurrentId; label: string }
    | { group: 'harness'; id: HarnessCurrentId; label: string }
    | undefined
  >();
  return (
    <>
      <SettingsGroup
        title="Harness Currents"
        badge="BETA"
        intro={HARNESS_CURRENTS_BETA_LINE}
        index={index}
      >
        {HARNESS_CURRENTS.map((c) => (
          <HarnessRow
            key={c.id}
            projectId={projectId}
            id={c.id}
            onOpen={() => setHarnessSheet(c.id)}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Agentic Currents"
        badge="BETA"
        intro={AGENTIC_CURRENTS_BETA_LINE}
        index={index + 1}
      >
        {AGENTIC_CURRENTS.map((c) => (
          <AgenticRow
            key={c.id}
            projectId={projectId}
            id={c.id}
            onOpen={() => setAgenticSheet(c.id)}
          />
        ))}
      </SettingsGroup>

      <CurrentConnectSheet
        id={agenticSheet}
        onClose={() => setAgenticSheet(undefined)}
        onForget={(id, label) => setForgetting({ group: 'agentic', id, label })}
      />
      <HarnessCurrentConnectSheet
        id={harnessSheet}
        onClose={() => setHarnessSheet(undefined)}
        onForget={(id, label) => setForgetting({ group: 'harness', id, label })}
      />
      {/* A forget reaches every project, so it asks first. The connect sheet
          leaves as the confirm card arrives. */}
      <ForgetCurrentConfirm
        label={forgetting?.label}
        onKeep={() => setForgetting(undefined)}
        onForget={() => {
          const f = forgetting;
          setForgetting(undefined);
          if (!f) return;
          if (f.group === 'agentic') void disconnectCurrent(f.id);
          else void disconnectHarnessCurrent(f.id);
        }}
      />
    </>
  );
}
