// The Stack's media jobs on the desktop (the model library, 2026-10-12):
// photo editing, video, transcription, voices, music and sound. Each job
// placed is one row, its model and where it runs, with Remove; Get in the
// Local Library is what places one. Media servers says where ComfyUI and the
// speech server are, and where ComfyUI keeps its models, which Get needs.
// The engine keeps all of it in this computer's config (machine config).
// Remove asks first and can delete the files Get wrote for the model; Made
// here counts and clears the pictures, clips and sounds the jobs saved
// (security review, 2026-10-12; os-code/src/media/upkeep.ts).
import { useEffect, useState } from 'react';
import {
  LIBRARY_CATEGORIES,
  MEDIA_JOB_INFO,
  RUNTIME_INFO,
  type Catalog,
  type MediaJob,
  type ModelRuntime,
} from 'os-code/protocol';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { bridge, type DesktopStatus, type MediaServers } from '../lib/electronBridge.js';
import { formatBytes } from '../lib/modelStorage.js';
import { useApp } from '../state/store.js';

type Placed = NonNullable<DesktopStatus['stack']['media']>[number];

/** The Stack's name for a media slot ("Photo editing"), from the library. */
function slotName(job: MediaJob): string {
  const slot = MEDIA_JOB_INFO[job].slot;
  return LIBRARY_CATEGORIES.find((c) => c.slot === slot)?.name ?? slot;
}

export function StackMedia({
  status,
  canEdit,
  index,
  onChanged,
  onOpenLibrary,
}: {
  status: DesktopStatus;
  canEdit: boolean;
  index: number;
  /** Read the engine's status again after a change. */
  onChanged: () => void;
  onOpenLibrary: () => void;
}) {
  const placed: Placed[] = (status.stack.media ?? []).filter((m) => m.job in MEDIA_JOB_INFO);
  const { showToast } = useApp();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [serversOpen, setServersOpen] = useState(false);
  const [removing, setRemoving] = useState<Placed | undefined>();
  const [removable, setRemovable] = useState<{ files: number; bytes: number } | undefined>();
  const [made, setMade] = useState<{ files: number; bytes: number } | undefined>();
  const [clearOpen, setClearOpen] = useState(false);

  // A bridge from before these calls (or a test's) has none: no row then.
  const readMade = () => {
    const b = bridge();
    if (typeof b?.mediaOutputs !== 'function') return;
    void b
      .mediaOutputs()
      .then(setMade)
      .catch(() => {});
  };
  useEffect(readMade, []);

  useEffect(() => {
    if (!placed.length) return;
    let cancelled = false;
    void bridge()
      ?.catalog()
      .then((c) => {
        if (!cancelled) setCatalog(c.catalog);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Read once a job is placed; names do not change between reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed.length]);

  const nameOf = (m: Placed) =>
    (m.catalogId && catalog?.models.find((x) => x.id === m.catalogId)?.name) ??
    m.catalogId ??
    'Placed';

  const askRemove = (m: Placed) => {
    setRemovable(undefined);
    setRemoving(m);
    const b = bridge();
    if (typeof b?.mediaRemoval !== 'function') {
      setRemovable({ files: 0, bytes: 0 });
      return;
    }
    void b
      .mediaRemoval(m.job)
      .then(setRemovable)
      .catch(() => setRemovable({ files: 0, bytes: 0 }));
  };

  const remove = async (deleteFiles: boolean) => {
    const m = removing;
    setRemoving(undefined);
    if (!m) return;
    const result = await bridge()?.removeMedia(m.job, deleteFiles);
    if (result) showToast(result.detail);
    onChanged();
  };

  const clearMade = async () => {
    setClearOpen(false);
    const gone = await bridge()?.clearMediaOutputs();
    if (gone) showToast(gone.files ? `Cleared ${formatBytes(gone.bytes)}.` : 'Nothing to clear.');
    readMade();
  };

  return (
    <>
      <SettingsGroup
        title="Media"
        index={index}
        intro="Photo editing, video, transcription, voices, music and sound. Each job is one model, run by a program at the address you set in Media servers."
      >
        {placed.length ? (
          placed.map((m) => {
            const job = m.job as MediaJob;
            const runtime = RUNTIME_INFO[m.runtime as ModelRuntime]?.name ?? m.runtime;
            return (
              <SettingsRow
                key={m.job}
                label={MEDIA_JOB_INFO[job].plain}
                sub={`${slotName(job)} · runs in ${runtime}`}
                value={nameOf(m)}
                trailing={
                  canEdit ? (
                    <button
                      type="button"
                      className="btn ghost sm press-fb"
                      onClick={() => askRemove(m)}
                    >
                      Remove
                    </button>
                  ) : undefined
                }
              />
            );
          })
        ) : (
          <SettingsRow
            label="Nothing placed yet"
            sub="Get a photo, video, voice or music model in the Local Library, and it lands here."
            onClick={onOpenLibrary}
          />
        )}
        {made?.files ? (
          <SettingsRow
            label="Made here"
            sub={`${made.files} ${made.files === 1 ? 'file' : 'files'}, ${formatBytes(made.bytes)}: the pictures, clips and sounds your media jobs saved on this computer.`}
            trailing={
              canEdit ? (
                <button
                  type="button"
                  className="btn ghost sm press-fb"
                  onClick={() => setClearOpen(true)}
                >
                  Clear
                </button>
              ) : undefined
            }
          />
        ) : null}
        {canEdit ? (
          <SettingsRow
            label="Media servers"
            sub="Where ComfyUI and the speech server are, and where ComfyUI keeps its models."
            onClick={() => setServersOpen(true)}
          />
        ) : null}
      </SettingsGroup>
      <MediaServersSheet open={serversOpen} onClose={() => setServersOpen(false)} />
      <Sheet open={removing !== undefined} onClose={() => setRemoving(undefined)} variant="confirm">
        {removing ? (
          <>
            <h3>Take {nameOf(removing)} out of your Stack?</h3>
            <p>
              {removable?.files
                ? `Get downloaded ${formatBytes(removable.bytes)} of its files into ComfyUI's models folder. Keep them for later, or delete them now. Files another model in your Stack uses stay.`
                : 'Its program keeps the model where it is. You can place it again from the Local Library.'}
            </p>
            <div className="confirm-row">
              <button
                type="button"
                className="btn ghost press-fb"
                onClick={() => setRemoving(undefined)}
              >
                Keep it
              </button>
              <button
                type="button"
                className={`btn ${removable?.files ? 'ghost' : 'danger'} press-fb`}
                onClick={() => void remove(false)}
              >
                Take out
              </button>
            </div>
            {removable?.files ? (
              <button
                type="button"
                className="btn danger block press-fb"
                onClick={() => void remove(true)}
              >
                Take out and delete {formatBytes(removable.bytes)}
              </button>
            ) : null}
          </>
        ) : null}
      </Sheet>
      <Sheet open={clearOpen} onClose={() => setClearOpen(false)} variant="confirm">
        <h3>Clear what your media jobs made?</h3>
        <p>
          {made?.files ?? 0} {made?.files === 1 ? 'file' : 'files'} go from this computer. This
          cannot be undone.
        </p>
        <div className="confirm-row">
          <button type="button" className="btn ghost press-fb" onClick={() => setClearOpen(false)}>
            Keep them
          </button>
          <button type="button" className="btn danger press-fb" onClick={() => void clearMade()}>
            Clear
          </button>
        </div>
      </Sheet>
    </>
  );
}

function MediaServersSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [servers, setServers] = useState<MediaServers | undefined>();
  const [comfyUrl, setComfyUrl] = useState('');
  const [modelsDir, setModelsDir] = useState('');
  const [speechUrl, setSpeechUrl] = useState('');
  const [note, setNote] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNote(undefined);
    void bridge()
      ?.mediaServers()
      .then((s) => {
        setServers(s);
        setComfyUrl(s.comfyui.baseUrl);
        setModelsDir(s.comfyui.modelsDir ?? '');
        setSpeechUrl(s.speech.baseUrl);
      })
      .catch(() => setNote('Your computer did not answer.'));
  }, [open]);

  const save = async () => {
    const b = bridge();
    if (!b) return;
    setSaving(true);
    try {
      const comfy = await b.setMediaServer(
        'comfyui',
        comfyUrl.trim(),
        modelsDir.trim() || undefined,
      );
      const speech = await b.setMediaServer('speech', speechUrl.trim());
      setNote(comfy.ok && speech.ok ? 'Saved.' : comfy.ok ? speech.detail : comfy.detail);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      {open ? (
        <>
          <SheetHead title="Media servers" onClose={onClose} />
          <p className="sheet-sub">
            ComfyUI runs pictures, photo editing, video, music and sound; a speech server (LocalAI)
            runs transcription and voices. Both are free programs you run on this computer or a
            server you dock.
          </p>
          <div className="field">
            <label htmlFor="media-comfy-url">ComfyUI address</label>
            <input
              id="media-comfy-url"
              value={comfyUrl}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="http://127.0.0.1:8188"
              onChange={(e) => setComfyUrl(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="media-comfy-models">ComfyUI&apos;s models folder</label>
            <input
              id="media-comfy-models"
              value={modelsDir}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="/Users/you/ComfyUI/models"
              onChange={(e) => setModelsDir(e.target.value)}
            />
            <p className="hint">
              {servers?.comfyui.modelsDir && !servers.comfyui.modelsDirSet
                ? 'Found on this computer. Get puts each model file here.'
                : 'Get puts each model file here, straight from its source.'}
            </p>
          </div>
          <div className="field">
            <label htmlFor="media-speech-url">Speech server address</label>
            <input
              id="media-speech-url"
              value={speechUrl}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="http://127.0.0.1:8080"
              onChange={(e) => setSpeechUrl(e.target.value)}
            />
          </div>
          {note ? (
            <p className="hint" role="status">
              {note}
            </p>
          ) : null}
          <div className="sheet-actions">
            <button
              type="button"
              className="btn primary press-fb"
              disabled={saving || !comfyUrl.trim() || !speechUrl.trim()}
              onClick={() => void save()}
            >
              {saving ? 'Saving' : 'Save'}
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
