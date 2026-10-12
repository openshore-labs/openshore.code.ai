// The Stack's media jobs on the desktop (the model library, 2026-10-12):
// photo editing, video, transcription, voices, music and sound. Each job
// placed is one row, its model and where it runs, with Remove; Get in the
// Marketplace is what places one. Media servers says where ComfyUI and the
// speech server are, and where ComfyUI keeps its models, which Get needs.
// The engine keeps all of it in this computer's config (machine config).
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
  onOpenMarketplace,
}: {
  status: DesktopStatus;
  canEdit: boolean;
  index: number;
  /** Read the engine's status again after a change. */
  onChanged: () => void;
  onOpenMarketplace: () => void;
}) {
  const placed: Placed[] = (status.stack.media ?? []).filter((m) => m.job in MEDIA_JOB_INFO);
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [serversOpen, setServersOpen] = useState(false);

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

  const remove = async (job: string) => {
    await bridge()?.removeMedia(job);
    onChanged();
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
                      onClick={() => void remove(m.job)}
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
            sub="Get a photo, video, voice or music model in the Marketplace, and it lands here."
            onClick={onOpenMarketplace}
          />
        )}
        {canEdit ? (
          <SettingsRow
            label="Media servers"
            sub="Where ComfyUI and the speech server are, and where ComfyUI keeps its models."
            onClick={() => setServersOpen(true)}
          />
        ) : null}
      </SettingsGroup>
      <MediaServersSheet open={serversOpen} onClose={() => setServersOpen(false)} />
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
