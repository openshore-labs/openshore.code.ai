# Vault on iPhone: opening an existing Obsidian vault in place (design, 2026-09-27)

The detailed design behind plan items 2.10a and 2.10b in `docs/design/vault-v1-plan.md`
(founder ruling 2026-09-27: the iPhone half of D14 moves into v1). Part one is
the design as drafted against the code; part two is the adversarial check that
tested it against iOS behavior and Apple's developer forums. Where the two
disagree, part two wins, and the plan item already carries its corrections.

## Part one: the design

### 2.10 The iPhone opens an existing Obsidian vault in place

Repo root: `/home/user/openshore.code.ai`. This design replaces the draft at `docs/design/vault-v1-plan.md:565-577`. It also fits D2 (`:1031-1035`), D14 (`:1064-1067`) and the out-of-v1 line (`:1009-1010`).

**Summary**

- **Provider:** add a new provider id, `folder`. Its native side is a second plugin class inside the existing `oscode-icloud` Swift package. It shares one coordinated file engine with the container work in 2.1 and 2.9. On the JS side it shares one client with the desktop `files` provider.
- **Milestone:** M2, landing after 1.1 and together with 2.1. Size **XL**, split into 2.10a (L) and 2.10b (M). It stays behind a flag until 3.2's index ships.

#### 0. Current code that 2.10 must not inherit

1. **`.skipsHiddenFiles` hides evicted notes.** Plan 0.6 (`:294`) says the Swift `list()` should skip hidden paths (`OscodeIcloudPlugin.swift:78`). But iCloud placeholders are hidden dotfiles (`.X.md.icloud`, mapped at `:90-101`). With `.skipsHiddenFiles` set, evicted notes disappear from the list and a create could write over them, which is the UI-2 bug again. Instead, skip dot directories with `enumerator.skipDescendants()` and keep mapping the placeholders.
2. **Dates are only precise to the second.** `ISO8601DateFormatter()` with default options drops fractional seconds (`:223-225`). Compare-and-swap would miss two same-size edits made within the same second. It also builds a new formatter per file.
3. **Size means two things.** `providers.ts:38` documents size as UTF-16 code units, but the Swift plugin (`:105`) and Electron (`main.ts:944`) return bytes. Compare-and-swap has to use bytes, and the doc needs fixing.
4. **Work happens outside coordination, and remove never fails.** `write` creates the directory (`:183`) and stats the result (`:195`) outside the coordinated block. `remove` swallows errors and always resolves (`:216-218`).
5. **One serial queue with a 3 s sleep per evicted read** (`:28`, `:139-143`). A single evicted note stalls every other call, so a first index over an Obsidian iCloud vault would crawl.
6. **`stat()` enumerates the whole vault** (`icloud.ts:30-32`, `deviceFolder.ts:42-44`). Plan 0.2 calls `stat` on every create.
7. **`vaultMoveTo` overwrites the target when the source is newer.** It compares ISO strings as an order (`store.ts:6238-6250`). Pointed at an existing Obsidian vault, that silently overwrites the person's Obsidian note.
8. **The Capacitor CLI registers the first `@objc(...)` it finds in each `.swift` file** (`node_modules/.pnpm/@capacitor+cli@8.5.0/.../dist/util/iosplugin.js:36-38`). Any helper file that uses `@objc(Name)` becomes a bogus entry in `packageClassList`.
9. **The Swift path jail is not symlink-safe.** It uses `standardizedFileURL` (`OscodeIcloudPlugin.swift:52-53`). The desktop jail is symlink-safe (`main.ts:918`).

#### 1. Mechanism

**Pick**

- `UIDocumentPickerViewController(forOpeningContentTypes: [.folder])`, with `allowsMultipleSelection = false`, presented on the main thread from `bridge?.viewController`. The call is held until the pick or the cancel.
- No new entitlement or usage string is needed. `Info.plist:116-119` already declares in-place document support, and `App.entitlements:24-35` is unchanged.
- The picker cannot open directly at Obsidian's folders: `url(forUbiquityContainerIdentifier: "iCloud.md.obsidian")` is nil without Obsidian's entitlement. So one line of copy tells the person where to tap.
- In `didPickDocumentsAt`:
  1. Call `url.startAccessingSecurityScopedResource()`.
  2. Create the bookmark with `url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)`, the pattern in Apple's directory-access sample. `.withSecurityScope` is macOS only.
  3. Inspect the folder in one pass: note count, evicted count, whether `.obsidian/` exists, `where`, and any `childVaults`.
- **Obsidian's parent folder picked:** if the picked folder has no `.obsidian/` but its subfolders do, it is Obsidian's own folder. Store the parent bookmark plus a `subpath` for the vault the person chooses, rather than a child bookmark derived from the parent's scope. This also serves v1.1 multiple vaults.

**Bookmark storage and lifetime**

- The native side owns bookmarks at `Application Support/OscodeFolder/<resourceId>.plist`, holding `{bookmark, subpath?, folderId (UUID made at pick time), lastPath, where}`. JS never sees the bookmark bytes. `GitosResource` only gains `folder?: {folderId, name, where}` for copy.
- Resolve with `URL(resolvingBookmarkData:options:[.withoutUI]…, bookmarkDataIsStale:&isStale)`, which yields one of these states:

| State       | How it is detected                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `ok`        | Resolves, access starts, folder exists.                                                                      |
| `stale`     | `isStale` is true. Start access on the resolved URL, re-create and save the bookmark, then continue as `ok`. |
| `moved`     | The resolved path differs from `lastPath`. Update it and recompute `where`.                                  |
| `inTrash`   | The resolved path contains `/.Trash/`.                                                                       |
| `gone`      | Resolution throws, or the path no longer exists.                                                             |
| `denied`    | `startAccessing…` returns false, or reads fail with `NSFileReadNoPermissionError`.                           |
| `signedOut` | `where` is iCloud and `FileManager.default.ubiquityIdentityToken == nil`.                                    |

- **Scope lifetime:** call `startAccessingSecurityScopedResource()` once per resolved root per process. Call stop only on forget or when the vault switches away from the folder. Re-resolve on every foreground, which is cheap and catches moves, deletes and staleness. Never start access per file, because outstanding scoped resources are a limited kernel resource.
- Native writes run inside `beginBackgroundTask`, so the flush on hide (`VaultScreen.tsx:234-245`) completes.

**Coordinated I/O and compare-and-swap**

- `CoordinatedTree` (new) runs on a concurrent queue with a limit of 4. It never sleeps in `list` or `readMany`.
- **Version token:** `"<mtime in µs since 1970>:<bytes>"`, read fresh after `removeAllCachedResourceValues()`. Tokens are compared for equality only, never as an order.
- **List:** a coordinated read of the root with `.immediatelyAvailableMetadataOnly`, which never forces downloads. The enumerator prefetches `isRegularFile`, `isDirectory`, `isSymbolicLink`, `contentModificationDate`, `fileSize` and `ubiquitousItemDownloadingStatus`. Symlinks are skipped.
- **Write with `ifMatch`:** inside `coordinate(writingItemAt:options:.forReplacing)`, using `NSFileCoordinator(filePresenter: watcher)` so our own writes do not echo back as external changes:
  - Missing file: conflict, and the file is not recreated.
  - Evicted file: conflict with theirs `downloading`. We never write over a cloud copy we have not seen.
  - Token mismatch: conflict, with theirs read inside the same block.
  - Otherwise write with `Data.write(.atomic)` and return the token, stat'd inside the block.
- **Write with `ifAbsent`:**
  1. Compare case-insensitively and after NFC against the parent's entries, placeholders included. iCloud and a Mac treat names case-insensitively, so this check runs regardless of how the phone's volume behaves.
  2. Write a hidden temp file `.<name>.oscode-<uuid>.tmp` in the same directory.
  3. Call `renamex_np(tmp, dst, RENAME_EXCL)`. `EEXIST` means conflict.
- **Remove** takes `ifMatch` under `.forDeleting` and rejects on failure (plan 2.1).
- **Jail:** `confined(path)` compares `resolvingSymlinksInPath()` of both the root and the candidate.

**Evicted iCloud items**

- A list entry is flagged evicted in either case:
  - a `.X.icloud` placeholder, the older naming;
  - a regular file whose `ubiquitousItemDownloadingStatus` is `.notDownloaded` (dataless).
- `read(path, wait: true)`, used only for the note the person opens: call `startDownloadingUbiquitousItem`, then return `{downloading:true}` at once. The watcher reports when the download lands, and the store opens the note then if it is still the one pending.
- `readMany(paths)`, used for index builds, never waits and never starts a download.
- "Download all" is an explicit action by the person, with a size estimate.

**Change notification**

- `FolderWatcher: NSObject, NSFilePresenter`:
  - `presentedItemURL` is the vault root.
  - `presentedItemOperationQueue` is serial.
  - Subitem events it handles: `presentedSubitemDidChange`, `presentedSubitemDidAppear`, `presentedSubitem(at:didMoveTo:)` and `presentedSubitem(at:didGain:)` (a conflict version).
  - Root events it handles: `presentedItemDidMove(to:)` and `accommodatePresentedItemDeletion`.
- **Added** by `watch` while the Vault room is mounted. **Removed** on `didEnterBackgroundNotification`, so a suspended app never blocks another process's coordinated write. **Re-added** on `willEnterForeground`.
- Events are debounced by 300 ms. Dot paths are dropped, except the allow-listed config names. Each batch is emitted as `folderChanged {resourceId, paths, rootMoved?, rootGone?, conflict?}`.
- Presenters only hear coordinated writers, which means iCloud. Obsidian's own writes are caught by the focus re-check: `visibilitychange` already re-lists (`VaultScreen.tsx:234-237`), and 1.1 adds a re-read of the open note by version token.

**Conflict versions and sync duplicates (2.10b, shares 2.9)**

- `versions(path)` returns `NSFileVersion.unresolvedConflictVersionsOfItem(at:)`, each as `{id, savedAt, savedBy: localizedNameOfSavingComputer, text}`.
- `resolveVersions(path, keep)` runs under a coordinated write: `replaceItem(at:)`, then `isResolved = true` on each version, then `removeOtherVersionsOfItem(at:)`.
- iCloud "Note 2.md" style copies are real files. A pure `looksLikeSyncCopy(paths)` in the 3.1 core flags `<base> <n>.md` only when `<base>.md` sits in the same folder. The result is a quiet 2.2 badge with Compare. Nothing is ever deleted automatically.

**The two locations**

|                           | `On My iPhone/Obsidian/<vault>`                                                                  | `iCloud Drive/Obsidian/<vault>`                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Real path                 | `…/Containers/Data/Application/<uuid>/Documents/<vault>`                                         | `…/Mobile Documents/iCloud~md~obsidian/Documents/<vault>`                       |
| Classified as `where`     | `iphone-obsidian`: has `.obsidian/` and its parent is an app's `Documents`                       | `icloud-obsidian`: the path contains `/iCloud~md~obsidian/Documents/`           |
| Other writers             | Obsidian (one app in the foreground; both at once in iPad Split View); sync apps the person adds | Obsidian; iCloud from other devices; a Mac engine whose `vault.dir` points here |
| Eviction, `NSFileVersion` | None                                                                                             | Both                                                                            |
| Bookmark breaks when      | Obsidian is deleted or reinstalled (container uuid changes); restore to a new phone              | iCloud is signed out (temporary); the folder is moved or deleted                |

Any other folder is accepted, as `icloud-other` or `other`, with neutral copy and no Obsidian claim. The same code path handles all four.

#### 2. Provider id, files, and contract

**Why a new id `folder`, rather than reusing `files` or extending `icloud`:**

- `files` means the folder the computer's agent uses (`deviceFolder.ts:1-11`), and its roster blurb says "Your agent writes here too" (`providers.ts:113-114`). That is false on an iPhone, and 0.19's copy map is keyed by provider.
- `files` ignores `resourceId` (`deviceFolder.ts:8-9`), but the iPhone root is per resource.
- `icloud` writes a lease file into the vault (`icloud.ts:13, 50-66`). A lease file must never land in a person's Obsidian vault.

**Why the same native package:** the coordinated engine is shared with 2.1 and 2.9. A new package would have to duplicate it, or add a third package, and `cap sync` would regenerate `ios/App/CapApp-SPM/Package.swift` (`:4`, `:22`, `:39`).

| File                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/CoordinatedTree.swift` (new) | `list`, `stat`, `read(wait:)`, `readMany`, `write(ifMatch:ifAbsent:)`, `remove(ifMatch:)`, `readConfig`, `readBytes(max:)`, `versions`, `resolveVersions`, `versionToken`, `confined`. No `@objc(` anywhere in the file.                                                                                                                                              |
| `.../OscodeIcloudPlugin.swift`                                                         | Methods delegate to `CoordinatedTree(root: resourceRoot(id))` (2.1). Correct the Obsidian claim at `:4-7` (0.19).                                                                                                                                                                                                                                                     |
| `.../FolderBookmarks.swift` (new)                                                      | `save`, `load`, `forget`, `resolve(resourceId) -> FolderResolution`. No `@objc(`.                                                                                                                                                                                                                                                                                     |
| `.../FolderWatcher.swift` (new)                                                        | The `NSFilePresenter` above. No `@objc(`; the protocol methods need none.                                                                                                                                                                                                                                                                                             |
| `.../OscodeFolderPlugin.swift` (new)                                                   | `@objc(OscodeFolderPlugin)` as the file's first `@objc(`; `jsName "OscodeFolder"`. Methods: `available`, `pick`, `status`, `forget`, `watch`, `unwatch`, plus the tree methods keyed by `resourceId`.                                                                                                                                                                 |
| `app/src/lib/gitos/folderPlugin.ts` (new)                                              | Contract plus a web mock (`available:false`; `write` throws), registered as in `icloudPlugin.ts:48-50`.                                                                                                                                                                                                                                                               |
| `app/src/lib/gitos/folderClient.ts` (new)                                              | `makeFolderProvider(transport, meta)`: 0.6 `isNote`, mapping to 1.1's `{ok,file}\|{conflict,theirs}`, the 3.4 allow-list checked before the transport, the 6.6 byte cap, `stat` through the transport, and a trivial lease like `deviceFolder.ts:58-66`.                                                                                                              |
| `app/src/lib/gitos/iosFolder.ts` (new)                                                 | `iosFolderProvider = makeFolderProvider(pluginTransport, …)`, plus `chooseVaultFolder`, `vaultFolderStatus`, `forgetVaultFolder`, `watchVaultFolder`, `isIosFolderAvailable`.                                                                                                                                                                                         |
| `app/src/lib/gitos/deviceFolder.ts`                                                    | Becomes `makeFolderProvider(electronTransport, filesMeta)`, so the desktop and iPhone clients cannot drift.                                                                                                                                                                                                                                                           |
| `app/src/lib/gitos/providers.ts`                                                       | Add `'folder'` to the id union (`:22-23`). Add `version?: string` to `StoredFile` and `StoredFileMeta` (`:28-44`); it is 1.1's `ifMatch`. Size doc becomes bytes (`:38`). Roster row after `files` (`:110-119`).                                                                                                                                                      |
| `app/src/lib/gitos/index.ts`                                                           | Register in `PROVIDERS_BY_ID` (`:18-24`); `probeReady('folder')` returns `isIosFolderAvailable()` (`:36-43`).                                                                                                                                                                                                                                                         |
| `app/src/state/store.ts`                                                               | New state `vaultFolder`. New actions `vaultChooseFolder()`, `vaultUseFolder({bring})`, `vaultForgetFolder()`. `vaultRefresh` resolves status first and sets a typed `vaultError` (`:5964-6001`). `vaultMoveTo` always uses `ifAbsent` (`:6238-6250`). `folderChanged` feeds 1.1's external-change path. The lease is a no-op, so `vaultLeaseHeldByOther` stays false. |
| `app/src/screens/VaultScreen.tsx`                                                      | Folder row in the storage sheet (`:861-936`). Chooser on `Sheet.tsx`. State cards replace the generic offline card (`:701-711`). "In iCloud" badge on tree rows (`:786-807`). `watch`/`unwatch` effect beside the lease effect (`:163-174`). Drop the duplicate `VAULT_RESOURCE_ID` (`:34`).                                                                          |

**Enrolling in `providerContract.test.ts` (1.1, `plan:431-435`)**

- The row is `{name: 'folder (iOS, mocked plugin)', make}`. It uses `vi.mock('../src/lib/gitos/folderPlugin.js')`, backed by `app/test/fixtures/fakeFolderTree.ts`, an in-memory copy of the Swift decision table.
- The fake exposes `external.write/remove/evict/caseVariant`, standing in for Obsidian and iCloud. An external same-size write bumps mtime by 1 µs.
- The folder row must pass:
  - a stale `ifMatch` conflicts and leaves the bytes unchanged;
  - `ifMatch` on a file deleted by someone else conflicts and does not recreate it;
  - `ifAbsent` on an existing file, an evicted placeholder, or a case variant conflicts;
  - `remove` with a stale `ifMatch` conflicts;
  - `readConfig` and `readBytes` cases (from 3.4 and 6.6).
- The desktop `files` row runs the same cases through its own transport.

#### 3. How it interacts with the rest of the plan

- **0.6 isNote filter.**
  - The native list returns notes (`.md`) plus an attachment count. Attachments are listed only on request, for 6.6. `.canvas` is hidden.
  - `.obsidian/`, `.trash/` and `.oscode/` are pruned with `skipDescendants()`.
  - `folderClient` applies `isNote` again on the JS side.
- **3.4 readConfig.**
  - The same four names, allow-listed natively as well, read under coordination with a 256 KB cap.
  - If a config file is evicted, the call returns `downloading` and defaults apply until a `folderChanged` for that name triggers a re-read.
  - OpenShore never writes `.obsidian/`.
  - Obsidian mobile can override its config folder name per device. In that case nothing is found and defaults apply; the M8 fixture checks this.
- **6.6 readBytes.** Jailed and capped (10 MB), sent as base64 over the bridge, and resolved through `attachmentFolderPath`. An evicted image renders a "Downloading from iCloud" placeholder, never a silent download.
- **6.3 and 6.2 also benefit.**
  - `.trash/` is Obsidian's own trash, so a note deleted in OpenShore shows up in Obsidian's trash.
  - Rename is a coordinated `.forMoving` move, followed by `item(at:didMoveTo:)`.
- **0.5 vaultMoveTo.** Two modes:
  - **Open in place** copies nothing. It is the default, and the only option when the current vault is empty.
  - **Bring notes** copies with `ifAbsent` per note. On a name conflict the note is written as `<name> (from OpenShore 2026-09-27 0930).md`, also with `ifAbsent` and a counter. It skips dot paths (so `.oscode/lease.json` never travels), aborts if any source read is empty or evicted, checks counts before repointing, and keeps the source.
  - Existing users on the `icloud` provider get a card offering "bring notes" into an Obsidian iCloud vault.
- **Lease.** The folder provider writes no lease file. 2.5 treats it as a compare-and-swap provider. Protection comes from compare-and-swap, the watcher, and the focus re-check.
- **D2.** The folder is never a default. A paired phone stays on "Your computer" until the person chooses otherwise. Choosing the folder does not unpair or touch the computer's vault. Until v1.1 there is one vault resource, so the previous vault's bytes stay where they are and switching back is one tap.
- **M5 pack (5.1).**
  - The 3.2 index is built on the phone, keyed by `folderId` and stored in the sealed store outside the vault.
  - Evicted notes are indexed by title and path only; a turn never downloads.
  - 4.2 exclusions and local-only apply before ranking. A vault in iCloud does not change local-only, which means never sent to a model provider.
  - Amber card for cloud seats. The card adds "N notes still in iCloud were left out" when that applies.
- **Desktop engine.**
  - A Mac may set `vault.dir` (1.4 picker, 0.12 loader) to `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/<vault>`. The Mac agent, Mac Obsidian, iPhone Obsidian and the iPhone's OpenShore then share bytes through iCloud, eventually rather than live.
  - Both sides use compare-and-swap. iCloud conflicts reach the phone as versions (2.9).
  - The engine's index walk should skip dataless files rather than download them (heuristic `size>0 && blocks===0`, to confirm on a device).
  - Linux has no iCloud Drive, so a phone reaches a Linux vault only through "Your computer" (5.2). Windows is untested and gets no copy.
  - When the hub reports a matching `iCloud~md~obsidian/Documents/<name>`, the phone can show "Same vault as your computer". That is S and can slip to v1.1.

#### 4. Copy (storage sheet row and states)

| Where or state                   | Line                                                                                                                                                                                        | Actions                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Row, not chosen                  | **Your Obsidian vault.** "Open it where it already is, on this iPhone or in iCloud Drive. Any folder of notes works too."                                                                   | Choose                                       |
| Before the picker                | "Next, open On My iPhone or iCloud Drive, then Obsidian, then your vault, and tap Open."                                                                                                    |                                              |
| Chooser facts                    | "Work, in iCloud Drive, Obsidian. 1,240 notes. 86 are still in iCloud."                                                                                                                     | Open it here                                 |
| Chooser, current vault has notes | "Your 42 notes stay on This device either way. Brought notes go beside what is there. Nothing in the folder is overwritten."                                                                | Open it here · Open it and bring my 42 notes |
| Obsidian's parent folder picked  | "This is Obsidian's folder, with 3 vaults in it. Choose one."                                                                                                                               | (vault list)                                 |
| Empty folder                     | "This folder has no notes yet. New notes you write go here."                                                                                                                                |                                              |
| Current, `icloud-obsidian`       | "Work, in iCloud Drive. Obsidian opens the same files, and iCloud syncs them to your other devices."                                                                                        | Here now                                     |
| Current, `iphone-obsidian`       | "Notes, on this iPhone. Obsidian opens the same files. They stay on this iPhone unless another app syncs them."                                                                             | Here now                                     |
| Current, `icloud-other`          | "Work, in iCloud Drive. Obsidian on iPhone opens vaults only from its own folder, so it will not show this one."                                                                            |                                              |
| Current, `other`                 | "Work. OpenShore reads and writes the notes in this folder. The app that keeps the folder syncs it, not OpenShore."                                                                         |                                              |
| Paired, not the same vault       | "Your computer's agent works from the vault on your computer, not this folder."                                                                                                             |                                              |
| Paired, same iCloud vault        | "Your computer keeps its vault in this same iCloud folder. Changes arrive when iCloud syncs them."                                                                                          |                                              |
| Access lost                      | "OpenShore cannot open this folder right now. Choose it again to reconnect."                                                                                                                | Choose folder · Use This device              |
| Last-known tree                  | "These are the notes from the last time OpenShore could open the folder. Read-only until you reconnect."                                                                                    |                                              |
| Held text (0.4)                  | "Not saved. OpenShore cannot reach the folder. Copy your text, or reconnect and save again."                                                                                                | Copy · Discard                               |
| Moved                            | "Your vault folder moved. OpenShore found it at &lt;path>." If it left Obsidian's folder, add: "Obsidian on iPhone opens vaults only from its own folder, so it may not show this one now." |                                              |
| In Recently Deleted              | "This folder is in Recently Deleted. Restore it in the Files app to keep using it here."                                                                                                    | Choose another folder · Use This device      |
| Gone                             | "OpenShore cannot find this folder anymore. Choose it again if it moved, or choose another folder."                                                                                         | Choose folder                                |
| iCloud signed out                | "iCloud is signed out on this iPhone, so this folder is out of reach. Sign in to iCloud in Settings, or choose another folder."                                                             |                                              |
| Not downloaded                   | "86 notes are still in iCloud. Each one downloads when you open it." Tree badge: "In iCloud".                                                                                               | Download all (about 12 MB)                   |
| Opening an evicted note          | "This note is still downloading from iCloud. It opens when it arrives."                                                                                                                     |                                              |
| First index                      | "Reading your vault, 1,200 of 5,000 notes. You can keep writing."                                                                                                                           |                                              |
| iCloud versions                  | "iCloud kept two versions of this note, one saved on &lt;device>. Keep one, or keep both."                                                                                                  |                                              |
| Sync copy badge                  | "Maybe a sync copy of Note.md"                                                                                                                                                              | Compare                                      |
| Bring result                     | "Brought 40 of 42 notes into Work. 2 went beside notes with the same name."                                                                                                                 |                                              |
| Bring aborted                    | "Nothing was moved. 3 of your notes are still downloading from iCloud. Try again when they are here."                                                                                       |                                              |
| Forget                           | "OpenShore no longer opens Work. The folder and its notes are unchanged."                                                                                                                   |                                              |

The sheet subtitle at `VaultScreen.tsx:856-858` and the export toast at `:960` are corrected through 0.19. No line says "always", "live" or "instantly", and no iPhone line says the agent writes here.

#### 5. Milestone, size, tests, risks

**Placement.** M2, as 2.10.

- **Hard dependencies:** 0.5, 0.6, 0.19, 1.1 (seam shape, resolve sheet, contract harness) and 2.1 (the `CoordinatedTree` refactor is one job serving both roots).
- **Soft dependencies:** 0.4 (holding place), 2.2 (badge), 2.9 (versions) and 3.2 (index).
- **Later items that each add the folder row to their own contract case:** 3.4, 6.2, 6.3, 6.6 and 7.1.
- **Flag:** it ships behind `settings.vaultFolderPicker` (off) until 3.2 lands. Until then, backlinks read every note on every open (`store.ts:6154-6177`), which on a 3,000-note vault is the 5.6 s path or worse over the bridge.
- The critical path does not change, because M2 runs beside M3 and M4.

**Size: XL, about two engineer-weeks on top of 2.1 and 2.9.**

- **2.10a (L, about 6 days):** pick, bookmark, states, compare-and-swap tree methods, provider, row, chooser, open in place, copy, and tests.
- **2.10b (M, about 3 days):** watcher, versions, sync-copy badge, bring notes, and Download all.
- Plus a 1-day device run.
- M2 grows from 3.5 to about 5.5 engineer-weeks, and the plan total from about 28.5 to about 30.5.
- The draft's "L" only holds if 2.10b slips.

**JS tests (mocked plugin)**

- New `app/test/folderProvider.test.ts`:
  - `.obsidian/workspace-mobile.json`, `.trash/x.md`, `.oscode/vault.json`, `img.png` and `Board.canvas` are not listed as notes; a placeholder lists as evicted under its real name.
  - `ifMatch` is sent exactly as the `version` that read returned.
  - A native conflict maps to `{conflict, theirs}`, and a `downloading` theirs pauses autosave.
  - `stat` never calls `list`.
  - `readConfig` refuses `.obsidian/plugins/x/data.json` before reaching native code.
  - `readBytes` over the cap returns `tooLarge`.
  - The lease writes no file.
  - Each status maps to a typed `vaultError` and refuses writes.
  - `probeReady('folder')` is false on web and Electron.
- `providerContract.test.ts`: the folder row described in section 2.
- `vaultStore.test.ts`:
  - Open in place writes nothing.
  - With bring notes, a same-name Obsidian note keeps its exact bytes and the OpenShore copy lands beside it.
  - `.obsidian/` and `.oscode/lease.json` are never copied, and one evicted source aborts the move with the resource unchanged.
  - A `folderChanged` event reloads a clean note and pauses a dirty one.
  - A pending evicted open finishes on its download event, but not after the person opens another note.
- `vaultCopy.test.ts`: every `where` × state pair comes from the copy map; "Obsidian opens" appears only for the two Obsidian locations; no agent claim on an iPhone folder.
- `vaultCore.test.ts`: a `looksLikeSyncCopy` table. "Chapter 2.md" alone is not flagged; "Note 2.md" beside "Note.md" is.
- `vaultIndex.test.ts` (3.2): a first build over a vault with 40% evicted notes never waits or downloads, and reports the skipped count.
- New `app/test/nativePlugins.test.ts` (static guard): in each `.swift` file, the first `@objc(` names that file's plugin class and helper files have none; there is no `.skipsHiddenFiles` in `CoordinatedTree.swift`; version tokens are not built with `ISO8601DateFormatter`.
- `polish-standards`, `motion-tokens` and both em-dash guards stay green. The chooser uses `Sheet.tsx` and has its `closing` binding.

**Device checklist lines (append to 8.1, `plan:944`)**

1. `On My iPhone/Obsidian/<vault>`: notes list, `.obsidian/` does not, edits save, and Obsidian shows them when next opened.
2. `iCloud Drive/Obsidian/<vault>` with Optimize Storage on and half the notes evicted: badges show, opening a note downloads it, and a create with an evicted note's name opens that note.
3. Pick Obsidian's parent folder, choose a vault, relaunch: it still opens.
4. Edit in Obsidian, return with the note clean: it reloads. With the note dirty: the resolve sheet opens.
5. Edit in OpenShore while Obsidian has the note open, switch to Obsidian and back. Record whether Obsidian overwrites from its buffer; the result decides whether copy gets a "leave it open in one app" tip.
6. iPad Split View, typing in both apps: no silent loss.
7. Two devices editing offline, then online: iCloud versions reach the resolve sheet, and a "Note 2.md" gets its badge.
8. Rename the vault folder in Files: OpenShore follows it (stale bookmark refreshed).
9. Delete the folder, then restore it: the Recently Deleted state appears, and the vault works again after the restore.
10. Reinstall Obsidian with a local vault: the gone state shows, and nothing is written anywhere else.
11. Sign out of iCloud and back in: the signed-out state shows, then clears without a re-pick.
12. Restore or migrate to a new phone: an iCloud vault resolves or asks for a re-pick; a local vault asks for a re-pick.
13. A 5,000-note vault: progress shows, the editor stays responsive, memory stays under the ceiling, and a relaunch uses the persisted index.
14. A Mac whose `vault.dir` is in the same iCloud vault: an approved agent note arrives on the phone.
15. Background the app in the middle of a save: the write completes and no file is torn.
16. The App Review steps work without Obsidian installed.

**Risks**

- **App Review (low).** The folder picker is a standard API the person starts, and there is no new entitlement or usage string. Name Obsidian only descriptively, with no Obsidian icon and no "official" wording (guideline 5.2.1). The review notes should show testing with a plain folder in On My iPhone. Never log folder names or paths; `store.ts:6257` already logs provider ids only.
- **Bookmark staleness.** Obsidian reinstalls, restores, sign-out and moves all break or shift the bookmark. Mitigations: re-resolve on every foreground, typed states, never recreate a folder at an old path, never switch providers silently, and hold unsaved text through 0.4.
- **Obsidian writes without coordination.** Presenters never hear its writes, so safety rests on compare-and-swap plus the focus re-check. To guard against a torn read: re-stat after reading, and read once more if the token moved. Obsidian's in-memory buffer is outside our control; checklist line 5 decides the copy.
- **iCloud conflicts and duplicates.** Covered by equality-only tokens, 2.9 versions, the case-insensitive `ifAbsent`, and the badge. Nothing is deleted automatically.
- **Large vaults on a phone.** Covered by the bounded concurrent queue, `readMany`, no implicit downloads, a persisted index, and the flag staying off until 3.2.
- **The Capacitor class-scan trap** (`iosplugin.js:36-38`) is pinned by the static guard.
- **Other apps' folders** (Dropbox, Working Copy, Möbius Sync) are accepted with neutral copy and no sync claim. Only the two Obsidian locations are on the checklist.
- **Plan text to change:**
  - The 2.10 draft (`:565-577`) becomes this item, with size XL and the 2.10a/2.10b split.
  - The draft's "downloads evicted items before a read" becomes "downloads only the note you open".
  - "checks the modification date" becomes "modification date and byte size, compared for equality under coordination".
  - The parity row at `:165` gains "Obsidian on iPhone (2.10)".
  - The effort table at `:1107` becomes about 5.5 engineer-weeks for M2.

## Part two: the check

**Verdict:** the design is sound in shape, and its code audit is accurate. It breaks in about a dozen places on iOS behavior, on the store's single resource id, and on copy honesty. Every break has a concrete fix, and none of them changes the milestone plan.

**Web access:** Apple Developer Forums were reachable (threads 766646, 773373, 785030, 681520, 820475, plus search results). developer.apple.com doc pages rendered empty. obsidian.md, forum.obsidian.md, objc.io, khanlou.com, dev.to and fatbobman.com were blocked by the egress proxy. So Obsidian behavior still rests on the review's evidence (obs-10) and reviewer knowledge, and M8's fixture remains the guard.

#### (a) What holds

- **Section 0 audit, checked line by line.** Two citations drift:
  - `providers.ts` roster is `:120-129` and the blurb is `:123-124` (the design says `:110-119` / `:113-114`).
  - `main.ts` byte size is `:947` (the design says `:944`).
- **Item 0.1 is urgent.** Plan 0.6 (`:294`) says "the Swift list() skips hidden paths", and M0 is next. `.skipsHiddenFiles` would hide the `.X.md.icloud` placeholders that `OscodeIcloudPlugin.swift:90-101` maps. That brings back create-over-evicted for current iCloud users.
- **Capacitor class scan.** `iosplugin.js:36-38` takes only the first `@objc(` per file. `CapacitorBridge.swift:312-330` skips non-plugin classes without error. So a stray helper entry is harmless. The real trap is a plugin class that is not the first `@objc(` in its file, or a second plugin in one file: it is silently never registered. The rule and the static guard are right.
- **Picker and bookmark mechanics.**
  - `UIDocumentPickerViewController(forOpeningContentTypes:[.folder])` from `bridge?.viewController`: correct.
  - No entitlement is needed: correct.
  - `url(forUbiquityContainerIdentifier:"iCloud.md.obsidian")` is nil without Obsidian's entitlement: correct.
  - `.withSecurityScope` is macOS-only. DTS (thread 766646): "Technically, iOS doesn't support security-scoped bookmarks... if you have access to a resource then you should be able to persist that access using a regular bookmark." A `.minimalBookmark` made while access is started matches Apple's sample.
  - Resolving with `.withoutUI` and handling stale by re-bookmarking: correct.
- **Presenters hear only coordinated writers.** So Obsidian's writes need the focus re-check. Removing the presenter on background is also correct.
- **The new `folder` id is justified.** Reasons: `files` ignores `resourceId`, the "agent writes here" copy is false on a phone, and the `icloud` lease file must never land in a person's vault. Keeping it in the same native package is also right.
- Also correct:
  - equality-only tokens and byte sizes;
  - never downloading during an index, and no lease;
  - `ifAbsent` with `RENAME_EXCL` (supported on APFS);
  - the flag off until 3.2;
  - no automatic deletes;
  - logging provider ids only (`store.ts:6257`).

#### (b) What is wrong or risky, with the correction

1. **A coordinated read downloads first.** Apple: a coordinated read "downloads the file before calling the accessor block". As written, `readMany` and every token read inside a block can block on a download, and a stuck download wedges one of the four queue slots.
   - Fix: check the downloading status before any coordinated file read, and skip anything not `.current`.
   - Put an `NSFileCoordinator.cancel()` watchdog on every coordinated call, about 10 s for reads and 20 s for writes, which also covers the background-task expiry.
2. **iOS 18.4 and later: a stale local copy.** Thread 785030 (FB17662379): files can sit in `.downloaded`, meaning a stale local copy with a newer version in iCloud, "indefinitely". A save against it passes the token check and forks the note in iCloud.
   - Fix: treat `.downloaded` like evicted on write (conflict, `downloading`).
   - Call `startDownloadingUbiquitousItem` on open.
3. **`Data.write(.atomic)` replaces the file.** That resets the note's creation date, which Obsidian shows as "created" and sorts by (likely; a checklist line confirms). It also leaves a race with Obsidian, which does not coordinate, between the token check and the rename.
   - Fix, "swap and verify":
     1. Write a temp file in the same folder and copy the target's `creationDate` onto it.
     2. `renamex_np(tmp, dst, RENAME_SWAP)`.
     3. `lstat` the displaced original. If its token is not `ifMatch`, swap back and return a conflict.
     4. Unlink the temp.
   - Fall back to `replaceItemAt` on `ENOTSUP`.
   - Sweep orphaned `.oscode-*.tmp` files on resolve.
   - The same creation-date reset applies to 1.1's temp-and-rename on the desktop.
4. **The token needs a file id.**
   - Fix: build it in one function from `lstat(2)`, as `ino:mtime_ns:size`, and use it for list and read alike. An atomic replace by another app then always changes it.
   - A conflict whose theirs equals the base text should re-save silently. Metadata-only churn must not raise the resolve sheet.
5. **Jail.** `resolvingSymlinksInPath()` does not resolve a leaf that does not exist yet, and its NSString form strips `/private` only for existing files. New-note writes would then be falsely refused.
   - Fix: `realpath(3)` the parent, compare it with `realpath(root)`, require a plain leaf name, and refuse a leaf that `lstat` shows is a symlink.
6. **The scope leaks on every foreground.** Re-resolving yields a new URL, and starting access on it each time adds a scope every time.
   - Fix: keep the active URL. Start the new one and stop the old one only when the resolved path changes.
   - Do the resolve and the pick-time inspection off the main thread, under `.immediatelyAvailableMetadataOnly`.
7. **The `moved` state compares raw container paths.** The `Containers/Data/Application/<uuid>` part can change without the person doing anything (app update, restore). That would show a scary "moved" card with a raw path.
   - Fix: compare a display path (location class plus components below `Documents`), and show that path in copy.
   - Keep `folderId` when a re-pick resolves to the same file id, so the index is not rebuilt.
8. **`signedOut` via `ubiquityIdentityToken == nil` is the wrong signal.** It reflects OpenShore's own iCloud access (its per-app switch and provisioning), not whether the picked folder is reachable.
   - Fix: decide `signedOut` only after a failed read on an iCloud location, and re-resolve on `NSUbiquityIdentityDidChange`.
   - Whether access comes back without a re-pick after signing in is unknown. Copy must not promise it.
9. **`denied` from `startAccessing…` returning false misfires on OpenShore's own containers.** No scope is needed there, so it returns false. A reviewer testing with a folder in On My iPhone/OpenShore would hit this.
   - Fix: decide `denied` only from a failed coordinated read.
   - Refuse OpenShore's own iCloud vault folder, with copy that points to the iCloud Drive row instead of mapping the same files twice.
10. **`iphone-obsidian` classification overclaims.** An app's `Documents` path does not name the app.
    - Fix: require Obsidian's mobile workspace file (`workspace-mobile.json`) in the config folder.
    - Obsidian mobile can override the config folder per device (it must start with a dot). So detect any top-level dot folder holding `workspace-mobile.json` or `app.json`, store it as `configDir`, and have 3.4's `readConfig` map `.obsidian/<name>` to it. Otherwise a vault using the override reads as a plain folder and its settings are missed.
    - Confirm `icloud-obsidian` with `ubiquitousItemContainerDisplayNameKey`.
11. **Picking a folder inside a vault is not handled.** A folder at depth 2 or more under Obsidian's `Documents` would get the "Obsidian will not show this" copy, which is false. Its links would also resolve from the wrong root.
    - Fix: detect the depth and ask for the vault folder itself.
    - Parent plus subpath should also record the vault's file id, so a rename in Files is followed.
12. **Presenter subitem events are unreliable.** Community reports say only `presentedSubitemDidChange` and `didMoveTo` are dependable. `didAppear` and `didGain` are not, and a finished download is not guaranteed to raise any event.
    - Fix: treat presenter events as hints.
    - Prefetch `ubiquitousItemHasUnresolvedConflictsKey` in `list`.
    - Poll the status of the one note waiting on a download (a native timer, about 1 s, capped).
    - This is a scene-based app (`SceneDelegate.swift`), so also observe `UIScene` background and foreground notifications.
13. **Size is unknowable for evicted items.** DTS (thread 681520): "no public API to get the metadata for an un-downloaded iCloud file."
    - Fix: "Download all (about 12 MB)" becomes "Download all 86".
14. **Leaving the folder copies the Obsidian vault into the sealed store.** Today's `vaultMoveTo` copies everything (`store.ts:6227-6251`), so switching back to This device would do this.
    - Fix: entering and leaving the folder only repoint; only "bring my notes" copies.
    - `vault.personal` is the one resource id for every provider (`store.ts:552`). So `vaultBodyCache` and stash keys must carry the provider and `folderId`.
15. **iPad Split View is not possible today.** `Info.plist:103-104` sets `UIRequiresFullScreen`. That key is deprecated since iPadOS 26 and may be ignored on a newer SDK.
    - Fix: make checklist line 6 conditional, and fix the "Other writers" row.
    - "Obsidian is deleted or reinstalled" understates the risk: deleting Obsidian deletes an On My iPhone vault.
16. **The fake is not the Swift.** `fakeFolderTree.ts` proves the JS client only, and CI runs Linux only (`ci.yml:42`).
    - Fix: add a Swift XCTest target for the `CoordinatedTree` decision table, run with `xcodebuild test` on the Mac that builds the iOS app and recorded in PROGRESS.
17. **Plan interplay.**
    - The `version` field, the byte-size doc, and the shared `folderClient.ts` belong in 1.1, so the desktop client is not rebuilt in M2.
    - 2.9 can no longer be "the first cut if M2 slips": hidden conflict versions in a person's Obsidian iCloud vault break ship gate 1. New cut order: Download all, then the sync-copy badge.
    - D2 needs the other direction: pairing never moves a person off a folder they chose.
    - 6.3's "shows up in Obsidian's trash" overclaims, since Obsidian has no trash screen.
    - `readMany` should be an optional seam capability that `vaultReadAll` uses, so TestFlight can run with the flag on before 3.2.
18. **Copy.**
    - Drop "Any folder of notes works too": File Provider locations such as Dropbox and Drive are untested.
    - `localizedNameOfSavingComputer` can be nil, so fall back to "another device".
    - Tell iPhone-folder users that deleting Obsidian deletes the vault.
    - Soften `icloud-other` to "may not".
19. **Size.** A one-day device run is not credible for two devices, a Mac, sign-out, restore and 5,000 notes. Estimate 2.10 at about 2.5 engineer-weeks, M2 at about 6, and the total at about 31.

#### (c) Corrected plan text

**2.10a The iPhone opens an existing Obsidian vault in place (L; founder ruling 2026-09-27; needs 0.5, 0.6, 0.19, 1.1, and 2.1; behind `settings.vaultFolderPicker`, on in TestFlight, on by default once 3.2 lands).**

- **Pick.** A storage sheet row, "Your Obsidian vault", opens the iOS folder picker (open in place, not a copy). The picker comes from a second plugin class, `OscodeFolderPlugin`, in the existing `oscode-icloud` package. No new entitlement is needed.
- **Bookmark.** The native side keeps a plain bookmark of the picked folder in Application Support, never in JS. iOS has no security-scoped bookmark option; a regular bookmark made while access is started carries it. Access starts once per resolved root and is re-resolved off the main thread on each foreground, with the old scope stopped only when the resolved URL changes.
- **States.** One typed state is reported: ok, stale (re-bookmarked silently), moved (judged by display path, never by container path), in Recently Deleted, gone, denied (only after a failed read), or unreachable while iCloud is signed out (only after a failed read).
- **Classification.**
  - Obsidian's iCloud folder: `iCloud~md~obsidian/Documents/<vault>`, confirmed by the container display name.
  - An Obsidian vault on this iPhone: an app's `Documents/<vault>` whose dot config folder holds `workspace-mobile.json`. That folder, `.obsidian` or a per-device override, is stored for 3.4.
  - Obsidian's parent folder: the person chooses a vault. Kept as the parent bookmark, the subpath, and the vault's file id, so a rename is followed.
  - A folder inside a vault: the person is asked for the vault itself.
  - OpenShore's own folders: refused.
  - Any other folder: neutral copy, no Obsidian claim.
- **`CoordinatedTree`**, shared with 2.1 and 2.9:
  - runs on a bounded concurrent queue with a cancel watchdog on every coordinated call, and never sleeps;
  - lists under `.immediatelyAvailableMetadataOnly`, pruning dot folders with `skipDescendants` and never using `.skipsHiddenFiles`;
  - never coordinates a read of an item that is not current;
  - jails by the real path of the parent.
- **Versions** are opaque `lstat` tokens (file id, nanosecond mtime, bytes), compared for equality only.
- **Write with `ifMatch`.** It conflicts when the file is missing, evicted, has a newer version waiting in iCloud, or its token moved. Otherwise it writes a temp file carrying the note's creation date, swaps it in with `renamex_np(RENAME_SWAP)`, and checks the displaced file. If that file changed, it swaps back and returns a conflict.
- **Write with `ifAbsent`.** It checks case- and NFC-insensitively against every entry, placeholders included, then publishes with `RENAME_EXCL`.
- **Remove** takes `ifMatch` and rejects on failure.
- **Background.** Writes run inside a background task.
- **Downloads.** Only the note the person opens is downloaded; `readMany` never waits.
- **Provider.** The provider `folder` is the 1.1 `folderClient.ts` with an iOS transport, and it writes no lease file.
- **Moving.** Opening in place and leaving the folder only repoint. "Bring my notes" copies with `ifAbsent`, and a same-name note lands beside the Obsidian one.

Closes [obs-10] [obs-3] (iPhone half).

Where:

- `app/plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/`: `CoordinatedTree.swift`, `FolderBookmarks.swift`, `OscodeFolderPlugin.swift`, and `OscodeIcloudPlugin.swift:4-7`
- `app/src/lib/gitos/folderPlugin.ts`, `iosFolder.ts`, `providers.ts:22-23, 120-129`, `index.ts:18-24, 36-43`
- `store.ts`: `:5964-6001`, `:6213-6259`, plus `vaultChooseFolder`, `vaultUseFolder`, `vaultForgetFolder`
- `VaultScreen.tsx`: `:701-711`, `:786-807`, `:852-972`

Test:

- A new `app/test/folderProvider.test.ts`, with a mocked plugin:
  - dot paths, `.canvas` files, and images never list as notes;
  - a placeholder lists as evicted under its real name;
  - `ifMatch` sends the version that read returned;
  - a conflict maps to `{conflict, theirs}`, and a `downloading` theirs pauses autosave;
  - `stat` never lists;
  - each state maps to a typed `vaultError` and refuses writes;
  - no lease file is written;
  - `probeReady('folder')` is false on web and Electron.
- The folder row in `providerContract.test.ts`, over `app/test/fixtures/fakeFolderTree.ts`.
- `vaultStore.test.ts`:
  - open in place writes nothing, and leaving the folder copies nothing;
  - bring notes keeps a same-name Obsidian note byte for byte;
  - one evicted source aborts the move;
  - caches and stash entries never cross providers or folders.
- `vaultCopy.test.ts`: "Obsidian opens" appears only for the two Obsidian locations.
- A static `app/test/nativePlugins.test.ts`:
  - each plugin class is the first `@objc(` in its own file;
  - helper files have none;
  - no `.skipsHiddenFiles` or `ISO8601DateFormatter` in `CoordinatedTree.swift`.
- A Swift XCTest target for the `CoordinatedTree` decision table, run with `xcodebuild` and recorded in PROGRESS.
- Device checklist lines (8.1).

**2.10b The folder stays current and shows every copy (M; needs 2.10a and 2.9).**

- A `FolderWatcher` file presenter is added while Vault is on screen and removed on app or scene background. It turns iCloud's coordinated changes into `folderChanged` hints.
- The focus re-check is the backstop for Obsidian's uncoordinated writes.
- A status poll finishes a pending open, but not after the person opens another note.
- Unresolved `NSFileVersion` conflicts reach the resolve sheet. The list flags them with the unresolved-conflicts key.
- "Note 2.md" beside "Note.md" wears a "Maybe a sync copy" badge with Compare. Nothing is deleted automatically.
- "Download all" asks iCloud for every evicted note, by count.

Closes [data-15] (folder half).

Where: `FolderWatcher.swift`, `CoordinatedTree.swift` (versions), `looksLikeSyncCopy` in the 3.1 core, `VaultScreen.tsx`.

Test:

- `vaultStore.test.ts`: a `folderChanged` reloads a clean note and pauses a dirty one.
- `vaultCore.test.ts`: a `looksLikeSyncCopy` table ("Chapter 2.md" alone is not flagged).
- Device checklist lines (8.1).

**Other plan text to change:**

- **0.6:** "prunes dot folders with `skipDescendants` and keeps mapping `.X.icloud` placeholders (never `.skipsHiddenFiles`)".
- **1.1:** adds opaque `version` fields, documents size as bytes, and builds `folderClient.ts` as a shared client over a transport.
- **2.9:** loses "the first cut".
- **D2:** adds "a person who chose their Obsidian vault stays on it when they pair".
- **3.4:** `readConfig` maps `.obsidian/` to the detected config folder.
- **6.3:** "`.trash/`, the folder Obsidian uses for its own trash".
- **Parity row `:165`:** adds "Obsidian on iPhone (2.10)".
- **Effort table:** M2 about 6, total about 31.

**Copy lines that change:**

- **Row:** "Open it where it already is, on this iPhone or in iCloud Drive."
- **`iphone-obsidian`:** add "...and they go if Obsidian is deleted."
- **Inside a vault:** "This folder is inside a vault. Choose the vault folder itself, so links work the way they do in Obsidian."
- **Newer version waiting:** "A newer version of this note is on its way from iCloud. Your text is kept, and OpenShore asks what to keep when it arrives."
- **Moved:** "...found it in iCloud Drive, Obsidian, Work."
- **Signed out:** "...Sign in to iCloud in Settings. If the folder does not come back, choose it again."
- **Versions:** "one saved on &lt;device or another device>".
- **Download action:** "Download all 86".

**Device checklist lines (append to 8.1):**

1. On My iPhone/Obsidian/&lt;vault>: notes list, `.obsidian/` does not, edits save, and Obsidian shows them next time it opens.
2. Save in OpenShore: Obsidian's "Created time" for that note is unchanged.
3. iCloud Drive/Obsidian/&lt;vault>, Optimize Storage on, half the notes evicted: badges show, opening a note downloads it, and a same-name create opens the existing note.
4. Edit a note on the Mac and open it on the phone before iCloud delivers it: saves hold, and no fork appears in iCloud.
5. Pick Obsidian's parent folder, choose a vault, rename the vault in Files, relaunch, then reboot: it still opens.
6. Pick a folder inside a vault: the prompt asks for the vault folder.
7. A vault using a config folder override: it is found and its settings apply.
8. Edit in Obsidian, return with the note clean: it reloads. Return with the note dirty: the resolve sheet opens.
9. Edit in OpenShore while Obsidian has the note open, then switch back and forth. Record whether Obsidian writes over it from its buffer.
10. iPad two-app typing: only if the build is resizable (`UIRequiresFullScreen` is gone). Otherwise mark N/A.
11. Two devices offline, then online: versions reach the resolve sheet, and "Note 2.md" gets its badge.
12. Delete the folder, then restore it: the Recently Deleted state shows, then clears.
13. Offload Obsidian, then delete Obsidian: record what happens, and confirm nothing is written anywhere else.
14. Sign out of iCloud, then back in: record whether it resolves without a re-pick.
15. Restore to a new phone: an iCloud vault resolves or asks for a re-pick; a local vault asks for a re-pick.
16. 5,000 notes: progress shows, the editor stays responsive, memory stays under the ceiling, and a relaunch uses the persisted index.
17. A Mac with `vault.dir` in the same iCloud vault: an approved agent note arrives on the phone. Record any macOS Files and Folders prompt.
18. Background the app mid-save: the write completes and the file is not torn.
19. Swipe the picker away: the call resolves as a cancel.
20. App Review steps pass with a plain folder and no Obsidian installed.

**Founder-facing caveat:**

- OpenShore opens the vault where it lives and keeps no copy. A vault kept On My iPhone is deleted if Obsidian is deleted.
- Obsidian does not take part in iOS file coordination, so protection comes from a check at the moment of saving and a re-check when OpenShore comes to the front, not from live updates. Changes from other devices arrive when iCloud syncs them.
- Nothing native to Swift runs in CI. The device checklist and a recorded Xcode test run are the gate.
- The feature is TestFlight-only until the M3 index lands, and it adds about 2.5 engineer-weeks, bringing the plan to about 31.

Sources: [766646](https://developer.apple.com/forums/thread/766646), [773373](https://developer.apple.com/forums/thread/773373), [785030](https://developer.apple.com/forums/thread/785030), [681520](https://developer.apple.com/forums/thread/681520), [820475](https://developer.apple.com/forums/thread/820475), [TN3192](https://developer.apple.com/documentation/technotes/tn3192-migrating-your-app-from-the-deprecated-uirequiresfullscreen-key), [coordinate(readingItemAt:)](https://developer.apple.com/documentation/foundation/nsfilecoordinator/1407416-coordinate), [File Coordinators guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileCoordinators/FileCoordinators.html).

I did not modify any tracked file. The code checked is in `/home/user/openshore.code.ai/app/plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/OscodeIcloudPlugin.swift`, `/home/user/openshore.code.ai/app/src/lib/gitos/` and `/home/user/openshore.code.ai/app/src/state/store.ts`. The other files are `/home/user/openshore.code.ai/app/src/screens/VaultScreen.tsx`, `/home/user/openshore.code.ai/app/ios/App/App/Info.plist`, `/home/user/openshore.code.ai/docs/vault-v1-plan.md`, and `/home/user/openshore.code.ai/node_modules/.pnpm/@capacitor+ios@8.5.0_@capacitor+core@8.5.0/node_modules/@capacitor/ios/Capacitor/Capacitor/CapacitorBridge.swift`.
