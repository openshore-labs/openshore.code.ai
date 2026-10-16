// This device on the iPhone and the iPad (folder and sync plan, M2): the
// personal vault as real files in Documents/Vault, through the phone
// folder (phoneFolder.ts), and the one-time move of what the sealed store held
// there before.
//
// The id stays 'local', so the registry, the copy keys and the store need no
// new provider id: on iOS, providerFor('local') answers the folder; on the web,
// the desktop and in tests it answers the sealed store exactly as before.
//
// The move (run once, at launch, after the sealed store unlocks):
//   1. Each sealed note is written into the folder with `ifAbsent`. A name the
//      folder already has with the same text counts as moved; with other text,
//      the sealed note lands beside it as a conflict copy, never over it.
//   2. Each one is read back from the folder, and only when the bytes match is
//      the sealed copy removed (guarded by its version, so a save that landed
//      meanwhile keeps it).
//   3. Trash entries go into the folder's Trash, each recorded with its sealed
//      id, and leave the sealed Trash only once the folder records them.
//   4. The vault settings move the same way; when the folder already has its
//      own `.oscode/vault.json` with other text, the folder's file stays the
//      settings and the sealed one is left where it is, unread (nothing lost).
//   5. Done is recorded only when the sealed vault and its Trash are empty, so
//      a move cut off anywhere runs again at the next launch and picks up
//      where it stopped: a note already moved reads as the same text, and a
//      conflict copy is named from the time the move first started, so a
//      second run finds the copy it made rather than making another.
// Every call to the provider waits for the move, so nothing lists a vault
// half moved.
import { versionOf, type StorageProvider } from './providers.js';
import { vaultConflictCopyPath } from 'os-code/protocol';
import { storeGetJson, storeSetJson } from '../platform.js';
import { forgetSealedConfig, localProvider, readSealedTrash } from './local.js';
import {
  capacitorPhoneFs,
  createPhoneFolderTransport,
  createPhoneVaultProvider,
  type PhoneFolderTransport,
} from './phoneFolder.js';

/** The personal vault's resource id (the store's VAULT_RESOURCE_ID). */
export const PHONE_VAULT_RESOURCE_ID = 'vault.personal';

/** Where the move records that it started and that it finished (machine
 *  state, in the sealed store, never in the folder). */
export const PHONE_VAULT_MOVE_KEY = 'oscode.phoneFolder.vaultMove';

interface MoveState {
  startedAt: string;
  doneAt?: string;
}

export interface PhoneVaultMoveResult {
  /** Notes now in the folder whose sealed copy was removed. */
  moved: number;
  /** Conflict copies made beside a name the folder already had. */
  beside: string[];
  /** Trash entries moved. */
  trash: number;
  /** The settings: moved, kept (the folder's own file stays), or none. */
  settings: 'moved' | 'kept' | 'none';
  /** True once nothing is left in the sealed vault (recorded, runs once). */
  done: boolean;
}

/** The most conflict copy names tried for one note. */
const MAX_BESIDE = 20;

/**
 * Move the sealed personal vault into the folder. Safe to run again at any
 * point; resolves done without touching anything once it has finished.
 * Throws only when the sealed store cannot be read at all, so the next launch
 * tries again.
 */
export async function moveSealedVaultToFolder(
  folder: PhoneFolderTransport,
  opts: { sealed?: StorageProvider; resourceId?: string; now?: () => Date } = {},
): Promise<PhoneVaultMoveResult> {
  const sealed = opts.sealed ?? localProvider;
  const R = opts.resourceId ?? PHONE_VAULT_RESOURCE_ID;
  const result: PhoneVaultMoveResult = {
    moved: 0,
    beside: [],
    trash: 0,
    settings: 'none',
    done: false,
  };
  let state = await storeGetJson<MoveState>(PHONE_VAULT_MOVE_KEY).catch(() => undefined);
  if (state?.doneAt) return { ...result, done: true };
  if (!state?.startedAt) {
    state = { startedAt: (opts.now?.() ?? new Date()).toISOString() };
    await storeSetJson(PHONE_VAULT_MOVE_KEY, state);
  }
  const when = new Date(state.startedAt);

  // 1 and 2: the notes.
  for (const meta of await sealed.list(R)) {
    try {
      const body = await sealed.read(R, meta.path);
      if (!body) continue;
      const placed = await placeNote(folder, meta.path, body.text, when);
      if (!placed) continue;
      const back = await folder.read(placed);
      if (back?.text !== body.text) continue;
      const gone = await sealed.remove(R, meta.path, { ifMatch: versionOf(body) });
      if (!gone.ok) continue;
      result.moved += 1;
      if (placed !== meta.path) result.beside.push(placed);
    } catch {
      // This note stays sealed; the next launch tries it again.
    }
  }

  // 3: Trash.
  if (sealed.listTrash && sealed.emptyTrash) {
    for (const entry of await sealed.listTrash(R).catch(() => [])) {
      try {
        const doc = await readSealedTrash(R, entry.id);
        if (!doc) continue;
        if (!(await folder.adoptTrash(doc, entry.id))) continue;
        await sealed.emptyTrash(R, [entry.id]);
        result.trash += 1;
      } catch {
        // Stays in the sealed Trash until the next launch.
      }
    }
  }

  // 4: the settings.
  try {
    const conf = sealed.readConfig ? await sealed.readConfig(R, 'oscode/vault') : undefined;
    if (conf?.ok) {
      const w = await folder.writeConfig('oscode/vault', conf.text, { ifAbsent: true });
      if (w.ok || (w.conflict === 'exists' && w.theirs?.text === conf.text)) {
        await forgetSealedConfig(R);
        result.settings = 'moved';
      } else {
        result.settings = 'kept';
      }
    }
  } catch {
    // Read again next launch.
  }

  // 5: done only when nothing is left behind.
  const left = (await sealed.list(R)).length;
  const trashLeft = sealed.listTrash ? (await sealed.listTrash(R).catch(() => [])).length : 0;
  if (left === 0 && trashLeft === 0) {
    await storeSetJson(PHONE_VAULT_MOVE_KEY, { ...state, doneAt: new Date().toISOString() });
    result.done = true;
  }
  return result;
}

/** Where one sealed note lands in the folder: its own name while free (or
 *  already holding the same text), else the first free conflict copy beside
 *  it, named from when the move started. Undefined when none would take it. */
async function placeNote(
  folder: PhoneFolderTransport,
  path: string,
  text: string,
  when: Date,
): Promise<string | undefined> {
  const own = await folder.write(path, text, { ifAbsent: true });
  if (own.ok || (own.conflict === 'exists' && own.theirs?.text === text)) return path;
  for (let n = 1; n <= MAX_BESIDE; n++) {
    const copy = vaultConflictCopyPath(path, when, n);
    const w = await folder.write(copy, text, { ifAbsent: true });
    if (w.ok || (w.conflict === 'exists' && w.theirs?.text === text)) return copy;
  }
  return undefined;
}

// ---- The one phone vault -----------------------------------------------------

let transport: PhoneFolderTransport | undefined;
let provider: StorageProvider | undefined;
let moving: Promise<unknown> | undefined;
// Whether the folder holds the vault this launch: only once launch has made
// the layout with the old export out of the way (lib/phoneFolder.ts). Until
// then, and for good on a launch that could not move it, This device stays
// the sealed store.
let folderInUse = false;

/** The phone folder's transport, made once. */
export function phoneVaultTransport(): PhoneFolderTransport {
  transport ??= createPhoneFolderTransport(capacitorPhoneFs());
  return transport;
}

/** Settles once the move started at launch has finished (or failed), with
 *  whether the folder is in use. Before launch starts it, the sealed store. */
export function phoneVaultGate(): Promise<boolean> {
  return moving
    ? moving.then(
        () => folderInUse,
        () => folderInUse,
      )
    : Promise.resolve(false);
}

/** This device on the phone, made once. */
export function phoneVaultProvider(): StorageProvider {
  provider ??= createPhoneVaultProvider(phoneVaultTransport(), phoneVaultGate);
  return provider;
}

/** Start the one-time move (once per launch), after `before` (the folder's
 *  layout) settles true; every provider call waits for it. When the layout
 *  could not be made safely, nothing moves and This device stays the sealed
 *  store this launch. Never rejects. */
export function startPhoneVaultMove(
  before: Promise<boolean> = Promise.resolve(true),
): Promise<PhoneVaultMoveResult | undefined> {
  moving ??= before
    .catch(() => false)
    .then((ok) => {
      folderInUse = ok;
      return ok ? moveSealedVaultToFolder(phoneVaultTransport()) : undefined;
    })
    .catch(() => undefined);
  return moving as Promise<PhoneVaultMoveResult | undefined>;
}
