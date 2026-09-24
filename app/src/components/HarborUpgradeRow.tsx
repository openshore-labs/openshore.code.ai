// The Harbor upgrade row: shown on the phone only when the Harbor on this
// device is older weights than the current slot (harborIsStale). It never
// deletes on its own. Two taps, each saying what it does: "Get new" removes the
// older file and downloads the current Harbor in its place (the native store
// keys the file by the slot id, so the old one has to go first), and "Remove
// old" only frees the space, leaving the Harbor row's Install for later. While
// a Harbor download runs, the Harbor row above carries the progress and this
// row steps aside.
import { useApp } from '../state/store.js';
import { HARBOR_UPGRADE_LINE, HARBOR_UPGRADE_TITLE, harborIsStale } from '../lib/harbor.js';
import { SettingsRow } from './SettingsRow.js';

export function HarborUpgradeRow() {
  const { settings, harborDownload, upgradeHarbor, removeHarbor, showToast } = useApp();
  if (!harborIsStale(settings) || harborDownload) return null;

  const getNew = async () => {
    const ok = await upgradeHarbor();
    if (ok) showToast('The new Harbor is installed and ready on this device.');
  };
  const removeOld = async () => {
    await removeHarbor();
    showToast('The old Harbor is removed. Install the new one any time.');
  };

  return (
    <SettingsRow
      label={HARBOR_UPGRADE_TITLE}
      sub={HARBOR_UPGRADE_LINE}
      subWrap
      trailing={
        <span className="settings-row-actions">
          <button
            type="button"
            className="harbor-action is-install press-fb"
            onClick={() => void getNew()}
          >
            Get new
          </button>
          <button
            type="button"
            className="harbor-action is-remove press-fb"
            onClick={() => void removeOld()}
          >
            Remove old
          </button>
        </span>
      }
    />
  );
}
