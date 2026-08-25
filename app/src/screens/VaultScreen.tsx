// Vault: an Obsidian-compatible markdown knowledge base, the first consumer
// of the gitOS storage seam. Plain .md files in folders, [[wikilinks]], an
// edit/read toggle, and Linked mentions, all rendered in OS Code's own paper
// and ink rather than anyone else's dark theme. Design: the studio's "Paper
// Study" direction.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from '../components/BackBar.js';
import { VaultMarkdown } from '../components/VaultMarkdown.js';
import {
  backlinksTo,
  noteFolder,
  noteTitle,
  normalizeNotePath,
  treeAt,
  wikilinkContext,
} from '../lib/vault.js';
import {
  PROVIDER_ROSTER,
  probeReady,
  isGdriveConfigured,
  type GitosResource,
  type StorageProviderId,
} from '../lib/gitos/index.js';
import { exportVaultToFiles } from '../lib/vaultExport.js';

const VAULT_RESOURCE_ID = 'vault.personal';

export function VaultScreen() {
  const {
    vaultFiles,
    vaultNote,
    vaultScope,
    setVaultScope,
    teamVaultAvailable,
    vaultRefresh,
    vaultOpen,
    vaultCloseNote,
    vaultSave,
    vaultDelete,
    vaultReadAll,
    vaultMoveTo,
    connectGdriveAccount,
    disconnectGdriveAccount,
    settings,
    showToast,
  } = useApp();

  const team = vaultScope === 'team';
  const teamAvailable = teamVaultAvailable();

  const [folder, setFolder] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [storageOpen, setStorageOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [backlinks, setBacklinks] = useState<Array<{ path: string; excerpt: string }>>([]);
  const [ready, setReady] = useState<Partial<Record<StorageProviderId, boolean>>>({});
  const [moving, setMoving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  // Live [[wikilink]] autocomplete. When the caret sits inside an unclosed
  // "[[ ...", linkQuery is what has been typed since the brackets and linkStart
  // is the index of the "[[", so a pick replaces exactly that span.
  const [linkQuery, setLinkQuery] = useState<string | null>(null);
  const [linkStart, setLinkStart] = useState(0);

  // If the team vault stops being available while it is open (sign-out), drop
  // back to the personal vault so the screen never shows an empty dead end.
  useEffect(() => {
    if (team && !teamAvailable) void setVaultScope('personal');
  }, [team, teamAvailable, setVaultScope]);

  // Recompute the autocomplete context from the editor value and caret.
  const refreshLinkContext = useCallback((value: string, caret: number) => {
    const ctx = wikilinkContext(value, caret);
    if (!ctx) return setLinkQuery(null);
    setLinkStart(ctx.start);
    setLinkQuery(ctx.query);
  }, []);

  const currentProviderId: StorageProviderId =
    (settings.gitosResources as GitosResource[] | undefined)?.find(
      (r) => r.id === VAULT_RESOURCE_ID,
    )?.providerId ?? 'local';

  // Probe live readiness when the storage sheet opens, so iCloud shows as
  // usable only on a device that can actually reach it.
  useEffect(() => {
    if (!storageOpen) return;
    let live = true;
    void Promise.all(PROVIDER_ROSTER.map((p) => probeReady(p.id))).then((flags) => {
      if (!live) return;
      const map: Partial<Record<StorageProviderId, boolean>> = {};
      PROVIDER_ROSTER.forEach((p, i) => (map[p.id] = flags[i]));
      setReady(map);
    });
    return () => {
      live = false;
    };
  }, [storageOpen]);

  useEffect(() => {
    void vaultRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paths = useMemo(() => vaultFiles.map((f) => f.path), [vaultFiles]);

  // Load the draft and Linked mentions whenever a note opens.
  useEffect(() => {
    if (!vaultNote) return;
    setDraft(vaultNote.text);
    setEditing(vaultNote.text === '');
    let live = true;
    void vaultReadAll().then((notes) => {
      if (live) setBacklinks(backlinksTo(vaultNote.path, notes));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultNote?.path]);

  // Obsidian saves as you type; so do we, debounced so the sealed store is
  // not hammered per keystroke. Anything pending flushes on unmount.
  const scheduleSave = useCallback(
    (path: string, text: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = undefined;
        void vaultSave(path, text);
      }, 600);
    },
    [vaultSave],
  );
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const openNote = (path: string) => {
    void vaultOpen(path);
  };

  const createNote = () => {
    const path = normalizeNotePath(folder ? `${folder}/${newName}` : newName);
    if (!path) {
      showToast('Give the note a name.');
      return;
    }
    setNewOpen(false);
    setNewName('');
    void vaultOpen(path);
  };

  const entries = treeAt(folder, vaultFiles);
  const crumbs = folder ? folder.split('/') : [];

  // ---- note view ----------------------------------------------------------
  if (vaultNote) {
    const title = noteTitle(vaultNote.path);
    const parent = noteFolder(vaultNote.path);
    const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

    // Autocomplete candidates for the open "[[": notes whose title or path
    // matches, best-prefix first. A non-matching, non-empty query also offers
    // to link a brand new note of that name (created on first open, like a tap
    // on a dashed link).
    const q = (linkQuery ?? '').trim().toLowerCase();
    const linkMatches =
      linkQuery === null
        ? []
        : paths
            .filter((p) => p !== vaultNote.path)
            .map((p) => ({ p, t: noteTitle(p) }))
            .filter(({ p, t }) => !q || t.toLowerCase().includes(q) || p.toLowerCase().includes(q))
            .sort((a, b) => {
              const ap = a.t.toLowerCase().startsWith(q) ? 0 : 1;
              const bp = b.t.toLowerCase().startsWith(q) ? 0 : 1;
              return ap - bp || a.t.length - b.t.length;
            })
            .slice(0, 6);
    const canCreate =
      linkQuery !== null && q.length > 0 && !paths.some((p) => noteTitle(p).toLowerCase() === q);

    const insertWikilink = (targetName: string) => {
      const el = editorRef.current;
      const caret = el?.selectionStart ?? draft.length;
      const before = draft.slice(0, linkStart);
      const after = draft.slice(caret);
      const inserted = `[[${targetName}]]`;
      const next = before + inserted + after;
      setDraft(next);
      scheduleSave(vaultNote.path, next);
      setLinkQuery(null);
      const pos = before.length + inserted.length;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    };

    return (
      <div className="screen">
        <BackBar title="Vault" />
        <div className="screen-inner vault-note">
          <div className="vault-note-bar">
            <button
              className="linklike"
              onClick={() => {
                setFolder(parent);
                vaultCloseNote();
              }}
            >
              All notes
            </button>
            <div style={{ flex: 1 }} />
            <button
              className="icon-btn"
              aria-label={editing ? 'Read' : 'Edit'}
              aria-pressed={editing}
              onClick={() => setEditing((e) => !e)}
            >
              {editing ? (
                <svg
                  viewBox="0 0 24 24"
                  width="19"
                  height="19"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 5a2 2 0 0 1 2-2h4a3 3 0 0 1 3 3v14a2.5 2.5 0 0 0-2.5-2.5H3V5Z" />
                  <path d="M21 5a2 2 0 0 0-2-2h-4a3 3 0 0 0-3 3v14a2.5 2.5 0 0 1 2.5-2.5H21V5Z" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="19"
                  height="19"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M17 3.5 20.5 7 8.5 19l-4.5 1 1-4.5L17 3.5Z" />
                </svg>
              )}
            </button>
            <button className="icon-btn" aria-label="Options" onClick={() => setMenuOpen(true)}>
              {'⋯'}
            </button>
          </div>

          <h1 className="vault-title">{title}</h1>
          <p className="hint" style={{ marginTop: 2 }}>
            {(parent || 'Vault') + ' · ' + words + (words === 1 ? ' word' : ' words')}
          </p>

          {editing ? (
            <div className="vault-editor-wrap">
              <textarea
                ref={editorRef}
                className="vault-editor"
                autoFocus
                value={draft}
                placeholder="Write. Plain markdown, and [[wikilinks]] to connect notes."
                onChange={(e) => {
                  setDraft(e.target.value);
                  scheduleSave(vaultNote.path, e.target.value);
                  refreshLinkContext(
                    e.target.value,
                    e.target.selectionStart ?? e.target.value.length,
                  );
                }}
                onKeyUp={(e) =>
                  refreshLinkContext(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
                }
                onSelect={(e) =>
                  refreshLinkContext(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
                }
                onBlur={() => setLinkQuery(null)}
              />
              {linkQuery !== null && (linkMatches.length > 0 || canCreate) ? (
                <div className="vault-link-suggest" role="listbox" aria-label="Link a note">
                  {linkMatches.map(({ p, t }) => (
                    <button
                      key={p}
                      className="vault-link-chip"
                      // onMouseDown, not onClick, so the pick lands before the
                      // textarea's blur clears the autocomplete context.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertWikilink(t);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  {canCreate ? (
                    <button
                      className="vault-link-chip vault-link-new"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertWikilink((linkQuery ?? '').trim());
                      }}
                    >
                      New: {(linkQuery ?? '').trim()}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <VaultMarkdown
              text={draft}
              paths={paths}
              onOpenNote={(p, isNew) => {
                if (isNew) showToast('A fresh note. It saves as you write.');
                openNote(p);
              }}
            />
          )}

          {!editing && backlinks.length > 0 ? (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="card-row">
                <h3 style={{ marginBottom: 0 }}>Linked mentions</h3>
                <span className="pill local">{backlinks.length}</span>
              </div>
              {backlinks.map((b) => (
                <button key={b.path} className="vault-mention" onClick={() => openNote(b.path)}>
                  <span className="vault-mention-title">{noteTitle(b.path)}</span>
                  <span className="vault-mention-excerpt">{b.excerpt}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {menuOpen ? (
          <div className="sheet-scrim" onClick={() => setMenuOpen(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <h2>Options</h2>
              <div className="sheet-actions">
                <button
                  className="btn quiet"
                  onClick={() => {
                    const path = vaultNote.path;
                    setMenuOpen(false);
                    void vaultDelete(path);
                    showToast('Note deleted.');
                  }}
                >
                  Delete this note
                </button>
                <button className="btn quiet" onClick={() => setMenuOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ---- tree view ----------------------------------------------------------
  return (
    <div className="screen">
      <BackBar title="Vault" />
      <div className="screen-inner">
        <div className="stack-head">
          <h1>Vault</h1>
          <button
            className="stack-add-btn"
            aria-label="New note"
            title="New note"
            onClick={() => setNewOpen(true)}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        {teamAvailable ? (
          <div
            className="segmented"
            role="tablist"
            aria-label="Which vault"
            style={{ marginBottom: 10 }}
          >
            <button
              role="tab"
              aria-selected={!team}
              className={`seg${!team ? ' active' : ''}`}
              onClick={() => void setVaultScope('personal')}
            >
              Personal
            </button>
            <button
              role="tab"
              aria-selected={team}
              className={`seg${team ? ' active' : ''}`}
              onClick={() => void setVaultScope('team')}
            >
              Team
            </button>
          </div>
        ) : null}
        <p className="lead">
          {team
            ? 'Shared markdown your whole team reads and writes. Saved to your organization.'
            : 'Plain markdown files you own, that you and your agent both write.'}
          {!team ? (
            <>
              {' '}
              <button className="linklike" onClick={() => setStorageOpen(true)}>
                Where it lives
              </button>
            </>
          ) : null}
        </p>

        {crumbs.length ? (
          <p className="hint vault-crumbs">
            <button className="linklike" onClick={() => setFolder('')}>
              Vault
            </button>
            {crumbs.map((c, i) => (
              <span key={i}>
                {' / '}
                <button
                  className="linklike"
                  onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))}
                >
                  {c}
                </button>
              </span>
            ))}
          </p>
        ) : null}

        {vaultFiles.length === 0 ? (
          <div className="greeting" style={{ minHeight: '40vh' }}>
            <h1>{team ? 'Your team vault is empty.' : 'Your vault starts with one note.'}</h1>
            <p>
              {team
                ? 'The first note you write is shared with your organization.'
                : 'Plain markdown files. Yours, on this device.'}
            </p>
            <button className="btn primary" onClick={() => setNewOpen(true)}>
              New note
            </button>
          </div>
        ) : (
          <div className="vault-tree">
            {entries.map((e) =>
              e.kind === 'folder' ? (
                <button
                  key={e.path}
                  className="conv-item vault-row"
                  onClick={() => setFolder(e.path)}
                >
                  <span className="vault-row-chevron" aria-hidden="true" />
                  {e.name}
                </button>
              ) : (
                <button
                  key={e.path}
                  className="conv-item vault-row"
                  onClick={() => openNote(e.path)}
                >
                  {e.name}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      {newOpen ? (
        <div className="sheet-scrim" onClick={() => setNewOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>New note</h2>
            <p className="sheet-sub">
              {folder ? `In ${folder}. ` : ''}A slash makes folders: ideas/first note.
            </p>
            <div className="field">
              <input
                autoFocus
                placeholder="Note name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createNote()}
              />
            </div>
            <div className="sheet-actions">
              <button className="btn primary" onClick={createNote}>
                Create
              </button>
              <button className="btn quiet" onClick={() => setNewOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {storageOpen ? (
        <div className="sheet-scrim" onClick={() => setStorageOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Where your vault lives</h2>
            <p className="sheet-sub">
              Your notes are files, and you choose the storage that holds them. Point Obsidian at
              the same files and it just opens.
            </p>
            <div className="sheet-actions">
              {PROVIDER_ROSTER.map((p) => {
                const isCurrent = p.id === currentProviderId;
                const isReady = ready[p.id] ?? p.ready;
                const move = async () => {
                  if (isCurrent) return;
                  let usable = isReady;
                  if (!usable && p.id === 'gdrive' && isGdriveConfigured()) {
                    // Not connected yet, but this build has the OAuth client:
                    // run the connect flow inline instead of just explaining
                    // that it is coming.
                    setMoving(true);
                    const result = await connectGdriveAccount();
                    if (!result.ok) {
                      setMoving(false);
                      showToast(result.error ?? 'Could not connect Google Drive.');
                      return;
                    }
                    usable = true;
                    setReady((r) => ({ ...r, gdrive: true }));
                  }
                  if (!usable) {
                    showToast(
                      p.pending ?? `${p.label} vaults are coming. Your vault can move there later.`,
                    );
                    return;
                  }
                  setMoving(true);
                  const ok = await vaultMoveTo(p.id).catch(() => false);
                  setMoving(false);
                  setStorageOpen(false);
                  showToast(
                    ok
                      ? `Your vault lives on ${p.label} now. It syncs from here.`
                      : `Could not move to ${p.label}. ${p.pending ?? 'Try again in a moment.'}`,
                  );
                };
                const disconnect = async () => {
                  setMoving(true);
                  await disconnectGdriveAccount();
                  setMoving(false);
                  setReady((r) => ({ ...r, gdrive: false }));
                  showToast('Disconnected Google Drive.');
                };
                return (
                  <div key={p.id} className="vault-provider-row">
                    <button
                      className="btn ghost vault-provider"
                      disabled={moving}
                      onClick={() => void move()}
                    >
                      <span className="grow" style={{ textAlign: 'left' }}>
                        {p.label}
                        <span className="sub" style={{ display: 'block', fontWeight: 400 }}>
                          {p.blurb}
                        </span>
                      </span>
                      {isCurrent ? (
                        <span className="pill local">Here now</span>
                      ) : isReady ? (
                        <span className="pill local">Move here</span>
                      ) : (
                        <span className="nav-lock-pill">Arriving</span>
                      )}
                    </button>
                    {p.id === 'gdrive' && isReady && !isCurrent ? (
                      <button
                        className="btn ghost vault-provider-disconnect"
                        disabled={moving}
                        onClick={() => void disconnect()}
                      >
                        Disconnect Google Drive
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <button
                className="btn ghost"
                onClick={async () => {
                  setStorageOpen(false);
                  const notes = await vaultReadAll();
                  if (!notes.length) {
                    showToast('Nothing to export yet. Write a note first.');
                    return;
                  }
                  const count = await exportVaultToFiles(notes).catch(() => undefined);
                  showToast(
                    count === undefined
                      ? 'Export needs the app on a device, not the browser.'
                      : `${count} ${count === 1 ? 'note' : 'notes'} exported to Files, under OS Code / Vault. Obsidian opens that folder as a vault.`,
                  );
                }}
              >
                Export as plain files
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
