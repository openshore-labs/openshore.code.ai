// Install any Ollama model by name, so a person is never limited to the models
// we listed: whatever is on the Ollama library (the newest releases the day
// they land) can be pulled on this computer and placed. Desktop only; the pull
// runs on this machine's engine. A wrong name, or any pull that fails, comes
// back as one plain line with the way on (the engine's pullFailedLine), never
// a fabricated success or Ollama's raw error. Lives in Stack and in the
// Marketplace.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { hapticSuccess } from '../lib/haptics.js';

export function InstallByName({ onInstalled }: { onInstalled?: (ref: string) => void }) {
  const showToast = useApp((s) => s.showToast);
  const [refInput, setRefInput] = useState('');
  const [refBusy, setRefBusy] = useState(false);
  const [refLine, setRefLine] = useState<string | undefined>();

  const installByRef = async () => {
    const ref = refInput.trim();
    const b = bridge();
    if (!ref || !b || refBusy) return;
    setRefBusy(true);
    setRefLine(`Pulling ${ref}...`);
    const off = b.onInstallProgress((p) => {
      if (p.modelId !== ref) return;
      setRefLine(p.percent != null ? `${p.line} ${Math.round(p.percent)}%` : p.line);
    });
    try {
      const r = await b.installOllamaRef(ref);
      showToast(r.detail);
      if (r.ok) {
        hapticSuccess();
        setRefInput('');
        await useApp.getState().refreshDesktopStatus();
        onInstalled?.(ref);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not pull that model.');
    } finally {
      off();
      setRefBusy(false);
      setRefLine(undefined);
    }
  };

  if (!bridge()) return null;
  return (
    <div className="card install-by-name">
      <h3>Have a model in mind?</h3>
      {/* A local door: the examples name only models that run here, and the
          last sentence warns off a cloud tag in the words of the engine's own
          judge (isOllamaCloudTag: a tag that is cloud or ends in -cloud), never
          offering one to copy (UX and copy review, 2026-10-08, B). */}
      <p className="hint" style={{ marginTop: 4 }}>
        Type any name from the Ollama library and install it on this computer, even brand new
        models. For example qwen3-coder:30b, deepseek-r1:14b, gemma3:12b. A name whose tag (after
        the colon) is cloud or ends in -cloud runs on Ollama&apos;s cloud, not on this computer.
      </p>
      <div className="field" style={{ marginTop: 8 }}>
        <input
          aria-label="Model name"
          placeholder="model name, e.g. qwen3:8b"
          value={refInput}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setRefInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void installByRef()}
        />
      </div>
      <button
        className="btn ghost block press-fb"
        disabled={refBusy || !refInput.trim()}
        onClick={() => void installByRef()}
      >
        {refBusy ? (refLine ?? 'Installing...') : 'Install by name'}
      </button>
    </div>
  );
}
