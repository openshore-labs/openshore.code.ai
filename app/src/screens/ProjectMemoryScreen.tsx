// The read-only project memory view. A project's five notes live in its primary
// repo under "OpenShore Project <name> MDs/"; here the person browses them,
// Current State first, and reads each one. Read only on purpose: the agent
// writes and commits them, the app only shows them. Reached from the Vault
// section (openProjectMemory), so its top bar goes back to the Vault.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from '../components/BackBar.js';
import { VaultMarkdown } from '../components/VaultMarkdown.js';
import { isDesktop } from '../lib/platform.js';
import { bridge } from '../lib/electronBridge.js';
import { repoAccessToken } from '../lib/gitos/repoOAuth.js';
import { noteTitle } from '../lib/vault.js';
import {
  readProjectSecrets,
  secretsTemplate,
  writeProjectSecrets,
  SECRETS_NOTE_TITLE,
} from '../lib/projectSecrets.js';
import {
  githubRepoReader,
  localRepoReader,
  listMemoryNotes,
  primaryRepoSource,
  readMemoryNote,
  segmentForProject,
  type MemoryListing,
  type RepoReader,
  type RepoSource,
} from '../lib/projectMemoryRead.js';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'no-repo' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; source: RepoSource; listing: MemoryListing };

/** Build a reader for the chosen source, resolving a GitHub token when needed.
 *  Returns undefined when a GitHub source has no usable token (not connected). */
async function readerFor(source: RepoSource): Promise<RepoReader | undefined> {
  if (source.kind === 'local') {
    const b = bridge();
    return b ? localRepoReader(source.root, b) : undefined;
  }
  const token = await repoAccessToken('github');
  return token ? githubRepoReader(source.owner, source.repo, token) : undefined;
}

export function ProjectMemoryScreen() {
  const { viewProjectId, settings, setView } = useApp();
  const project = settings.projects?.find((p) => p.id === viewProjectId);
  const secretsOn = Boolean(settings.storeSecrets);

  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [open, setOpen] = useState<{ title: string; text: string } | null>(null);
  const [reader, setReader] = useState<RepoReader | undefined>(undefined);
  // The Tokens and Secrets note is device-local and editable (not a repo note),
  // so it has its own editor state, separate from the read-only note view above.
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [secretsDraft, setSecretsDraft] = useState('');
  const secretsSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveSecrets = useCallback(
    (text: string) => {
      if (!project) return;
      setSecretsDraft(text);
      clearTimeout(secretsSaveTimer.current);
      secretsSaveTimer.current = setTimeout(() => {
        void writeProjectSecrets(project.id, text);
      }, 500);
    },
    [project],
  );

  const openSecrets = useCallback(async () => {
    if (!project) return;
    const stored = await readProjectSecrets(project.id);
    setSecretsDraft(stored.trim() ? stored : secretsTemplate());
    setSecretsOpen(true);
  }, [project]);

  const closeSecrets = useCallback(() => {
    clearTimeout(secretsSaveTimer.current);
    if (project) void writeProjectSecrets(project.id, secretsDraft);
    setSecretsOpen(false);
  }, [project, secretsDraft]);

  const load = useCallback(async () => {
    if (!project) {
      setState({ phase: 'error', message: 'This project could not be found.' });
      return;
    }
    setState({ phase: 'loading' });
    const source = primaryRepoSource(project.repoIds, { canReadLocal: isDesktop() });
    if (!source) {
      setState({ phase: 'no-repo' });
      return;
    }
    try {
      const r = await readerFor(source);
      if (!r) {
        setState({
          phase: 'error',
          message:
            source.kind === 'github'
              ? 'Connect your GitHub account to read these notes on this device.'
              : 'This device cannot reach the project files.',
        });
        return;
      }
      setReader(() => r);
      const listing = await listMemoryNotes(r, segmentForProject(project.name));
      setState({ phase: 'ready', source, listing });
    } catch {
      setState({
        phase: 'error',
        message: 'Could not reach the repository. Check your connection and try again.',
      });
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNote = async (path: string) => {
    if (!reader) return;
    try {
      const text = await readMemoryNote(reader, path);
      if (text === undefined) {
        // Present in the list but unreadable now: reload to reflect the truth.
        void load();
        return;
      }
      setOpen({ title: noteTitle(path), text });
    } catch {
      setState({
        phase: 'error',
        message: 'Could not open that note. Check your connection and try again.',
      });
    }
  };

  // ---- a single note, read only ------------------------------------------
  if (open) {
    return (
      <div className="screen">
        <BackBar
          title={open.title}
          back={{ to: project?.name ?? 'Project notes', onBack: () => setOpen(null) }}
        />
        <div className="screen-inner">
          <h1 className="vault-title">{open.title}</h1>
          <p className="hint" style={{ marginTop: 2 }}>
            Read only. The agent keeps this current in the repo.
          </p>
          <VaultMarkdown text={open.text} paths={[]} onOpenNote={() => {}} />
        </div>
      </div>
    );
  }

  // ---- the Tokens and Secrets note, editable, device-local ---------------
  if (secretsOpen) {
    return (
      <div className="screen">
        <BackBar
          title={SECRETS_NOTE_TITLE}
          back={{ to: project?.name ?? 'Project notes', onBack: closeSecrets }}
        />
        <div className="screen-inner">
          <h1 className="vault-title">{SECRETS_NOTE_TITLE}</h1>
          <p className="hint" style={{ marginTop: 2 }}>
            Private to this device. Encrypted at rest. Never pushed to your repo, never synced. A
            local model can use these; a cloud model never receives them.
          </p>
          <div className="vault-editor-wrap">
            <textarea
              className="vault-editor"
              autoFocus
              value={secretsDraft}
              placeholder="Record the project's tokens and secrets here."
              onChange={(e) => saveSecrets(e.target.value)}
            />
          </div>
        </div>
      </div>
    );
  }

  // ---- the project's note list -------------------------------------------
  return (
    <div className="screen">
      <BackBar title={project?.name ?? 'Project notes'} />
      <div className="screen-inner">
        <div className="stack-head">
          <h1>{project?.name ?? 'Project notes'}</h1>
        </div>
        <p className="lead">
          Historical knowledge for this project, kept by the coding agent in the repo. Read the
          Current State top sheet first, then dig deeper.
        </p>

        {state.phase === 'loading' ? (
          <p className="hint">Loading the project notes...</p>
        ) : state.phase === 'no-repo' ? (
          <div className="greeting" style={{ minHeight: '30vh' }}>
            <h1>No repository yet.</h1>
            <p>
              These notes live in the project's repository. Attach a repository to the project, and
              the agent creates the notes as it works.
            </p>
          </div>
        ) : state.phase === 'error' ? (
          <div className="greeting" style={{ minHeight: '30vh' }}>
            <h1>Could not load the notes.</h1>
            <p>{state.message}</p>
            <button className="btn primary" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : !state.listing.folderExists ? (
          <div className="greeting" style={{ minHeight: '30vh' }}>
            <h1>Not set up yet.</h1>
            <p>
              The agent creates these notes the first time it works on this project. Once it does,
              they appear here, in the repo under "OpenShore Project {project?.name} MDs".
            </p>
          </div>
        ) : (
          <div className="vault-tree">
            {state.listing.notes.map((n) =>
              n.present ? (
                <button
                  key={n.path}
                  className="conv-item vault-row press-fb press-fb--row"
                  onClick={() => void openNote(n.path)}
                >
                  {n.title}
                  {n.title === 'Current State' ? (
                    <span className="pill local vault-topsheet">Top sheet</span>
                  ) : null}
                </button>
              ) : (
                <div key={n.path} className="conv-item vault-row vault-row--absent">
                  {n.title}
                  <span className="hint vault-topsheet">not created yet</span>
                </div>
              ),
            )}
          </div>
        )}

        {/* Tokens and Secrets: device-local and private, separate from the repo
            notes. Grayed out until the person turns it on in Settings. */}
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-row">
            <h3 style={{ marginBottom: 0 }}>Private to this device</h3>
          </div>
          {secretsOn ? (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Encrypted here, never pushed to your repo or synced. A local model can use these to
                run without asking you to paste a credential again.
              </p>
              <div className="vault-tree">
                <button
                  className="conv-item vault-row press-fb press-fb--row"
                  onClick={() => void openSecrets()}
                >
                  <span aria-hidden="true">{'\u{1F512}'} </span>
                  {SECRETS_NOTE_TITLE}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Keep this project's tokens and secrets in one encrypted, on-device place.
              </p>
              <button
                className="conv-item vault-row vault-row--absent press-fb press-fb--row"
                onClick={() => setView('settings')}
              >
                <span aria-hidden="true">{'\u{1F512}'} </span>
                {SECRETS_NOTE_TITLE}
                <span className="hint vault-topsheet">Toggle on in Settings to enable</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
