// Rename or move a note or a folder (Vault M6 6.2; CTO K3 to K5 with R1; CX
// X5 to X7). One Sheet with three steps: the name and the folder; the folder
// list (the current one marked "Here now", "New folder" at the end); and,
// only when links point at what moves, "Update links?" with Update links and
// Rename only. The round close cancels at any step, and nothing renames.
//
// The sheet checks the name itself (the one new-name rule, and a taken name
// by the folded path) and asks its parent to plan (`prepare`, which reads the
// referring notes and counts) and to run (`apply`, which renames first, then
// rewrites one compare-and-swap write at a time). The parent owns the toast,
// the standing card, and closing the sheet when the run is done.
//
// Also here: the standing card on the renamed note that names each note whose
// links still point at the old name, with "Update the rest" (CX X7).
import { useEffect, useState } from 'react';
import { foldPath, noteFolder, noteTitle } from 'os-code/protocol';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import {
  VAULT_FOLDER_BAD_NAME,
  VAULT_FOLDER_CREATE,
  VAULT_FOLDER_NAME,
  VAULT_FOLDER_NEW,
  VAULT_FOLDER_RENAME,
  VAULT_RENAME_BAD_CHARS,
  VAULT_RENAME_FOLDER,
  VAULT_RENAME_HERE,
  VAULT_RENAME_MOVE,
  VAULT_RENAME_NAME,
  VAULT_RENAME_ROOT,
  VAULT_RENAME_SAVE,
  VAULT_RENAME_TITLE,
  VAULT_UPDATING_SHOWN_OVER,
  vaultFolderLabel,
  vaultFolderTaken,
  vaultLinksLeftCard,
  vaultRenameFailed,
  vaultRenameTaken,
  vaultUpdateLinksCopy,
  vaultUpdatingLinks,
} from '../../lib/vaultCopy.js';
import { checkFolderName, checkRenameTarget, type VaultMovePreview } from '../../state/vaultOps.js';

type Step = 'name' | 'folders' | 'links';

export interface VaultRenameSheetProps {
  open: boolean;
  /** What moves: a note's path, or a folder's. */
  kind: 'note' | 'folder';
  from: string;
  /** Every folder there is to move into (derived and real). */
  folders: readonly string[];
  /** Every note path the vault lists, for a taken name. */
  known: readonly string[];
  /** Plan the move: read the referring notes and count the links. Undefined
   *  when the plan could not be made (the storage failed). */
  prepare: (to: string) => Promise<VaultMovePreview | undefined>;
  /** Run it. `updateLinks` is false for Rename only. The parent toasts,
   *  shows any standing card, and closes the sheet. */
  apply: (
    preview: VaultMovePreview,
    updateLinks: boolean,
    onProgress: (i: number, m: number) => void,
  ) => Promise<void>;
  onClose: () => void;
  /** Open straight on the folder list (a folder's "Move folder"). */
  startAt?: 'name' | 'folders';
}

function stemOf(kind: 'note' | 'folder', path: string): string {
  return kind === 'note' ? noteTitle(path) : (path.split('/').pop() ?? path);
}

export function VaultRenameSheet(props: VaultRenameSheetProps) {
  const { open, kind, from, folders, known, prepare, apply, onClose, startAt } = props;
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState(() => stemOf(kind, from));
  const [folder, setFolder] = useState(() => noteFolder(from));
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<VaultMovePreview>();
  const [progress, setProgress] = useState<{ i: number; m: number }>();
  const [making, setMaking] = useState(false);
  const [newFolder, setNewFolder] = useState('');

  // A fresh start each time the sheet opens on something.
  useEffect(() => {
    if (!open) return;
    setStep(startAt ?? 'name');
    setName(stemOf(kind, from));
    setFolder(noteFolder(from));
    setProblem(undefined);
    setBusy(false);
    setPreview(undefined);
    setProgress(undefined);
    setMaking(false);
    setNewFolder('');
  }, [open, kind, from, startAt]);

  const old = stemOf(kind, from);

  /** The path it would move to, or a line that says why not. */
  const target = (): { to: string } | { problem: string } => {
    if (kind === 'note') {
      const r = checkRenameTarget(from, name, folder, known);
      if (r.ok) return { to: r.to };
      if (r.reason === 'bad-chars') return { problem: VAULT_RENAME_BAD_CHARS };
      if (r.reason === 'taken') return { problem: vaultRenameTaken(r.name, r.folder) };
      if (r.reason === 'bad-name') return { problem: r.error };
      return { problem: '' };
    }
    const typed = name.trim();
    const to = folder ? `${folder}/${typed}` : typed;
    if (!checkFolderName(to) || typed.includes('/')) return { problem: VAULT_FOLDER_BAD_NAME };
    if (to === from) return { problem: '' };
    // A folder never moves into itself.
    if (foldPath(to).startsWith(`${foldPath(from)}/`)) return { problem: VAULT_FOLDER_BAD_NAME };
    // The one fold every storage judges a taken name by (case and NFC,
    // accents kept distinct).
    const folded = foldPath(to);
    const taken = folders.some((f) => foldPath(f) === folded) && folded !== foldPath(from);
    if (taken) return { problem: vaultFolderTaken(typed) };
    return { to };
  };

  const submit = async () => {
    const t = target();
    if ('problem' in t) {
      // An unchanged name and place is simply nothing to do.
      if (!t.problem) onClose();
      else setProblem(t.problem);
      return;
    }
    setProblem(undefined);
    setBusy(true);
    const planned = await prepare(t.to);
    if (!planned) {
      setBusy(false);
      setProblem(vaultRenameFailed(old));
      return;
    }
    if (planned.links > 0) {
      setPreview(planned);
      setBusy(false);
      setStep('links');
      return;
    }
    await apply(planned, false, () => {});
    setBusy(false);
  };

  const run = async (updateLinks: boolean) => {
    if (!preview) return;
    setBusy(true);
    await apply(preview, updateLinks, (i, m) => setProgress({ i, m }));
    setBusy(false);
    setProgress(undefined);
  };

  const folderRows = ['', ...folders.filter((f) => f !== from && !f.startsWith(`${from}/`))];
  const links = preview
    ? vaultUpdateLinksCopy({
        kind,
        old: stemOf(kind, preview.from),
        next: stemOf(kind, preview.to),
        links: preview.links,
        notes: preview.linkNotes,
        moving: preview.notes,
      })
    : undefined;
  const heading =
    step === 'links' && links
      ? links.title
      : kind === 'note'
        ? VAULT_RENAME_TITLE
        : VAULT_FOLDER_RENAME;

  return (
    <Sheet open={open} onClose={onClose}>
      {open ? (
        <>
          <SheetHead title={heading} onClose={onClose} />
          {step === 'name' ? (
            <div className="vault-rename-step" key="name">
              <div className="field">
                <label htmlFor="vault-rename-name">
                  {kind === 'note' ? VAULT_RENAME_NAME : VAULT_FOLDER_NAME}
                </label>
                <input
                  id="vault-rename-name"
                  value={name}
                  placeholder={old}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setName(e.target.value);
                    setProblem(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) void submit();
                  }}
                />
              </div>
              <button
                type="button"
                className="conv-item vault-row vault-rename-folder press-fb press-fb--row"
                disabled={busy}
                onClick={() => setStep('folders')}
              >
                <span className="vault-rename-label">{VAULT_RENAME_FOLDER}</span>
                <span className="vault-rename-value">
                  {folder ? vaultFolderLabel(folder) : VAULT_RENAME_ROOT}
                </span>
                <span className="vault-row-chevron" aria-hidden="true" />
              </button>
              {problem ? (
                <p className="hint vault-rename-problem" role="alert">
                  {problem}
                </p>
              ) : null}
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn primary press-fb"
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {name.trim() === old && folder !== noteFolder(from)
                    ? VAULT_RENAME_MOVE
                    : VAULT_RENAME_SAVE}
                </button>
              </div>
            </div>
          ) : null}

          {step === 'folders' ? (
            <div className="vault-rename-step vault-tree" key="folders">
              {folderRows.map((f) => (
                <button
                  key={f || '/'}
                  type="button"
                  className="conv-item vault-row press-fb press-fb--row"
                  aria-current={f === folder ? 'true' : undefined}
                  onClick={() => {
                    setFolder(f);
                    setStep('name');
                  }}
                >
                  {f ? vaultFolderLabel(f) : VAULT_RENAME_ROOT}
                  {f === noteFolder(from) ? (
                    <span className="pill muted vault-rename-here">{VAULT_RENAME_HERE}</span>
                  ) : null}
                </button>
              ))}
              {making ? (
                <div className="vault-rename-new">
                  <div className="field">
                    <label htmlFor="vault-rename-new">{VAULT_FOLDER_NAME}</label>
                    <input
                      id="vault-rename-new"
                      value={newFolder}
                      autoComplete="off"
                      onChange={(e) => {
                        setNewFolder(e.target.value);
                        setProblem(undefined);
                      }}
                    />
                  </div>
                  {problem ? (
                    <p className="hint vault-rename-problem" role="alert">
                      {problem}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="btn ghost press-fb"
                    onClick={() => {
                      // Parents of the new path are made by the move itself
                      // (K3), so a new folder is only a place to aim at.
                      const made = [folder, newFolder.trim()].filter(Boolean).join('/');
                      if (!checkFolderName(made)) {
                        setProblem(VAULT_FOLDER_BAD_NAME);
                        return;
                      }
                      setFolder(made);
                      setMaking(false);
                      setStep('name');
                    }}
                  >
                    {VAULT_FOLDER_CREATE}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="conv-item vault-row press-fb press-fb--row"
                  onClick={() => setMaking(true)}
                >
                  {VAULT_FOLDER_NEW}
                </button>
              )}
            </div>
          ) : null}

          {step === 'links' && links ? (
            <div className="vault-rename-step" key="links">
              <p className="vault-rename-sub">{links.sub}</p>
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn primary press-fb"
                  disabled={busy}
                  onClick={() => void run(true)}
                >
                  {busy && progress && progress.m > VAULT_UPDATING_SHOWN_OVER
                    ? vaultUpdatingLinks(progress.i, progress.m)
                    : links.primary}
                </button>
                <button
                  type="button"
                  className="btn quiet press-fb"
                  disabled={busy}
                  onClick={() => void run(false)}
                >
                  {links.quiet}
                </button>
                <p className="hint vault-rename-quiet-sub">{links.quietSub}</p>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

/** The standing card on the renamed note while some links still point at
 *  the old name (CX X7): one row per note, and Update the rest. */
export function VaultLinksLeftCard({
  old,
  notes,
  busy,
  onOpen,
  onUpdateRest,
}: {
  /** The old title. */
  old: string;
  /** The notes whose links were not updated. */
  notes: readonly string[];
  busy?: boolean;
  onOpen: (path: string) => void;
  onUpdateRest: () => void;
}) {
  if (!notes.length) return null;
  const copy = vaultLinksLeftCard(old);
  return (
    <div className="card vault-links-left" role="status">
      <h3 className="vault-links-left-title">{copy.title}</h3>
      <div className="vault-tree">
        {notes.map((p) => (
          <button
            key={p}
            type="button"
            className="conv-item vault-row press-fb press-fb--row"
            onClick={() => onOpen(p)}
          >
            {noteTitle(p)}
          </button>
        ))}
      </div>
      <div className="vault-move-actions">
        <button type="button" className="btn ghost press-fb" disabled={busy} onClick={onUpdateRest}>
          {copy.button}
        </button>
      </div>
    </div>
  );
}
