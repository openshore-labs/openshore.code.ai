# Vault v1 review: every verified finding (2026-09-26)

The appendix to `docs/design/vault-v1-plan.md`. Eight reviewers read the Vault code one dimension each, and a second agent per dimension tried to refute every finding against the code. None was refuted; 19 held only in part (the verifier note says which part), and the verifiers added 14 of their own. Several findings overlap across dimensions on purpose (the same defect seen from the data layer, the UI, and the claims audit), and the plan cites every id that a work item closes. Line numbers are as of commit `5208ce4`.

Fields: severity, kind, whether v1 needs it (must, should, later), rough size (S under a day, M one to three days, L about a week, XL more), and the verifier verdict.

## App data layer and the gitOS storage seam

The Vault data layer is well organized: one path- and bytes-shaped seam, five providers behind it, path jails on every side, and several careful fixes already in place (evicted-note guards, Drive root convergence, tombstoned index merge, offline draft stash). It still cannot be trusted with a real knowledge base. I proved 14 defects with a temporary test that I have since deleted. Several of them silently lose or overwrite notes. A stale offline draft replays over the newer save that just succeeded. Creating a note truncates one that exists but is missing from the cached list. The open editor overwrites edits made by the agent, Obsidian or another device, because the seam has no compare-and-swap. Google Drive's conflict copy protects exactly one save, and the team vault's list refresh quietly advances the base revision past the editor's text. The Obsidian-compatibility claim holds only for the desktop "This folder" provider (and iCloud opened from a Mac). The default "Local" provider is sealed key-value blobs: UserDefaults on iOS, localStorage on Electron. Desktop "Export as plain files" writes into IndexedDB and still reports success. Scale also falls short: backlinks re-resolve every link in the vault on every note open (measured 0.7 s at 1,000 notes and 5.6 s at 3,000 on a server CPU), and nothing in the data layer indexes the vault or offers a context API that a model can use. That context layer is the core of the founder's ask.

**What is solid:**

- Path jail on every side of the seam: normalizeNotePath drops '.' and '..' segments (app/src/lib/vault.ts:68-83), the iOS plugin re-confines paths natively (app/plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/OscodeIcloudPlugin.swift:51-59), Electron routes every path through a symlink-safe Jail (app/electron/main.ts:927-973), and export refuses escaping paths (app/src/lib/vaultExport.ts:18-23).
- Offline draft rescue works in the simple case: a failed provider write is stashed in the sealed store and replayed on the next successful write or list (app/src/state/store.ts:3014-3053, tested in app/test/vaultStore.test.ts:144-166).
- Evicted iCloud notes are never opened as empty editable notes: the plugin reports placeholders under their real names as evicted (OscodeIcloudPlugin.swift:84-101), and vaultOpen and vaultCreate refuse to fabricate a body over a listed note (app/src/state/store.ts:6016-6036, 6048-6056).
- The Google Drive provider has real hardening that is under test: a single-request multipart create (app/src/lib/gitos/gdrive.ts:237-256), root-folder convergence under concurrent first contact (gdrive.ts:43-46, 202-222), an index merge with tombstones (gdrive.ts:53-77), a duplicate-name guard (gdrive.ts:441-446), and delete that falls through a stale index (gdrive.ts:460-483). Tests are in app/test/gdrive.test.ts.
- The desktop 'This folder' provider is the one provider that truly matches Obsidian: plain .md files in ~/OSCode/Vault (or config vault.dir), dotfolders such as .obsidian skipped, shared with the agent's vaultRead, vaultList and vaultWrite (app/electron/main.ts:916-973, app/src/lib/gitos/deviceFolder.ts).
- iCloud reads and writes go through NSFileCoordinator with atomic writes and wait briefly for a placeholder to download (OscodeIcloudPlugin.swift:126-197).
- The team vault has the right shape for multi-writer: a base-rev compare on write with a server-side conflict copy that clients cannot bypass (app/src/lib/gitos/orgVault.ts:130-142, supabase/migrations/0010_org_vault.sql:63-118).
- Wikilink grammar covers [[target]], [[target|alias]], #heading, ^block and ![[embed]]. Backlink excerpts sit around the link that actually resolves, and editor autocomplete matches Obsidian's cancel rules (app/src/lib/vault.ts:19-48, 104-134).
- Pending edits are flushed on note switch, app background and unmount instead of being dropped (app/src/screens/VaultScreen.tsx:193-264).
- An in-session body cache keyed by updatedAt skips re-reading unchanged notes during backlink passes (app/src/state/store.ts:6154-6177).

### [data-1] A stale offline draft replays over the newer save that just succeeded

critical, data-loss, v1 must, size S, confirmed. `app/src/state/store.ts:6115`

**Evidence.** vaultSave writes first, then flushes the backlog, and the backlog still holds this same path's older text:
const saved = await target.provider.write(target.resourceId, path, text); // 6099
...
await replayVaultPending(target); // 6115, writes item.text for EVERY stashed key, including `${resourceId}::${path}`
Nothing drops the stash for `path` before the replay. Proven with a temporary test (now deleted): the save of 'old words typed offline' fails and is stashed; the next save of 'old words typed offline, then newer words' succeeds; storage then holds 'old words typed offline' while vaultError is undefined. The existing test (app/test/vaultStore.test.ts:144-156) re-saves the SAME text, so it cannot catch this.

**Impact.** One transient failure is enough: phone offline for a moment, a Drive token refresh, a full localStorage. The person keeps typing and then leaves the note. Leaving flushes the save, the replay puts the older text back, and the screen still says everything saved. Reopening the note shows the words from before the outage, and everything typed after reconnecting is gone.

**Proposed fix.** In store.ts vaultSave (and vaultCreate), delete the stash entry for `${resourceId}::${path}` before or at the successful write, then replay only other paths. In replayVaultPending, skip any entry older than the provider's current updatedAt for that path, or route replays through the compare-and-swap write proposed in data-2. Add a vaultStore test that stashes one text and then successfully saves a different one.

**Verifier.** store.ts:6099 writes the new text, then 6115 replayVaultPending (store.ts:3036-3053) writes every stashed item for the resource, including `${resourceId}::${path}`. Nothing drops that key on success. I reproduced it with a temporary test (now deleted): a failed save of 'old words typed offline', then a successful save of '..., then newer words', left storage at 'old words typed offline' with vaultError undefined. vaultStore.test.ts:144-156 re-saves the same text, so it cannot catch this.

### [data-2] Create and new-link taps truncate a note that exists but is missing from the cached list

high, data-loss, v1 must, size S, confirmed. `app/src/state/store.ts:6050`

**Evidence.** vaultCreate decides that a note is new by looking only at the in-memory list, then writes an empty body:
const existing = get().vaultFiles.find((f) => f.path.toLowerCase() === normalized.toLowerCase()); // 6050
const saved = await target.provider.write(target.resourceId, normalized, content); // 6062, content = ''
vaultFiles refreshes only on mount and on visibilitychange (VaultScreen.tsx:158-161, 234-238). A dashed [[link]] tap calls vaultCreate (VaultScreen.tsx:463-466). None of the providers checks for an existing file before writing (deviceFolder -> writeFileSync at main.ts:967; gdrive's not-cached branch does putContent over the live match at gdrive.ts:447-449; iCloud and local write blindly). Proven with a temporary test: storage holds 'Daily.md' = 'the agent wrote this', the list is stale, and vaultCreate('Daily') leaves ''. A second test proved it on the Drive fake: a note another device added, then write(r,'fromA.md','') empties it. vaultOpen has the same blind spot: iCloud's read() folds `downloading: true` into undefined (app/src/lib/gitos/icloud.ts:36-38), so an unlisted but syncing note opens as an empty fresh editor.

**Impact.** On desktop with 'This folder', the agent or a Crew routine writes a note (for example today's daily note). The person creates a note with the same name, or taps its link while it still looks unresolved, and the agent's note is wiped. The same happens on iCloud and Drive to a note that just arrived from another device.

**Proposed fix.** In store.ts vaultCreate, call provider.stat() (or read()) before writing and open the note if it exists. Make vaultOpen treat an iCloud `downloading` result as 'wait', never as 'new': add a `pending` flag to StoredFile or return a sentinel from icloud.ts. Longer term, give the seam a create-if-absent write (see data-3's CAS proposal) so no provider can overwrite on create.

**Verifier.** vaultCreate (store.ts:6050-6062) checks only the in-memory vaultFiles, then writes content ''. Reproduced: storage 'Daily.md'='the agent wrote this' with an empty list, and vaultCreate('Daily') left ''. On the Drive fake, write(r,'fromB.md','') on a file another device added (not in the index) emptied it through the putContent branch (gdrive.ts:447-449). One correction: vaultFiles also refreshes after every save, create and delete (store.ts:6064, 6107, 6143), so the stale window is narrower than 'mount and visibilitychange only'. On Drive the window lasts the whole session because of data-5. Also, Crew notes use timestamped names (scheduler.ts:590-591), so the 'daily note' collision example is unlikely for routines. It stays real for agent vaultWrite paths, Obsidian and other devices.

### [data-3] The seam has no compare-and-swap, so the open editor overwrites external edits

high, data-loss, v1 must, size L, confirmed. `app/src/lib/gitos/providers.ts:73`

**Evidence.** write(resourceId: string, path: string, text: string): Promise&lt;StoredFile>; takes no expected version. Local (local.ts:45-55), device folder (main.ts:962-969) and iCloud (OscodeIcloudPlugin.swift:181-190) overwrite unconditionally. The editor draft resets only when the note PATH changes (VaultScreen.tsx:179-191: setDraft(vaultNote.text) with deps [vaultNote?.path]). vaultRefresh reloads the list but never the open note (store.ts:5988-5993). The agent writes the same folder by design (os-code/src/core/tools/vault.ts:98-110, mode 'append'), and so do Crew routines.

**Impact.** The person has a note open in the desktop app. The agent appends findings to it, or they edit it in Obsidian, or another device syncs a change. Their next keystroke autosaves the stale draft and silently erases the other change. This is the main scenario the Vault is sold on ('you and your agent both write here').

**Proposed fix.** Change the seam in providers.ts to write(resourceId, path, text, opts?: { ifMatch?: string /* updatedAt or etag */, ifAbsent?: boolean }) that returns a conflict result instead of overwriting. Implement it with mtime and size checks in main.ts (Electron), NSFileVersion or modification-date checks in the Swift plugin, index updatedAt in local.ts, headRevision/modifiedTime in gdrive.ts, and p_base_rev in orgVault.ts. In store.ts, keep the base updatedAt on vaultNote, send it on every save, and on conflict surface a merge sheet (theirs, mine, both). On refresh or focus, re-stat the open note and live-reload it when it changed and the draft is clean.

**Verifier.** The seam's write takes no version (providers.ts:73). Local, device folder (main.ts:967) and iCloud (Swift 187-188) overwrite unconditionally. The draft resets only on a path change (VaultScreen.tsx:179-191). vaultRefresh reloads the list, never the open note (store.ts:5988-5993). deviceFolder.ts:9-11 knowingly accepts last-write-wins at the file level. What goes wrong here is worse than LWW: the stale draft that the next keystroke saves was based on text that has since changed. Nuance: agent vaultWrite is alwaysAsk (os-code/src/core/tools/vault.ts:83), so the agent case needs the user to approve a write while the note is open elsewhere. Obsidian edits, other devices, and the team vault (worse with data-6) are the realistic triggers. Size L for full CAS is fair. A reload-on-focus-when-clean stopgap is S/M.

### [data-4] Drive conflict copy protects one save, the next overwrites the other device's edit

high, data-loss, v1 must, size M, confirmed. `app/src/lib/gitos/gdrive.ts:430`

**Evidence.** After writing the conflict copy, the provider marks the base as seen:
handle.index.files[path] = { id: cached.id, updatedAt: live.updatedAt, size: live.size }; // 430
return { path: cpath, text, updatedAt: cmeta.updatedAt }; // 432
store.ts vaultSave ignores that saved.path differs from path (6099-6113), shows no notice, and the editor keeps saving to `path`. The next autosave sees equal timestamps and calls putContent over the other device's text. Proven with a temporary test on the gdrive fake: after a conflict, one more save leaves the base as 'my edit, more', and no non-trashed file anywhere still contains 'from other device'. The same test proved a second path: two overlapping autosaves from ONE device (the second fires while the first's post-PUT getMeta is in flight) create a self-conflict copy, and the base keeps the OLDER text 'typed 1' while the newest keystrokes live only in the copy. The shipped test (gdrive.test.ts:174-187) stops after the first conflicting save.

**Impact.** Two devices edit one note: the second device's words disappear from the tree one keystroke later, recoverable only from Drive revision history. Typing steadily on a slow connection litters the vault with '(conflict ...)' copies of the person's own note and can leave the real note behind its latest text.

**Proposed fix.** gdrive.ts: serialize writes per (resource, path) with a promise chain. Do not advance the base entry on conflict. Instead, return a typed conflict (see data-3) so store.ts stops autosaving, shows both versions and lets the person choose. Base conflict detection on Drive's headRevisionId or version, not modifiedTime equality. Surface isConflictCopy (vault.ts:167, unused in the UI today) as a badge in the tree.

**Verifier.** gdrive.ts:430 advances the base entry to the observed live version, and 432 returns the conflict path. store.ts vaultSave ignores saved.path. Reproduced: after the conflict, one more save left the base 'my edit, more', and no live file contained 'from other device'. I also reproduced the self-conflict by sweeping interleavings of two overlapping writes: for a window of stagger values the base kept 'typed 1' and the conflict copy held 'typed 2'. With Drive's 4-5 sequential requests per save against the 600 ms debounce, that overlap is realistic.

### [data-5] Drive provider never refreshes its in-memory index during a session

high, bug, v1 must, size M, partial. `app/src/lib/gitos/gdrive.ts:326`

**Evidence.** handleFor returns `handleCache.get(resourceId)` forever (325-333), and listFiles serves `Object.entries(handle.index.files)` from memory (382-387). The remote index.json is re-read only inside saveIndex (285-297), and only when this device writes. Proven with a temporary test: after a note is added to the Drive folder by another device, list() still returns only ['mine.md'].

**Impact.** On Drive, notes created or deleted on the phone never appear or disappear on the desktop (or the reverse) until the app restarts. vaultRefresh, pull-to-refresh and foregrounding all look like they work but show stale data. Together with data-2, the missing note looks unresolved, and tapping it empties the real one.

**Proposed fix.** gdrive.ts: on list(), re-read index.json when its modifiedTime or md5Checksum changed, or better, use the Drive changes API (changes.getStartPageToken and changes.list) to pick up incremental remote edits. Clear handleCache on disconnect and on account change. Add a two-handle test that simulates two devices by resetting the module cache.

**Verifier.** Confirmed: handleFor serves handleCache forever (gdrive.ts:325-333), listFiles reads handle.index from memory (382-387), and nothing clears handleCache (grep shows only get and set). Reproduced: a file added by another device did not show in list(). Overstated: 'until the app restarts' is wrong. saveIndex (285-297) merges the remote index.json on ANY write by this device, including tombstones, so remote adds and deletes show up after this device's next save. readFile also falls back to a live lookup (396-407). So the list goes stale in read-mostly sessions, and vaultRefresh and foregrounding never fix it. Still high, because a stale list plus data-2 truncates real notes.

### [data-6] Team vault list() and read() advance the base rev, defeating the conflict copy

high, data-loss, v1 must, size S, confirmed. `app/src/lib/gitos/orgVault.ts:102`

**Evidence.** list(): `for (const r of rows) baseRev.set(revKey(resourceId, r.path), r.rev);` (102). read() does the same (126). The store calls list() after EVERY save (store.ts:6107), on every foreground (VaultScreen.tsx:237) and inside vaultReadAll on every note open (store.ts:6157). Proven with a temporary test: A reads n.md at rev 1, B saves rev 2, A's list() runs, then A's write of its rev-1 text sends p_base_rev: 2. The server sees no conflict and makes no copy (0010_org_vault.sql:96 compares existing.rev to p_base_rev).

**Impact.** Two teammates edit the same team note. Whoever autosaves after any list refresh silently replaces the other's words with no conflict copy. The server rule 'a concurrent overwrite never silently loses a member's work' is bypassed from the client.

**Proposed fix.** orgVault.ts: keep the base rev per open editor session, not per list. Only read() for editing (or an explicit 'reload note') and the write's own returned row may set baseRev. list(), stat() and vaultReadAll must not touch it. Better still, move the base into the store's vaultNote as the data-3 ifMatch token and delete the module-level map.

**Verifier.** orgVault.ts:102 (list) and 114 (stat) and 126 (read) all overwrite baseRev with the server's current rev. Reproduced: read at rev 1, list sees rev 2, then write sent p_base_rev 2, so the server check in 0015_review_2026_09_05.sql (`existing.rev is distinct from p_base_rev`) finds no conflict. The realistic path: A has a team note open, leaves the app and comes back. visibilitychange runs vaultRefresh then list(), which advances the base while A's draft stays stale (data-3). A's next keystroke silently replaces B's words.

### [data-7] A failed save whose draft stash also fails loses text with no toast and no error state

medium, data-loss, v1 must, size S, confirmed. `app/src/state/store.ts:6120`

**Evidence.** catch {
await stashVaultDraft(target.resourceId, path, text); // 6120, can itself throw
set({ vaultError: 'save' });
get().showToast('Could not save to your vault...');
}
The stash throwing skips both the toast and the error state, and VaultScreen calls `void vaultSave(...)` (206, 220), so the rejection goes unhandled. Proven with a temporary test: with both provider write and storeSetJson failing, vaultSave rejects, toasts are [] and vaultError is undefined. This is reachable in practice because 'Local' on Electron and web is renderer localStorage (platform.ts:67-81), a quota of a few MB per origin shared with every chat transcript and setting, and values are base64url AES-GCM (crypto.ts:4-12), about 1.33x larger. A QuotaExceededError fails the note write and the stash write together. stashVaultDraft is also an unlocked read-modify-write of one key (3031-3035), so two concurrent failures can drop one rescued draft.

**Impact.** A desktop user with a large vault or a long chat history hits the storage quota. Every later edit looks saved and then disappears when they leave the note. The failure is silent.

**Proposed fix.** store.ts: wrap the stash in its own try, always set vaultError and toast, and keep the unsaved draft in memory with a persistent 'not saved' banner. Serialize stash writes through one promise chain. Stop storing vault bodies in localStorage on desktop: default to the 'files' provider there (see data-9). Add a quota check to vaultSave that surfaces 'storage full'.

**Verifier.** store.ts:6117-6126: when stashVaultDraft throws, the error state and the toast are skipped, and VaultScreen's `void vaultSave(...)` leaves the rejection unhandled. Reproduced: vaultSave rejected, toasts [] and vaultError undefined. Downgraded to medium because both writes must fail together. In practice that means localStorage quota exhaustion with the Local provider on Electron or web (platform.ts:67-81). A Drive or iCloud outage alone still stashes fine. The fix is trivial, so it stays a must.

### [data-8] Local provider's index read-modify-write races and orphans notes

medium, data-loss, v1 should, size S, confirmed. `app/src/lib/gitos/local.ts:48`

**Evidence.** write(): storeSetJson(fileKey) -> `const index = await readIndex(resourceId)` (48) -> storeSetJson(indexKey, {files}) (53), with no lock across the read and the write. platform.ts serializes WRITES per key (91-108) but not the read before them. Proven with a temporary test using an async store: Promise.all([write('a.md'), write('b.md')]) leaves list() with 1 entry while both bodies still read back. Concurrent writes do happen: a dashed-link tap runs `flushSave(); void vaultCreate(p)` (VaultScreen.tsx:465-466), and replayVaultPending loops writes after every save and refresh (store.ts:6115, 5993). remove() has the same pattern (57-63).

**Impact.** A note becomes invisible in the tree even though its bytes still exist, so it cannot be opened, searched, backlinked or exported. A later create of the same name (data-2) then overwrites the orphaned body.

**Proposed fix.** local.ts: serialize all index mutations per resource with a promise chain (the same helper as platform.ts `serialized`), or derive the index on read from a key prefix scan. Add a recovery pass that rebuilds the index from `oscode.gitos.file.<resourceId>.*` keys when a file key has no index entry.

**Verifier.** local.ts:45-55: the index read-modify-write has no lock. platform.ts serialized() orders writes per key, but the read before them is not in that chain (platform.ts:91-108). Reproduced with an async store: Promise.all of two writes left one index entry while both bodies read back. The real trigger is narrow, though: two concurrent Local writes, such as a flushSave with a pending edit racing a dashed-link vaultCreate. replayVaultPending runs writes sequentially. Lowered to should.

### [data-9] The default 'Local' provider is sealed key-value blobs, not files, so the compat and agent copy are false

high, claim-mismatch, v1 must, size M, confirmed. `app/src/screens/VaultScreen.tsx:857`

**Evidence.** What Local is on each platform: storeGetRaw uses Capacitor Preferences (UserDefaults plist) on iOS and window.localStorage everywhere else (platform.ts:67-81), and each value is sealed `enc:v1:...` (crypto.ts:4). vaultRefresh registers the personal vault as `providerId: 'local'` on every platform, desktop included (store.ts:5972-5979). Nothing ever defaults it to 'files'. The copy says otherwise: 'Point Obsidian at the same files and it just opens.' (857-858), 'Notes are .md files kept on this device' (754), 'You and your agent both write here... The agent saves what it learns and reads your notes back' (764-768), 'The agent follows the links to find what it needs' (778-779), and the welcome note repeats it (284-295). The agent reads only ~/OSCode/Vault (os-code/src/core/tools/vault.ts:16-20), and the app's chat drivers never read any vault (no 'vault' reference in app/src/drivers). Per provider: files (desktop) = true .md folder, Obsidian-compatible. iCloud = real files, openable by Obsidian on a Mac, but the plugin is iOS-only, and Obsidian on iOS very likely cannot open another app's container (verify on device). Drive = real folder, but only through Drive for desktop and only for files the app created. Local = not compatible, not visible to the agent.

**Impact.** Every new user starts on a vault that Obsidian cannot open and the agent cannot see, under copy that says both work. That breaks the project's honesty rule and the DECISIONS premise 'Vault ships as Vault BECAUSE compat is true'. On desktop, the app vault and the agent/Crew vault are two separate vaults.

**Proposed fix.** Make 'files' (~/OSCode/Vault) the default personal provider on Electron, migrating any Local notes on first run with vaultMoveTo. On iOS, keep Local but word its copy per provider (the onboarding and storage-sheet strings in VaultScreen.tsx read the active provider). Show 'the agent can read this vault' only when provider === 'files' or the vault is otherwise synced to the paired desktop. For iCloud on a Mac, offer to point config vault.dir at the iCloud container so the phone, the desktop app and the agent share one folder.

**Verifier.** vaultRefresh registers providerId 'local' on every platform (store.ts:5972-5979). Local is storeSetJson over Capacitor Preferences or localStorage (platform.ts:67-81), sealed. The copy claims otherwise: VaultScreen.tsx:857-858 ('Point Obsidian at the same files and it just opens'), 732-733, 754, 764-768, 778-779, and the welcome note at 284-295. The agent reads only ctx.vaultRoot (~/OSCode/Vault, registry.ts:145), and app drivers have no vault reference. DECISIONS.md:106-116 premised the name 'Vault' on compat being true, with export as the escape hatch, and data-10 shows that escape hatch is broken on desktop. So new users land on a vault Obsidian cannot open and the agent cannot see, under copy that says both work.

### [data-10] 'Export as plain files' fakes success on desktop and wipes the previous export on iOS

high, claim-mismatch, v1 must, size S, confirmed. `app/src/lib/vaultExport.ts:34`

**Evidence.** `if (platform() === 'web') return undefined;` lets Electron through. On Electron the renderer is not a Capacitor native platform, so @capacitor/filesystem uses its web implementation, which is IndexedDB ('Disc', node_modules/@capacitor/filesystem/dist/esm/web.js:23-27, 90-94). VaultScreen then toasts `${count} notes exported to Files, under OpenShore / Vault. Obsidian opens that folder as a vault.` (VaultScreen.tsx:960). On iOS the export first runs `Filesystem.rmdir({ path: 'Vault', recursive: true })` (35-43), so anything written into that folder since the last export (by Obsidian or by hand, as the toast invites) is deleted. The export list comes from vaultReadAll, which silently omits unreadable or evicted notes (store.ts:6170-6174), and it is awaited OUTSIDE the try (VaultScreen.tsx:950), so one failed read makes the button a silent no-op.

**Impact.** A desktop user is told their notes are safely out as files when nothing reached disk. An iPhone user who opened the export in another editor loses those edits on the next export. The 'escape hatch' the CTO required is not dependable.

**Proposed fix.** vaultExport.ts: return undefined (or use the Electron bridge to write real files) when platform() !== 'ios'. On iOS, export into a fresh timestamped folder or sync by diff instead of rmdir. Report 'exported N of M, K still downloading'. VaultScreen.tsx: move vaultReadAll inside the try. Verify on a device whether Obsidian iOS can open 'On My iPhone/OpenShore/Vault' before promising it in copy.

**Verifier.** vaultExport.ts:34 lets 'electron' through. Electron has no Capacitor shim (no 'Capacitor' in app/electron), so registerPlugin falls back to FilesystemWeb, and its DB_NAME is 'Disc', which is IndexedDB. The export returns a count, and VaultScreen.tsx:960 toasts that the notes were exported to Files. On iOS, rmdir recursive at 35-43 wipes the folder, including any .obsidian/ config that Obsidian writes into a folder it opens as a vault. vaultReadAll is awaited outside the try (VaultScreen.tsx:950) and silently skips unreadable notes (store.ts:6171).

### [data-11] Every note open and every autosave does whole-vault work that scales quadratically

high, perf, v1 must, size L, confirmed. `app/src/lib/vault.ts:118`

**Evidence.** backlinksTo resolves EVERY link in EVERY note against the full path list (resolveWikilink does paths.find plus paths.filter with split and toLowerCase per link, 89-101), inside `for (const note of notes) for (const m of note.text.matchAll(WIKILINK))` (112-124). It runs on every note open (VaultScreen.tsx:179-186). Measured with a temporary benchmark on this server CPU, 5 links per note: 1,000 notes = 691 ms, 3,000 notes = 5,641 ms. That extrapolates to about 60 s at 10,000 notes, on the main JS thread, and slower on a phone. vaultReadAll (store.ts:6154-6177) lists and then reads serially. The cache lives in memory only, so every launch starts cold with N serial provider reads (the team vault = N sequential PostgREST requests). vaultSave re-lists the whole vault after every 600 ms autosave (store.ts:6107): the team vault fetches every row, iCloud enumerates the container, and 'files' runs readdirSync and statSync over the whole tree on the Electron MAIN process (main.ts:933-955). vaultMoveTo calls target.stat() per note (store.ts:6238), and stat re-lists the whole vault on iCloud (icloud.ts:30-32) and on files (deviceFolder.ts:42-44), which is O(N^2). On iCloud each uncached read calls startDownloadingUbiquitousItem and can Thread.sleep up to 3 s on the SAME serial queue that saves use (OscodeIcloudPlugin.swift:28, 139-143), so one note open queues a download of the whole vault ahead of the person's next save.

**Impact.** A real Obsidian-sized vault (1,000 to 10,000 notes) makes opening any note take seconds to a minute, janks typing, freezes the desktop window during saves, and on iCloud can leave a background flush stuck behind download waits until iOS suspends the app.

**Proposed fix.** Build the VaultIndex from data-18: a persisted, incremental map of path to {title, links, resolvedLinks, tags, headings, aliases, updatedAt, size}, plus a reverse-link map, updated per save and per changed file. backlinksTo then becomes an O(1) lookup. Stop re-listing after each save: patch vaultFiles locally from the write result. Add a batched list-with-bodies or a changes feed to the seam. Move the Electron walk to async fs with a watcher-maintained cache. Make stat() O(1) per provider. Never force-download evicted iCloud notes for backlinks: use the index, and download on open only.

**Verifier.** Measured again: backlinksTo took 867 ms at 1,000 notes and 6,270 ms at 3,000 (5 links each) on this CPU, matching the reviewer's numbers. The O(N^2) move comes from per-note stat, which re-lists on iCloud (icloud.ts:31) and on files (deviceFolder.ts:43). The iCloud serial queue plus Thread.sleep claim holds (Swift 28, 139-143). One correction to the title: an autosave does a full linear re-list (store.ts:6107), not quadratic work. Backlinks run only on note open (effect keyed on the path). A precomputed lowercase path and basename map inside backlinksTo is an S fix that removes the quadratic term before any VaultIndex exists.

### [data-12] vaultOpen re-normalizes listed paths, so agent notes with ?, :, # or " open as empty new notes

medium, bug, v1 must, size S, confirmed. `app/src/state/store.ts:6004`

**Evidence.** `const normalized = normalizeNotePath(path);` runs BEFORE the list lookup, and normalizeNotePath strips `<>:"|?*#^[]` (vault.ts:78). The engine's own normalizer, whose comment claims it matches 'the same shape the app uses', strips none of these and skips NFC (os-code/src/core/tools/vault.ts:23-34). Proven with a temporary test: vaultFiles holds 'Q&A: auth?.md' with a body, and vaultOpen('Q&A: auth?.md') produces vaultNote {path: 'Q&A auth.md', text: ''}.

**Impact.** On desktop 'This folder', a note the agent saved under a natural title ('Decision: auth?') shows in the tree, but tapping it opens a blank editor. Typing there creates a sibling note, and the agent's note can never be read or edited in the app.

**Proposed fix.** store.ts vaultOpen and vaultCreate: when `path` exactly matches a listed path, use it verbatim and normalize only user-typed names. Move one shared normalizeNotePath (NFC, forbidden characters, dot segments) into os-code/protocol and use it in both os-code/src/core/tools/vault.ts and app/src/lib/vault.ts, so the agent cannot write a name the app cannot address.

**Verifier.** store.ts:6004 normalizes before the list lookup, and vault.ts:78 strips <>:"|?*#^[]. The engine's normalizer (os-code/src/core/tools/vault.ts:24-34) strips none of them. Reproduced: vaultOpen('Q&A: auth?.md') with that path listed produced {path:'Q&A auth.md', text:''}. VaultMarkdown passes the resolved listed path to openNote (VaultScreen.tsx:467), which normalizes it again, so resolved wikilinks to such notes break the same way.

### [data-13] Wikilink resolution diverges from Obsidian in ways that link the wrong note

medium, bug, v1 should, size M, confirmed. `app/src/lib/vault.ts:97`

**Evidence.** resolveWikilink falls back to the BASENAME and ignores the folder the link named: `const base = lower.split('/').pop()!` (97), shortest match wins (98-101). Proven: resolveWikilink('Alpha/Note', ['Archive/Note.md','Projects/Alpha/Note.md']) returns 'Archive/Note.md'. Obsidian resolves by path suffix to Projects/Alpha/Note.md. NFC is applied only to the link side (normalizeNotePath, 72) and never to listed paths. Proven: resolveWikilink('Café', ['Café.md']) is undefined, so the link shows unresolved and tapping it runs vaultCreate, which on APFS (normalization-insensitive) overwrites the NFD file. Also: no source note is passed in, so relative links cannot resolve. Links inside ``` code are rewritten and credited as backlinks (proven: wikilinksToMarkdown turns code content into a vault: link, and backlinksTo credits it). Frontmatter `aliases:` are ignored. Standard markdown note links [x](Note.md) open as external _blank links (VaultMarkdown.tsx:52-56). Autocomplete inserts the bare title even when two notes share it (VaultScreen.tsx:439).

**Impact.** In a vault imported from Obsidian (folders with repeated names like 'Index' or 'README', accented names, notes with aliases or markdown-style links), links open the wrong note or look broken, and tapping a 'broken' one can clobber a real file.

**Proposed fix.** vault.ts: resolveWikilink(target, paths, sourcePath) should try, in order: exact path, then source-relative, then a unique path-suffix match on '/'+target, then basename, preferring the same folder and then the shortest path. NFC-normalize both sides (normalize the listed paths once in the index). Skip fenced and inline code with a remark AST pass instead of regex. Resolve frontmatter aliases through the VaultIndex. Handle relative .md hrefs in VaultMarkdown as vault links. Have autocomplete insert the shortest unambiguous path.

**Verifier.** Reproduced: resolveWikilink('Alpha/Note', ['Archive/Note.md','Projects/Alpha/Note.md']) returned 'Archive/Note.md', and an NFC link against an NFD listed path returned undefined. vault.ts:72 applies NFC only on the link side. The WIKILINK regex runs over code fences. No 'aliases' or frontmatter handling exists (grep empty). VaultMarkdown.tsx:52-56 opens non-vault hrefs as _blank, and VaultScreen.tsx:439 inserts the bare title. These are real divergences from Obsidian, but mostly edge cases for a fresh vault, so they belong to v1 hardening as a should, not a blocker. The exception is the NFD-to-create path, which can truncate on APFS.

### [data-14] vaultMoveTo silently drops notes it cannot read, then repoints the vault

medium, data-loss, v1 must, size S, confirmed. `app/src/state/store.ts:6231`

**Evidence.** for (const f of files) { const note = await source.read(VAULT_RESOURCE_ID, f.path); if (note) notes.push(...) } // 6229-6232, an undefined read is skipped
... then saveSettings({ gitosResources: resources }) // 6255, the vault now points at the target
Proven with a temporary test: source holds a.md and an unreadable evicted.md, vaultMoveTo('files') returns true, the target holds only a.md, and the resource is repointed. The move copies text only (StoredFile.text), shows no progress, and calls the O(N^2) stat noted in data-11.

**Impact.** Moving an iCloud vault with evicted notes (or with any read hiccup) to another provider reports success while those notes vanish from the person's vault. They still exist in the old provider, but no UI reaches them.

**Proposed fix.** store.ts vaultMoveTo: collect unreadable paths. If any exist, abort (or retry after materializing) and report 'N notes are still downloading'. Verify that the target's count and sizes match before repointing. Return a structured result {moved, skipped} to the storage sheet and show progress for large vaults.

**Verifier.** store.ts:6229-6232 skips any undefined read, then 6252-6255 repoints the vault. Reproduced: with evicted.md unreadable, vaultMoveTo('files') returned true and the target held only a.md. On iCloud, read() waits up to 3 s and then reports found:false, which icloud.ts:36-38 maps to undefined, so evicted notes are exactly the ones dropped. store.test.ts:638-649 covers only the refusal case.

### [data-15] iCloud lists every file (.obsidian, images, JSON) and ignores iCloud conflict versions

medium, bug, v1 should, size M, confirmed. `app/plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/OscodeIcloudPlugin.swift:78`

**Evidence.** `fm.enumerator(at: root, includingPropertiesForKeys: keys)` runs with no .skipsHiddenFiles and no extension filter (78-107). The JS side filters only `.oscode/lease.json` (icloud.ts:27). The desktop folder provider, by contrast, skips dotfiles and non-.md files (main.ts:939-942). So once Obsidian on a Mac opens the folder, `.obsidian/app.json` and `.obsidian/workspace.json` show in the tree as notes (noteTitle strips only .md, vault.ts:52-55). Tapping one runs normalizeNotePath, which appends '.md', and opens an EMPTY 'app.json.md' (store.ts:6004-6039). Images get pulled by vaultReadAll. Separately, no code reads NSFileVersion.unresolvedConflictVersionsOfItem, and remove() ignores both coordError and the removeItem failure (213-219: `try? FileManager.default.removeItem`, then always `call.resolve()`).

**Impact.** An iCloud vault shared with Obsidian shows junk config files that open as blank notes. When two iPhones or iPads edit the same note offline, iCloud keeps one version and hides the other as a conflict version that the app never surfaces, so from the person's view it is lost. A failed delete reports success, and the note comes back on the next refresh.

**Proposed fix.** Swift list(): skip hidden paths (keep the .icloud placeholder handling) and return a `kind` per file ('note' for .md, 'attachment' otherwise) so the JS side can filter and show attachments deliberately. After each coordinated read, check NSFileVersion.unresolvedConflictVersionsOfItem and return the conflicting versions so the store can offer a merge (then mark them resolved). remove(): reject when coordination or removal fails.

**Verifier.** Swift list (78-107) enumerates with no options, so hidden folders and non-.md files are included. icloud.ts:27 filters only .oscode/lease.json, while main.ts:939-942 skips dotfiles and non-.md files. A listed '.obsidian/app.json' goes through normalizeNotePath and becomes '.obsidian/app.json.md' (dot-prefixed segments survive, vault.ts:79), which opens empty. No NSFileVersion usage exists anywhere. remove() uses try? and always resolves (Swift 213-219).

### [data-16] One failed read rejects the whole vaultReadAll: backlinks silently empty, export silently no-ops

medium, bug, v1 must, size S, confirmed. `app/src/state/store.ts:6170`

**Evidence.** `const note = await target.provider.read(target.resourceId, f.path);` runs inside the loop with no try (6163-6175). Callers: `void vaultReadAll().then(...)` has no catch (VaultScreen.tsx:184-186), and the export handler awaits it before its try (VaultScreen.tsx:950). Drive readTextFile throws on any non-2xx (gdrive.ts:98-104), for example a file deleted from the Drive web UI but still in the index. iCloud read rejects on an invalid path.

**Impact.** In a vault with one bad file, Linked mentions quietly show nothing on every note, and 'Export as plain files' does nothing with no message. Both look like missing features rather than errors.

**Proposed fix.** store.ts vaultReadAll: try/catch per file, and return {notes, failed: string[]}. Show 'N notes could not be read' in the Linked mentions card and in the export toast. Move the export's vaultReadAll inside its try.

**Verifier.** store.ts:6157 (list) and 6170 (read) have no per-file try. VaultScreen.tsx:184-186 has no catch, and 950 sits outside the try. One correction: on a rejection, Linked mentions do not 'show nothing'. The effect never resets `backlinks` (VaultScreen.tsx:179-191), so the PREVIOUS note's mentions stay on screen under the new note (nothing only on the first open).

### [data-17] The seam has no rename or move, no trash, and no attachments or binary files

medium, gap, v1 must, size L, confirmed. `app/src/lib/gitos/providers.ts:70`

**Evidence.** The StorageProvider surface is list, stat, read, write, remove and the lease calls (70-78). There is no rename or move, and StoredFile carries only `text` (28-33). Deletes are permanent on Local (storeDelete, local.ts:58), on files (`rmSync(abs)`, main.ts:972) and on iCloud (removeItem, Swift 216). Only Drive trashes. The UI admits it: 'a local or iCloud delete is unrecoverable' (VaultScreen.tsx:509). Embeds render as 'embed not supported yet' (vault.ts:147-150). A link to [[diagram.png]] normalizes to 'diagram.png.md' and a tap creates a note of that name. VaultScreen has no rename action at all.

**Impact.** Basic Obsidian moves are missing: renaming a note (and having every [[link]] to it update), dragging it to a folder, undoing a delete, pasting an image, and opening a PDF or image kept in the vault. The Vault cannot yet hold an Obsidian user's real vault.

**Proposed fix.** Add rename(resourceId, from, to) and writeBytes/readBytes (Uint8Array or base64) to providers.ts, implemented natively where possible: fs.rename in main.ts, FileManager.moveItem under coordination in Swift, a Drive PATCH of name and parents, a key move plus index update in local.ts, and a new org_vault_rename RPC. On rename, rewrite links through the VaultIndex. Add a soft delete to a `.trash/` folder (Obsidian's own 'Move to Obsidian trash' convention) with Undo in the toast. Render image and PDF embeds through a vault asset URL.

**Verifier.** The StorageProvider surface is list, stat, read, write, remove and the leases (providers.ts:70-78), and StoredFile has only text. There is no rename anywhere in VaultScreen: the options sheet has only Delete and Cancel (504-535). Deletes are hard on local (storeDelete), files (rmSync) and iCloud (removeItem). Embeds become a 'not supported yet' chip (vault.ts:147-150), and [[diagram.png]] normalizes to 'diagram.png.md'. On priority, rename with link rewrite is a v1 must. Soft-delete trash and attachments or binary files are closer to should.

### [data-18] No persisted vault index or context API: nothing in the data layer can feed a model

high, gap, v1 must, size XL, confirmed. `app/src/state/store.ts:6154`

**Evidence.** The only bulk accessor is vaultReadAll, which returns raw bodies (6154-6177). There is no index of titles, links, tags, headings, frontmatter, token sizes or embeddings. searchNotes exists (vault.ts:184-210) but has no caller in app/src. Nothing in app/src/drivers references the vault, so app-side chats (the stack driver, cloud and on-device models) never see the person's notes. The agent reaches only ~/OSCode/Vault through vaultRead, vaultList and vaultWrite by path (os-code/src/core/tools/vault.ts), with no search, backlinks or retrieval.

**Impact.** This is the center of the founder's ask ('a key feature to seamlessly move between models and optimize context'). Switching models today carries no vault knowledge across, no model gets vault context automatically, and a small local seat cannot retrieve by relevance. That conflicts with harness tenet 3 (retrieval first, so a small model does not have to remember).

**Proposed fix.** Create a pure, Node-free VaultIndex in os-code/src/harness (exported through os-code/protocol so the phone and the engine share it). It maintains per note {path, title, aliases, tags, headings, links, resolvedLinks, frontmatter, updatedAt, size, tokenEstimate} incrementally from saves and change feeds, is persisted per resource (sealed on device, and a `.oscode/index.json` for file providers), and exposes search(query), backlinks(path), neighbors(path, depth) and contextFor(query, tokenBudget) returning ranked snippets with citations. Wire contextFor into StackDriver and the engine as a Wayfinding 'memory' row (a card in the transcript, per tenet 1, never a new room), measured with osc eval before any copy claims it helps (tenet 2). Put vaultSearch and vaultBacklinks tools on the agent.

**Verifier.** searchNotes has no caller outside vault.ts. app/src/drivers has zero vault references. The engine's vault tools are read, list and write by path only (registry.ts:86-88), with no search, backlinks or retrieval. The only automatic context is project memory, which lives in the REPO ('OpenShore Project &lt;name> MDs', projectMemory.ts:7-9) and is injected by loop.ts:510-515, not the Vault. The founder's 'optimize context across models' ask has no vault-side implementation. XL for the full index is fair. A minimal v1 is a keyword and link index plus vaultSearch and contextFor, measured with osc eval.

### [data-19] The single-writer lease follows the screen, not the editing, and is not enforced

medium, ux, v1 should, size M, confirmed. `app/src/screens/VaultScreen.tsx:166`

**Evidence.** The lease is taken on mount, renewed every 40 s for as long as the screen is mounted, and released only on unmount or scope change (166-174), with no idle timeout. Drive honors another holder (gdrive.ts:485-495), so a desktop left open on the Vault screen keeps the phone read-only indefinitely ('Read-only here until it closes there', 398-402). The iCloud and Drive leases are a non-atomic read-then-write (icloud.ts:50-66, gdrive.ts:485-495), and iCloud sync latency often exceeds the heartbeat, so two devices can both 'win'. vaultSave never checks vaultLeaseHeldByOther (store.ts:6095-6127), so a flush after the lease flips still writes. Drive release trashes lease.json and the next acquire creates a fresh file (gdrive.ts:497-504, 374-378), leaving a trashed lease.json in the person's Drive for every visit. The iCloud heartbeat writes a synced file every 40 s.

**Impact.** A person who leaves the Vault open on their Mac cannot edit notes on their phone, with no way to take over. Meanwhile the lease still does not prevent the concurrent writes it exists to prevent. The 'so your edits do not collide' copy overpromises.

**Proposed fix.** Take the lease only while an editor is open and dirty, with an idle expiry (for example 2 minutes without keystrokes). Add a 'Take over editing' action. Enforce the lease in store.ts vaultSave for personal cloud providers. Rewrite the Drive lease in place instead of trash-and-create. Once data-3's CAS lands, reduce the lease to an advisory 'also open on X' hint, since CAS gives the real guarantee.

**Verifier.** VaultScreen.tsx:166-174 leases on mount with a 40 s heartbeat and no idle expiry. Drive honors a foreign holder (gdrive.ts:489-491). vaultSave never consults vaultLeaseHeldByOther (store.ts:6095-6127). Drive release trashes lease.json (497-504), and the next acquire creates a new one (374-378). Both iCloud and Drive acquire as a read-then-write. The contest applies only to Drive and iCloud, since local, files and org grant trivially.

### [data-20] Desktop folder writes are not atomic, and nothing watches the folder for agent or Obsidian changes

low, bug, v1 should, size S, confirmed. `app/electron/main.ts:967`

**Evidence.** `writeFileSync(abs, text);` (967) truncates and then writes in place. The seam promises 'Writes are atomic per path: a reader sees the old body or the new one, never a torn write' (providers.ts:58-59), and Obsidian, the agent's vaultRead and the Crew scheduler all read this folder. There is no fs.watch or chokidar anywhere on the vault, so the tree picks up agent or Obsidian changes only on a visibilitychange (VaultScreen.tsx:234-238). The list walk is synchronous on the Electron main process (933-955).

**Impact.** A torn read can briefly show Obsidian or the agent a truncated note; Obsidian may even save that truncated copy back. Notes the agent writes while the app is focused do not appear until the person switches windows.

**Proposed fix.** main.ts: write to a temp file in the same directory, then renameSync over the target (and do the same in os-code/src/core/tools/vault.ts). Add a debounced fs.watch (recursive on macOS and Windows, chokidar on Linux) that pushes change events over the bridge, so the store can update vaultFiles and live-reload the open note (together with data-3). Move the walk to fs.promises.

**Verifier.** main.ts:967 writeFileSync writes in place, although providers.ts:58-59 promises atomic writes. The agent's own tool does the same (vault.ts:107), and so does the routine note (scheduler.ts:612). There is no fs.watch or chokidar anywhere under app/electron or gitos. The list walk is synchronous in the main process (933-955).

### [data-21] Nothing is configurable, and the data layer does not read Obsidian's own settings

medium, gap, v1 should, size M, confirmed. `app/src/state/store.ts:552`

**Evidence.** `const VAULT_RESOURCE_ID = 'vault.personal';` (552, duplicated in VaultScreen.tsx:34) hard-codes one personal vault, and the device-folder provider ignores resourceId (deviceFolder.ts:8-10). There are no settings for the new-note location, the attachment folder, link format (shortest, relative or absolute; wikilinks or markdown), excluded folders, daily notes (folder and date format), or a templates folder. New notes always go to the vault root or the current folder (VaultScreen.tsx:267). `.obsidian/app.json` (newFileLocation, attachmentFolderPath, useMarkdownLinks, userIgnoreFilters) is never read.

**Impact.** The ask is 'amazing out of the box but also fully customizable'. An Obsidian user who points OpenShore at an existing vault gets none of their conventions (daily notes land in the wrong place, links come out in the wrong format), and no one can run more than one vault (for example Personal and Work).

**Proposed fix.** Add a VaultConfig per gitOS resource (settings.gitosResources[].vaultConfig) that defaults from `.obsidian/app.json` and `.obsidian/daily-notes.json` when present and otherwise to Obsidian's defaults. Let normalize, create and link-insert honor it. Allow multiple vault resources, with a vault switcher in the existing Vault room, not a new room.

**Verifier.** VAULT_RESOURCE_ID is hard-coded in store.ts:552 and VaultScreen.tsx:34. deviceFolder ignores resourceId by design (8-10). A grep for .obsidian, daily-notes, attachmentFolder and templates finds nothing in app/src or os-code/src. VaultSchema holds only `dir` (os-code/src/config/schema.ts:213-220). The customization gap against the 'fully customizable' ask is real.

### [data-22] Tests stop one step short of the real failures, and the Local and iCloud providers have no unit tests

medium, test-gap, v1 must, size M, confirmed. `app/test/vaultStore.test.ts:144`

**Evidence.** The stash test re-saves the SAME text (144-156), so the stale-replay bug (data-1) passes. The Drive conflict test ends after the first conflicting save (gdrive.test.ts:174-187), so data-4 passes. vaultMoveTo is tested only for refusal (store.test.ts:638-649). `grep localProvider|icloudProvider app/test` finds nothing: local.ts (index race, data-8) and icloud.ts have no direct tests. No test runs vaultCreate against a stale list, runs backlinks at scale, or resolves a folder-qualified or NFD link. In total, 14 of the defects above were proven with one temporary test file that was deleted afterwards.

**Impact.** The suite is green while the vault can lose writes. Any v1 hardening needs regression guards, or these regressions will come back unnoticed.

**Proposed fix.** Promote the review's temporary cases into permanent tests: stale-stash replay (vaultStore.test.ts), create over an unlisted existing note, local index concurrency (new test/localProvider.test.ts), the Drive conflict-then-save and overlapping saves plus the stale handle (gdrive.test.ts), org base rev after list (orgVault.test.ts), folder-qualified, NFD and code-fence resolution (vault.test.ts), vaultMoveTo with an unreadable note, and a backlinks budget test (for example 5,000 notes under 100 ms once VaultIndex lands).

**Verifier.** vaultStore.test.ts:144-156 re-saves the same text. gdrive.test.ts:174-187 stops after the first conflicting save. The only vaultMoveTo test is the refusal case (store.test.ts:638-649). No test in app/test imports localProvider or icloudProvider. My temporary test file reproduced data-1, 2, 4, 5, 6, 7, 8, 12, 13 and 14 against the current code while the shipped suite stays green.

### [data-m1] Wayfinding 'Memory' switch is a dead setting, and its copy puts project notes in the vault when they live in the repo

medium, claim-mismatch, v1 must, verifier-found. `app/src/lib/currents.ts:40`

**Evidence.** WAYFINDING.memory.sub = 'The agent keeps project notes in your vault and reads them back into every session there.' (currents.ts:40-42). wayfindingOn() has exactly one caller, SettingsScreen.tsx:989, which renders the checkbox. Nothing in app/src/drivers, app/electron or os-code/src reads settings.wayfinding (grep empty). Project memory lives in the repo: os-code/src/core/agent/projectMemory.ts:7-9 says 'The notes live INSIDE the project's primary repo, in a folder named "OpenShore Project &lt;name> MDs/"', and loop.ts:510-515 injects it unconditionally.

**Impact.** The one Settings control that looks like it governs 'memory across sessions' does nothing, and it describes the Vault as the memory store when it is not. That breaks the honesty rule, and it will mislead the v1 plan for 'move between models with context', because it implies a vault-backed memory path already exists.

**Proposed fix.** Either wire wayfinding.memory through BootstrapOptions to gate the projectMemory segment (and later the VaultIndex contextFor row from data-18), or remove the switch until it does something. Reword the sub-line to say where the notes actually live.

### [data-m2] Linked mentions show the previous note's backlinks until the scan finishes (or forever on error)

low, bug, v1 should, verifier-found. `app/src/screens/VaultScreen.tsx:184`

**Evidence.** The effect keyed on vaultNote?.path calls setDraft and setEditing, then `void vaultReadAll().then((notes) => { if (live) setBacklinks(backlinksTo(vaultNote.path, notes)); })` (179-191). It never calls setBacklinks([]) first, and it has no catch.

**Impact.** Opening note B shows note A's Linked mentions under B for the whole scan, which data-11 measured at seconds on a 1,000+ note vault. If vaultReadAll rejects (data-16), the wrong mentions stay on screen indefinitely. Tapping one navigates to a note that does not link here.

**Proposed fix.** Call setBacklinks([]) (or a loading state) at the start of the effect, and add a .catch that sets an error state for the card.

### [data-m3] Google Drive handle cache survives disconnect and account switch

low, bug, v1 should, verifier-found. `app/src/lib/gitos/gdrive.ts:42`

**Evidence.** `const handleCache = new Map<string, ResourceHandle>()` is only ever get and set (gdrive.ts:326, 356), and nothing exports a way to clear it. disconnectGdrive (gdriveAuth.ts:303-323) revokes and deletes tokens only. listFiles serves handle.index.files from memory (382-387).

**Impact.** Within one app session, after a disconnect and a connect to a different Google account (or a sign-out and sign-in under R-19), Drive operations reuse the previous account's folder ids. list() can show the old account's note paths from memory, and reads, writes and vaultMoveTo fail against ids the new drive.file grant cannot see.

**Proposed fix.** Export a resetGdriveHandles() from gdrive.ts, call it from disconnectGdrive and on account change, and add a test.

## Vault screen, editor, and rendering

The Vault room covers the basics and is safe to render. You can browse folders, create a note, edit it in a plain textarea with debounced autosave (it flushes on back, note switch, background and unmount), and read it through react-markdown+GFM with working [[wikilinks]], dashed create-on-tap links, Linked mentions and a good onboarding ramp. Raw HTML and javascript: links are neutralized. Measured against "amazing out of the box, Obsidian as the baseline", it is well short. There is no search UI (searchNotes is built and tested but never wired), no rename, move, folder operations or trash. The renderer mangles Obsidian's own syntax: frontmatter renders as a big H2, [[ ]] inside code blocks gets rewritten into links, and callouts, tags, embeds and images are unsupported. Three save paths lose data silently, each confirmed with a scratch test: a stale open note overwrites newer edits from elsewhere, a Drive conflict copy is undone by the next autosave, and an offline stash replay clobbers a newer save. Most important for the ask: out of the box the room shows a sealed on-device store, not the ~/OSCode/Vault the agent and routines write, and nothing links a note to any model, so today it cannot carry context between models even though its copy says it does. Suggested v1 order: data-safety fixes first, then one real shared vault plus a note-to-chat bridge, then Obsidian-grade rendering and file operations (search, rename/move, trash), then editor polish and settings.

**What is solid:**

- Autosave that never drops the last keystrokes: a debounced save that flushes on back, on switching notes, when the app is backgrounded and on unmount, and is cancelled before a delete (app/src/screens/VaultScreen.tsx:193-264, 356-360, 514-520).
- Offline safety net: a failed write stashes the text durably and replays it later, and a failed list keeps the last-known tree and shows an in-flow offline card, not the first-run ramp (app/src/state/store.ts:5988-6000, 6117-6126; guarded by app/test/vaultStore.test.ts).
- An iCloud placeholder (evicted file) is never opened as an empty editable note, and a create never overwrites an existing same-name note (app/src/state/store.ts:6016-6036, 6048-6056).
- Obsidian-style wikilink grammar and resolution: [[target|alias]], #heading and ^block suffixes are tolerated, an exact path wins, then the shortest-path basename, all case-insensitive (app/src/lib/vault.ts:19, 89-102).
- Path jail on every entry point: NFC normalization, dot-dot and forbidden characters stripped (app/src/lib/vault.ts:68-83), plus a symlink-safe Jail in the Electron file bridge (app/electron/main.ts:927-972).
- Renderer is XSS-safe: no rehype-raw, so script and img tags are escaped; javascript: hrefs are emptied by defaultUrlTransform, with only vault: allowed through (app/src/components/VaultMarkdown.tsx:15-16). Verified by rendering; Electron sends external links to the system browser (app/electron/main.ts:614-633).
- Backlinks are credited to the link that actually resolves to the note, and a body cache keyed on updatedAt avoids re-reading unchanged notes within a session (app/src/lib/vault.ts:106-134; app/src/state/store.ts:6154-6177).
- Presence-aware sheets (Sheet.tsx) for new note, options, storage and the current's note, plus a two-tap delete confirm (app/src/screens/VaultScreen.tsx:488-538, 811-972).
- New-user onboarding ramp: an in-flow cover, a seeded welcome note that opens in read mode, and three how-it-works cards on the stagger tokens with reduced motion honored (app/src/screens/VaultScreen.tsx:720-784; app/src/theme.css:9821-9921).
- Team scope switch with honest empty and offline states, and a fallback to personal when team access disappears (app/src/screens/VaultScreen.tsx:123-127, 561-585, 701-719).
- Moving storage copies every note before switching providers and writes a named copy instead of overwriting a newer target (app/src/state/store.ts:6213-6259).

### [ui-1] The open note is never re-read, so a stale draft overwrites newer edits from the agent, Obsidian or another device

high, data-loss, v1 must, size M, confirmed. `app/src/screens/VaultScreen.tsx:179`

**Evidence.** The draft is loaded only when the path changes: `useEffect(() => { if (!vaultNote) return; setDraft(vaultNote.text); ... }, [vaultNote?.path]);` (179-191). On foreground the screen calls `else void vaultRefresh();` with the comment "refresh so edits synced from another device (or the desktop agent) show up without a manual reopen" (232-237). But vaultRefresh only runs `set({ vaultFiles: files, vaultError: undefined })` (store.ts:5989-5990) and never touches vaultNote. The desktop folder provider is explicitly "last-write-wins at the file level (you, the agent, and Obsidian can all touch it)" (gitos/deviceFolder.ts:9-11), and its IPC write is a bare `writeFileSync(abs, text)` (electron/main.ts:967). Scratch test: create 'mine', change the file externally to 'agent appended line', call vaultRefresh(); vaultNote.text is still 'mine'.

**Impact.** Scenario: a person leaves a note open on the phone or desktop while the agent's vaultWrite, a routine, Obsidian or another device edits it. The next keystroke, or the flush on leaving, silently writes the old text plus that keystroke over the newer version. The screen never shows the other edit, so the loss goes unnoticed. This undercuts the shared agent/human vault, which is the feature's point.

**Proposed fix.** Keep a base version (vaultNote.updatedAt) and check it on foreground, on window focus and before each autosave (provider.stat). If the stored copy is newer and the draft is clean, reload it in place. If the draft is dirty, pause autosave and show a banner: "Changed elsewhere: Keep mine / Use theirs / Keep both". Add a compare-and-swap write to the seam (write(resourceId, path, text, baseUpdatedAt)) and enforce it in electron/main.ts osc:vaultWrite (mtime check) and icloud.ts. Changes in app/src/state/store.ts (vaultSave, vaultRefresh), app/src/screens/VaultScreen.tsx and app/src/lib/gitos/providers.ts.

**Verifier.** VaultScreen.tsx:179-191 sets the draft only when vaultNote?.path changes. The foreground handler (234-238) calls vaultRefresh, and vaultRefresh (store.ts:5964-6001) only sets vaultFiles/vaultError and never re-reads vaultNote. Nothing else re-reads the open note: there is no watcher in main.ts, and deviceFolder is explicitly last-write-wins (deviceFolder.ts:9-11, main.ts:967 writeFileSync). Local grants the lease trivially and has one writer, so there it cannot happen. It does happen on 'files' (Obsidian or approved agent writes), on iCloud/Drive once the 90s lease lapses, and worst on the team vault, which has no lease and where list() also advances the base rev (see missed ui-M1), so the overwrite leaves no conflict copy.

### [ui-2] Google Drive conflict copy is undone by the next autosave, and the other device's edit is lost

high, data-loss, v1 must, size M, confirmed. `app/src/state/store.ts:6106`

**Evidence.** gdrive.ts:418-432: when Drive changed since last seen, the write lands at `cpath` and the base entry is refreshed to the live version: `handle.index.files[path] = { id: cached.id, updatedAt: live.updatedAt, ... }; return { path: cpath, ... }`. vaultSave ignores the returned path: `vaultNote: get().vaultNote?.path === path ? { path, text: saved.text, updatedAt: saved.updatedAt } : get().vaultNote` (store.ts:6108-6111). The editor keeps scheduling saves to vaultNote.path (VaultScreen.tsx:415). Scratch test with a provider that mirrors gdrive's write: open X, change X remotely to 'REMOTE EDIT', autosave twice. Result: `[["X.md","v1 mine more"],["X (conflict now).md","v1 mine"]]`, `remote survives= false`.

**Impact.** The first save after a remote change copies the local text aside. The index now matches Drive, so the second save overwrites the remote edit at the original path. Neither copy holds the other device's text. gdrive.ts promises "so neither side's edit is lost", but in real use it always is. A realistic trigger: the phone is backgrounded past the 90s lease, the person edits on the desktop, then returns to the phone.

**Proposed fix.** In vaultSave, treat `saved.path !== path` as a conflict. Stop autosaving that note, load the live remote body, and open a Keep mine / Use theirs / Keep both resolution that points at the conflict copy. In app/src/lib/gitos/gdrive.ts, do not advance the base entry to the live version until the UI has resolved it (or return a typed conflict result instead of a silently different path). Add a store test that mirrors the scratch case above.

**Verifier.** gdrive.ts:421-432: on a stale write it creates the conflict copy, sets the base entry to live.updatedAt, and returns {path: cpath}. vaultSave (store.ts:6106-6111) ignores saved.path and keeps vaultNote.path. The editor keeps scheduling saves to vaultNote.path (VaultScreen.tsx:415). The next writeFile finds cached.updatedAt === live.updatedAt and calls putContent over the remote edit. Result: the original path holds the local text and the conflict copy holds older local text, so the other device's text is gone. The trigger needs the lease to lapse (background over 90s), which is realistic on iOS.

### [ui-3] Offline stash replay overwrites a newer successful save with older text

high, data-loss, v1 must, size S, confirmed. `app/src/state/store.ts:6115`

**Evidence.** vaultSave writes the new text (6099), then `await replayVaultPending(target);` (6115). replayVaultPending writes every stashed body for the resource, including the stale one for the same path: `await target.provider.write(item.resourceId, item.path, item.text)` (3036-3053). Scratch test: vaultSave('note.md','draft A') fails (stashed); vaultSave('note.md','draft A plus B') succeeds. Result: file = "draft A", while vaultNote.text (on screen) = "draft A plus B".

**Impact.** After a connection blip, the first successful save is immediately overwritten by the older stashed draft. The screen still shows the newer text, so the person believes it is saved. If they stop typing and leave, the words typed after the blip are gone from storage. The recovery path meant to protect typed text is what destroys it.

**Proposed fix.** On a successful write of `path`, delete the stash entry `${resourceId}::${path}` before replaying, because the newer write supersedes it. Replay only other paths, and only when the stash is newer than the stored updatedAt. Add a regression case to app/test/vaultStore.test.ts ("a newer save is not clobbered by its own stale stash").

**Verifier.** store.ts:6099 writes the new text, then 6115 replayVaultPending writes every stash entry for the resource (3036-3053) with no path or recency check, including the stale same-path stash from the failed save. vaultRefresh (5993) replays the same way, so a foreground refresh after a later successful save also regresses the file. The existing test vaultStore.test.ts:144-156 misses it because it saves identical text both times.

### [ui-4] Out of the box, the Vault room is not the vault the agent and routines use, yet its copy says it is

high, claim-mismatch, v1 must, size L, confirmed. `app/src/screens/VaultScreen.tsx:731`

**Evidence.** The personal vault auto-registers on the sealed store: `providerId: 'local'` (store.ts:5972-5978), and nothing selects 'files' on desktop. The engine's tools and routines write `config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault')` (os-code/src/core/agent/registry.ts:145; os-code/src/routines/scheduler.ts:683), and app/src/drivers/* has no vault reference. The copy still promises a shared vault: "You write in them, and so does your agent as it works, so what it learns stays with you." (VaultScreen.tsx:731-733); "The agent saves what it learns and reads your notes back when it works" (764-768); the welcome note says "As your agent works, it can save what it learns here" (289-290); guideCards.ts:537 says "Routines leave their notes here."; CrewCommandScreen.tsx:465 and 1043 say "Each run leaves a note in your vault" and "Saved in your vault: {note.path}".

**Impact.** On a phone, and on a desktop that never opened "Where it lives", agent memory and routine reports never appear in the Vault room, and the agent never reads what the person writes there. The feature's main promise (shared context that survives across models and sessions) fails silently for the default user, and CLAUDE.md's honesty-in-copy rule is broken.

**Proposed fix.** Make one vault the default truth. On desktop, default the personal vault to 'files' (or migrate on first open, with a card). On a paired phone, add an "Agent vault" source read through the daemon (as hermesNotesList does for the current) with the same browse, read and search, and route edits through the engine. Until each path is real, make the copy provider-aware ("On this device only. Your agent writes to the vault on your computer"). Files: app/src/state/store.ts vaultRefresh, app/src/lib/gitos (a daemon-backed provider), app/src/screens/VaultScreen.tsx and app/src/lib/guideCards.ts.

**Verifier.** The personal vault auto-registers providerId 'local' (store.ts:5972-5978), and vaultProviderId defaults to 'local' (555-557). Nothing in app/src selects 'files' automatically (grep: only vaultMoveTo from the storage sheet). Electron osc:vault* and the engine both use config vault.dir ?? ~/OSCode/Vault (main.ts:920-925, registry.ts:145, scheduler.ts:683). app/src/drivers has no vault reference. The quoted copy is accurate: VaultScreen 289-290, 731-733, 764-768; guideCards.ts:537; CrewCommandScreen 465, 1043. The line 'yours on this device' is itself accurate for Local, but the claim that the agent writes there is not.

### [ui-5] There is no way to take a note to a model: no "use in chat", no pinned context, no [[ or @ note picker in the composer

high, gap, v1 must, size L, confirmed. `app/src/screens/VaultScreen.tsx:504`

**Evidence.** The note's Options sheet offers only "Delete this note" and "Cancel" (504-535). The composer's @ picker lists repo files, and only for an agent session: `setMention(agent ? mentionAt(...) : null)` feeding `listFiles(mentionQuery)` (Composer.tsx:399-415, 1045). grep finds no 'vault' anywhere in app/src/drivers/, Composer.tsx, AttachTray.tsx or ChatScreen.tsx.

**Impact.** The ask is for Vault to be the key to moving between models and optimizing context. Today a person cannot hand a note, a folder or a search result to whichever model is seated, cannot pin notes as standing context for a project, and cannot see what the agent read. Switching models means re-explaining everything; the vault holds knowledge but does not move it.

**Proposed fix.** (1) Note Options: "Ask about this note" (starts a chat with the note attached within a token budget) and "Add to project context" (pinned notes stored on Project, injected by every driver). (2) Composer: [[ opens a vault-note picker in every chat, including app-side drivers (StackDriver, the cloud drivers), and resolves to a trimmed excerpt with a cost line. (3) A "Handoff note" action when switching seats writes a dated summary to the vault that the next model reads first. (4) Provenance on notes (you / agent / routine / teammate) and a "Recently from your agent" row, as vault-page-redesign.md already suggests. Files: app/src/screens/VaultScreen.tsx, app/src/components/Composer.tsx, app/src/drivers/*, app/src/screens/ProjectDetailScreen.tsx.

**Verifier.** The Options sheet has only Delete and Cancel (504-535). Composer's @ mention is agent-only and lists workspace files (Composer.tsx:399-415, 1045). There is no vault reference in drivers, Composer, AttachTray or ChatScreen, and searchNotes/parseWikilinks are unused in app/src. Nuance: engine coding sessions do have read-only vaultRead/vaultList tools (registry.ts:86-87), and repo-based project memory carries context across sessions. So the model can pull from the on-disk vault if it thinks to, but the person has no way to hand a note or folder to any seated model, and app-side drivers have no path at all.

### [ui-6] Wikilink rewriting runs on raw text and corrupts code blocks and inline code

medium, bug, v1 must, size M, confirmed. `app/src/lib/vault.ts:146`

**Evidence.** `wikilinksToMarkdown` runs `text.replace(EMBED, ...)` and then `.replace(WIKILINK, ...)` over the whole string before markdown parsing (146-159), and VaultMarkdown feeds that result to ReactMarkdown (VaultMarkdown.tsx:60). Rendered in a scratch test: a ``bash fence with `if [[ -f "$f" ]]` shows `[-f "$f"](vault:-f%20%24f.md?new)` inside the code block; a ``toml `[[bin]]` becomes `[bin](vault:bin.md?new)`; inline code `` `[[y]]` `` becomes `[y](vault:y.md?new)`, and `` `![[x]]` `` becomes "embed not supported yet: x".

**Impact.** A coding agent's vault is full of shell tests ([[ ]]), TOML arrays of tables and snippets. Read mode shows wrong code, and anyone who copies a command from a note gets corrupted text. backlinksTo and parseWikilinks also count bracket pairs inside code as links.

**Proposed fix.** Replace the string pre-pass with a remark plugin that visits mdast text nodes only (skipping code and inlineCode) and emits link or embed nodes, and use the same tokenizer for backlinksTo and parseWikilinks so the room and the agent agree on what is a link. Files: app/src/lib/vault.ts, app/src/components/VaultMarkdown.tsx; add renderer tests using react-dom/server (the approach the scratch test used).

**Verifier.** Reproduced with react-dom/server. A ``bash fence renders `[-f "$f"](vault:-f%20%24f.md?new)`, ``toml [[bin]] renders `[bin](vault:bin.md?new)`, inline `[[y]]` renders `[y](vault:y.md?new)`, and inline `![[x]]` renders 'embed not supported yet: x'. backlinksTo also credited a TOML [[bin]] inside a fence as a backlink to bin.md. I downgraded severity because the stored text and edit mode are intact and only read mode and backlinks are wrong. It stays must because read mode is the default for existing notes and the fix is small.

### [ui-7] YAML frontmatter (Obsidian Properties) renders as a horizontal rule plus a big H2

medium, bug, v1 must, size M, confirmed. `app/src/components/VaultMarkdown.tsx:30`

**Evidence.** Plugins are only `remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}` (30-31); no remark-frontmatter. A scratch render of `---\ntags: [a, b]\ncreated: 2026-09-01\n---\n\nBody` produced `<hr/><h2>tags: [a, b]\ncreated: 2026-09-01</h2><p>Body</p>`.

**Impact.** Every note from a real Obsidian vault that uses Properties (very common), and any note the agent writes with metadata, opens with a broken-looking heading of raw YAML. For a feature sold on "point Obsidian at the same files", this is the first thing an Obsidian user sees. It also means properties cannot become structured context (tags, status, source model) for the harness.

**Proposed fix.** Add remark-frontmatter, parse the YAML, and render a quiet collapsible Properties block (key/value chips, with tags clickable into search). In edit mode keep the YAML as text, with a later structured editor. Share the parser with the engine so vaultList and vaultRead can return properties for context selection. Files: app/src/components/VaultMarkdown.tsx, app/src/lib/vault.ts, app/package.json.

**Verifier.** Reproduced: `---\ntags: [a, b]\ncreated: ...\n---\n\nBody` renders `<hr/><h2>tags: [a, b]\ncreated: 2026-09-01</h2><p>Body</p>`. app/package.json has only remark-gfm and rehype-highlight, with no frontmatter plugin. Routine notes do not write frontmatter (scheduler.ts:595-610), so the impact falls on imported Obsidian notes and agent notes with properties. That is a visual defect rather than data loss, so medium, but it is must for an Obsidian-baseline v1.

### [ui-8] Obsidian-flavored markdown is largely unsupported: callouts, tags, highlights, comments, embeds, images, math, mermaid, tickable tasks

medium, gap, v1 should, size L, confirmed. `app/src/components/VaultMarkdown.tsx:29`

**Evidence.** Scratch renders: `> [!note] Heads up` becomes a plain blockquote with the literal "[!note]"; `#project ==hi== %%secret%% $x^2$` renders verbatim, so an Obsidian %%comment%% (hidden in Obsidian's reading view) is shown; `- [ ] one` renders `<input type="checkbox" disabled=""/>`; `![[diagram.png]]` becomes the chip "embed not supported yet: diagram.png" (vault.ts:147-150); `![alt](diagram.png)` renders a relative &lt;img> that cannot load, because the file bridge lists only `.md` files (electron/main.ts:942) and the seam carries text only. [[Note#Heading]] opens the note but does not scroll to the heading. The header comment claims "the chat renderer's exact markdown treatment" (1), but the chat's CodeBlock with Copy (Markdown.tsx:45-80) is not used, so vault code blocks have no Copy.

**Impact.** Notes from Obsidian, and notes the agent writes in Obsidian idioms, render noticeably worse than in Obsidian. Checklists cannot be ticked in read mode, private comments are exposed, and attachments are invisible.

**Proposed fix.** For v1: callouts (a small remark plugin with house-styled variants), clickable #tags into search, ==highlight==, hidden %%comments%%, tickable task checkboxes that write back through vaultSave, the chat's CodeBlock (Copy, and Run where allowed), heading anchors with scroll-to on [[Note#H]], and note transclusion for ![[Note]]. Next: image and attachment support in the seam (binary list, read and write, or at least images) and ![[img]]. Later: math (KaTeX) and mermaid, lazy-loaded. Files: app/src/components/VaultMarkdown.tsx, app/src/lib/vault.ts, app/src/lib/gitos/providers.ts, app/electron/main.ts.

**Verifier.** Reproduced: the callout stays a plain blockquote with literal [!note]; `#project ==hi== %%secret%% $x^2$` renders verbatim; task checkboxes render disabled; `![alt](diagram.png)` emits a relative img; ![[x]] becomes the 'not supported' chip (vault.ts:147-150). The Electron list only returns .md (main.ts:942). VaultMarkdown claims 'the chat renderer's exact markdown treatment' (line 1), yet Markdown.tsx:46-126 wraps pre in CodeBlock with Copy and VaultMarkdown does not. The WIKILINK regex drops #Heading, so there is no scroll-to.

### [ui-9] A malformed vault: link crashes the whole app (URIError during render, no error boundary)

medium, bug, v1 must, size S, confirmed. `app/src/components/VaultMarkdown.tsx:38`

**Evidence.** `const path = decodeURIComponent(raw);` runs during render for any href starting with vault: (35-38). Scratch: rendering `[x](vault:%E0)` threw `URIError: URI malformed`. grep finds no ErrorBoundary, componentDidCatch or getDerivedStateFromError anywhere in app/src, and App.tsx renders the room directly (271-273).

**Impact.** One note containing a bad percent-escape in a vault: link (hand-typed, pasted, model-written, or planted by a teammate in the team vault) blanks the whole app when opened in read mode, which is the default for existing notes. It hits every team member who opens that note until someone deletes it from another device.

**Proposed fix.** Wrap the decode in try/catch and fall back to the raw string. Add an ErrorBoundary around room content in App.tsx (and a local one around VaultMarkdown) that shows the raw text with a "This note could not be rendered" notice and an Edit action.

**Verifier.** Reproduced: rendering `[x](vault:%E0)` threw URIError: URI malformed from VaultMarkdown.tsx:38. grep finds no ErrorBoundary, componentDidCatch or getDerivedStateFromError in app/src, and App.tsx:270-271 renders the room directly. Wikilinks themselves are safe because they are encodeURIComponent-encoded ([[100%]] rendered fine), so only hand-written or pasted vault: links trigger it. A relaunch recovers (vaultNote is not persisted), but the note cannot be deleted in-app, since Options lives in the view that crashes.

### [ui-10] No search, quick switcher or recents, although searchNotes is built and tested

high, gap, v1 must, size M, confirmed. `app/src/lib/vault.ts:184`

**Evidence.** `export function searchNotes(query, paths, bodies)` (184-210) is referenced only in app/test/vault.test.ts:180 ("searchNotes (review 6: a way to find a note)"). The tree view has no input: it renders crumbs and `entries.map(...)` (682-807). There is no Cmd/Ctrl+O or Cmd+Shift+F handler anywhere in VaultScreen.tsx.

**Impact.** Beyond a few dozen notes, and with routines adding a dated note per run, the only way to find something is to tap through folders by name. Search is table stakes for Obsidian users and the fastest way to pull the right context into a chat.

**Proposed fix.** A search field at the top of the tree: title hits appear instantly, body hits come from the vaultReadAll cache or an index (ui-17), with highlighted excerpts. #tag search once tags parse (ui-8). A quick switcher overlay on desktop (Cmd/Ctrl+O) and a Recent section (last opened and edited, including agent-written notes). Files: app/src/screens/VaultScreen.tsx, app/src/lib/vault.ts.

**Verifier.** grep: searchNotes has no caller in app/src or os-code/src and is referenced only by app/test/vault.test.ts. VaultScreen has no search input and no metaKey/ctrlKey handler. There is no alternative palette or search that indexes vault notes (the only vault-referencing app files are listed and none search).

### [ui-11] Notes and folders cannot be renamed or moved; no folder create or delete

high, gap, v1 must, size L, confirmed. `app/src/screens/VaultScreen.tsx:393`

**Evidence.** The title is static: `<h1 className="vault-title">{title}</h1>` (393). Options holds only Delete (504-535). Folders exist only as path prefixes derived by treeAt (vault.ts:219-238), so an empty folder cannot exist, and the only way to make one is "A slash makes folders" in the new-note name (816). The seam has no rename: `list, stat, read, write, remove` plus lease (providers.ts:66-77).

**Impact.** Everyday Obsidian moves (fix a title, reorganize a folder, file an agent's note where it belongs) are impossible without deleting and retyping. Renaming by hand would also break every [[link]] to the note.

**Proposed fix.** An inline editable title (rename) with a link-update pass that rewrites [[Old]] and [[Old|alias]] across the vault via parseWikilinks, previewed with an "Update N links" confirm, as Obsidian does. Move to folder, new folder, rename folder and delete folder (with a count) from the Options and tree row menus. Add an optional `rename(resourceId, from, to)` to StorageProvider (with a write-plus-remove fallback) and implement it in main.ts, gdrive (Drive files.update parents and name) and orgVault. Files: app/src/screens/VaultScreen.tsx, app/src/lib/vault.ts, app/src/lib/gitos/*.

**Verifier.** The title is a static h1 (393). Options holds only Delete. StorageProvider (providers.ts:70-78) has no rename. Folders are derived from path prefixes in treeAt (vault.ts:219-238), and the only way to create one is the slash in the new-note name (816). No rename, move or folder operation exists under any name.

### [ui-12] Delete is permanent with no trash or undo, and the success toast fires before the delete runs

medium, data-loss, v1 must, size M, confirmed. `app/src/screens/VaultScreen.tsx:520`

**Evidence.** The code's own comment admits it: "a local or iCloud delete is unrecoverable" (508-509). The handler does `void vaultDelete(path); showToast('Note deleted.');` (520-521), so the toast shows before the await. On failure the store then shows "Could not delete that note." (store.ts:6148-6150). Electron removes the file outright: `if (existsSync(abs)) rmSync(abs);` (main.ts:972).

**Impact.** One mis-tap on the confirm (the confirm button sits exactly where the first tap landed) destroys a note, possibly one the agent spent a session writing. There is no way back, and a failed delete briefly reports success.

**Proposed fix.** Move deletes into a `.trash/` folder in the vault (Obsidian's default; list() already hides dot-folders on the file bridge), show an Undo toast, and add a Trash view with Restore and Empty. Show the success toast only after the await resolves. A setting can choose permanent delete for people who want it (ui-20).

**Verifier.** VaultScreen.tsx:508-509 comment, 520-521 `void vaultDelete(path); showToast('Note deleted.')` runs before the await. store.ts:6148-6150 shows the failure toast afterwards. main.ts:972 rmSync. Local deletes the sealed key outright (local.ts:57-62). Drive uses trashFile, which is recoverable only in Drive's own trash. The two-tap confirm is the same button in the same place.

### [ui-13] Read-only mode is leaky: create, welcome note, wikilink-create and delete all still write while another device holds the lease

medium, bug, v1 must, size S, confirmed. `app/src/screens/VaultScreen.tsx:101`

**Evidence.** `const readOnly = Boolean(vaultLeaseHeldByOther);` gates only the edit toggle and the editor (374-375, 405). Still active: the + New note button (550-555), "Add a welcome note" (739), unresolved-wikilink create `if (isNew) { flushSave(); void vaultCreate(p); }` (463-466), and Delete (505-522). Neither vaultCreate nor vaultDelete checks the lease (store.ts:6043-6089, 6129-6152). Scratch: with vaultLeaseHeldByOther = true, vaultCreate wrote x.md and vaultDelete removed it. The tree view shows no read-only banner at all.

**Impact.** The single-writer lease (FD-3) exists to prevent cross-device collisions on iCloud and Drive, but half the write paths bypass it. A person sees "Read-only here" on a note, yet can still delete it or create notes that race the other device.

**Proposed fix.** Enforce the lease once in the store (vaultCreate, vaultSave, vaultDelete and rename refuse with a toast when vaultLeaseHeldByOther). In the UI, disable or hide the +, welcome, create-from-link and delete affordances and show the read-only banner in the tree view too.

**Verifier.** readOnly gates only the edit toggle and the editor (374-375, 405). The + button (550-555), 'Add a welcome note' (739), wikilink create (463-466) and Delete (505-522) stay live. vaultCreate, vaultDelete and vaultSave have no lease check (store.ts:6043-6152). The read-only banner renders only in the note view. In practice only iCloud and Drive contest the lease (local, files and org grant it), so the scope is those two providers.

### [ui-14] "Export as plain files" deletes the export folder recursively every time, including anything Obsidian wrote there

medium, data-loss, v1 should, size M, confirmed. `app/src/lib/vaultExport.ts:36`

**Evidence.** `await Filesystem.rmdir({ path: EXPORT_ROOT, directory: Directory.Documents, recursive: true });` runs before every export (36-42). The button has no confirm (VaultScreen.tsx:946-967), and its toast invites exactly the workflow that gets wiped: "exported to Files, under OpenShore / Vault. Obsidian opens that folder as a vault." (960). There is no import path back into the Vault.

**Impact.** A person who follows the toast, opens the folder in Obsidian and writes there (plus Obsidian's .obsidian settings and plugins) loses all of it on the next Export, silently. It is a one-way escape hatch presented as if it were a shared folder.

**Proposed fix.** Keep a manifest of the files OpenShore exported and remove only those; never delete unknown files or dot-folders. Confirm before overwriting any file changed since the last export. Add "Import from a folder / Obsidian vault" so the round trip exists. Word the toast as a one-way copy until import ships. Files: app/src/lib/vaultExport.ts, app/src/screens/VaultScreen.tsx.

**Verifier.** vaultExport.ts:36-40 does `Filesystem.rmdir({path:'Vault', directory: Documents, recursive: true})` on every export, per the R-13 comment, with no manifest. The button has no confirm (VaultScreen.tsx:946-967), and the toast at 960 invites opening the folder in Obsidian. No import path exists. Whether Obsidian iOS can write into that exact folder was not device-verified, but anything placed there, including .obsidian, is wiped.

### [ui-15] [[ autocomplete is pointer-only, corrupts a link being edited, and sits where the phone keyboard likely covers it

medium, ux, v1 must, size M, confirmed. `app/src/screens/VaultScreen.tsx:337`

**Evidence.** Chips act only on mouse down: `onMouseDown={(e) => { e.preventDefault(); insertWikilink(t); }}` (437-440, 448-451). The textarea has no onKeyDown: no Arrow, Enter, Tab or Esc handling, unlike Composer.tsx:798-820. Tab moves focus, and `onBlur={() => setLinkQuery(null)}` (427) removes the list. `role="listbox"` wraps plain buttons, not options (430). The insert keeps the old tail: `const after = draft.slice(caret)` (340-343); scratch with the caret inside `See [[Ideas]] today` gives `See [[Ideas]]eas]] today`. The chip row renders after a textarea with `min-height: 46vh` (theme.css:1264-1266, 1286), below the fold once the iOS keyboard is up (plausible, not device-verified). The programmatic `setDraft(next)` also likely resets the native undo stack (plausible).

**Impact.** Desktop keyboard users cannot link notes without the mouse, screen-reader semantics are wrong, and on a phone the suggestions may be hidden while typing. Tapping into an existing link to change it and picking a suggestion leaves garbage brackets.

**Proposed fix.** Keyboard navigation matching the composer (Up/Down, Enter/Tab to pick, Esc to dismiss) with role=option and aria-activedescendant. Replace through an existing `]]` or `|` when the caret is inside a link. Heading (#) completion after a note name. Pin suggestions above the keyboard with the visualViewport (an accessory bar). Insert with setRangeText or execCommand('insertText') to keep undo. This comes free if the editor moves to CodeMirror 6 (ui-21).

**Verifier.** The chips act only on onMouseDown (437-451). The textarea has no onKeyDown, unlike Composer.tsx:798-820, and role=listbox wraps plain buttons. Reproduced the corruption: wikilinkContext('See [[Ideas]] today', 8) gives {start:4, query:'Id'}, and the insert yields 'See [[Ideas]]eas]] today'. The chip row sits below a min-height:46vh textarea (theme.css:1264-1276). Keyboard occlusion and undo-stack loss are plausible but not device-verified, as the reviewer said. Must mainly for the text-corruption fix; keyboard navigation could be should.

### [ui-16] No save status: a failed or offline save shows only a passing toast

medium, ux, v1 must, size S, confirmed. `app/src/screens/VaultScreen.tsx:394`

**Evidence.** The note meta line shows only folder and word count: `{(parent || 'Vault') + ' · ' + words + ...}` (394-396). vaultError is read only for 'load' (701). On a failed save the store sets `vaultError: 'save'` and shows a toast (store.ts:6120-6124), and nothing on the note says that its text exists only in the device stash.

**Impact.** With autosave and no Save button, the person has no way to know whether their words reached storage (iCloud, Drive, team), whether they are offline, or how many notes are waiting to sync. Interaction-model tenet 7 ("Honest states over clever states") is not met on the editor.

**Proposed fix.** A quiet status chip in the note bar (Saved / Saving / Offline, kept on this device) driven by the save promise and vaultError. In the tree, a pending count with Retry that runs replayVaultPending. Keep the offline state while the error persists, not just a toast.

**Verifier.** The meta line shows only folder and word count (394-396). vaultError is read only for 'load' (701). On a failed save, store.ts:6120-6124 sets vaultError 'save' and toasts. Nuance: failure is not silent. The toast fires on every failed autosave, so offline typing produces repeated toasts rather than one persistent state, which strengthens the case for a status chip. Tenet 7 is in docs/interaction-model.md:33.

### [ui-17] Large-vault performance: serial full reads on every note open, cold after each launch, and full tree walks after every autosave

medium, perf, v1 should, size M, confirmed. `app/src/state/store.ts:6163`

**Evidence.** Opening any note runs vaultReadAll (VaultScreen.tsx:184), which lists the vault and awaits each uncached read one at a time: `for (const f of files) { ... const note = await target.provider.read(...) }` (6163-6175). The cache is an in-memory Map (store.ts:694), so every launch starts cold: N sequential HTTPS reads on Drive, or N IPC reads on the folder provider. vaultSave re-lists after each write (6107). On desktop that list is a recursive readdirSync and statSync in the Electron main process (main.ts:933-955), and deviceFolder.stat lists everything to stat one file (deviceFolder.ts:42-44), which makes vaultMoveTo O(N^2). The tree is not virtualized, and `treeAt(folder, vaultFiles)` runs on every render, including each editor keystroke (VaultScreen.tsx:307). vaultReadAll has no catch at the call site (184-186), so a failed read leaves the previous note's backlinks on screen.

**Impact.** A real Obsidian vault (thousands of notes) pointed at "This folder", or a Drive vault of a few hundred notes, gets slow backlinks, main-process stalls on each typing pause, and a sluggish flat folder on a phone.

**Proposed fix.** Keep a persistent link and property index (outgoing links, headings, tags, updatedAt per note) stored beside the vault, updated incrementally on each save, and use it for backlinks, search and context selection instead of vaultReadAll. Run reads in parallel with a bound, use async fs plus a watcher in main.ts, patch vaultFiles locally after a write instead of re-listing, memoize treeAt, and virtualize folders over about 200 rows.

**Verifier.** vaultReadAll runs list plus serial awaited reads (store.ts:6154-6177). vaultBodyCache is an in-memory Map (694). vaultSave re-lists after every write (6107). The Electron list is a sync recursive readdirSync/statSync (main.ts:933-955). deviceFolder.stat does a full list (42-44), so vaultMoveTo's per-note target.stat into 'files' is O(N^2) (store.ts:6238). treeAt runs in the component body on every render, including note-view keystrokes (307). There is no catch on vaultReadAll at 184-186, so a failed read leaves the previous backlinks and an unhandled rejection.

### [ui-18] Motion and press-rule gaps: an unstyled + button, chips, mentions and tabs without press feedback, hard cuts and stale backlinks

low, ux, v1 should, size S, confirmed. `app/src/screens/VaultScreen.tsx:551`

**Evidence.** `className="stack-add-btn"` (551) has no rule anywhere in theme.css (grep finds it only in VaultScreen.tsx). It is a bare `button` (theme.css:367-373) around a 20px icon: about a 20x20 tap target with no :active state. `.vault-link-chip` (theme.css:1296-1310), `.vault-mention` (1355-1362) and the Personal/Team `.seg` tabs (VaultScreen.tsx:568-583, no press-fb) have no press feedback, against CLAUDE.md motion rule 2. The tree-to-note swap, the edit/read swap, the autocomplete row and the Linked mentions card all mount with a hard cut. The backlinks effect never resets on path change (179-191), so the previous note's mentions show until the read resolves.

**Impact.** The room's primary action is hard to hit and does not answer the finger. Moving between notes and modes does not meet the "smooth and slow feels premium" bar the rest of the app holds.

**Proposed fix.** Use the house icon button for + (44px hit area, press-fb); add press-fb to chips, mentions and seg; crossfade note/tree and read/edit on --dur and --ease tokens with a presence-aware exit; reset backlinks on path change with a quiet skeleton. Optionally add a guard in app/test/polish-standards.test.ts that every className used in TSX has a rule.

**Verifier.** .stack-add-btn has no rule in theme.css (only the bare button reset at 367-373 applies, and .stack-head is only flex). .vault-link-chip and .vault-mention have no press state. The Vault seg buttons lack press-fb, though theme.css:5842 supports .seg.press-fb. The effect at 179-191 never resets backlinks. Tree/note and read/edit swaps are conditional renders with no transition.

### [ui-19] Conflict copies are invisible, and the team vault gives no signal when two people edit the same note

medium, gap, v1 should, size M, partial. `app/src/lib/vault.ts:167`

**Evidence.** `isConflictCopy` (167-169) is used only in app/test/vault.test.ts. The team RPC silently moves the other writer's body to `'<name> (conflict YYYY-MM-DD HHMI).md'` whenever the base rev is stale (supabase/migrations/0010_org_vault.sql:94-110). The open note never refreshes (ui-1), and the team vault has no lease (store.ts:6182-6185).

**Impact.** Two teammates typing in the same note alternate (each save pushes the other's version into a conflict file), with no sign on either screen. Conflict files then pile up in the tree as ordinary notes with no way to resolve them.

**Proposed fix.** Badge conflict copies in the tree. Add a Resolve view (side by side with the original: keep one, keep both, or merge by hand). Show a banner on an open note when a conflict copy of it appears. For the team scope, poll or subscribe (Supabase realtime) for the open note's rev and show "&lt;teammate> is editing". Files: app/src/screens/VaultScreen.tsx, app/src/lib/gitos/orgVault.ts.

**Verifier.** Holds: isConflictCopy has no caller in app/src, conflict copies show as ordinary notes, there is no Resolve UI, and there is no signal on the open note. The team RPC does copy the overwritten body aside when the base rev is stale (0010_org_vault.sql:94-110). Inaccurate: 'each save pushes the other's version into a conflict file'. orgVault.list() sets baseRev for every row (orgVault.ts:102), and the store lists after every save, on every note open (vaultReadAll) and on foreground. Many concurrent edits therefore pass the rev check and overwrite silently with no conflict copy at all (scratch-verified, see missed ui-M1). Same-minute repeat clashes also fold onto one copy, overwriting the earlier copy (0010:99-108).

### [ui-20] Nothing is customizable: no Vault settings for new-note location, templates, daily notes, editor font, default mode, sort or delete behavior

medium, gap, v1 should, size M, confirmed. `app/src/theme.css:1264`

**Evidence.** The editor is fixed at `font-family: var(--font-mono); font-size: var(--text-4);` (14px, theme.css:1264-1277). SettingsScreen.tsx has no vault reference, and AppSettings holds only `gitosResources` for the vault (store.ts:373-375). New notes go to the current folder or the root (VaultScreen.tsx:267), and the tree sort is fixed alphabetical with localeCompare (vault.ts:233-237).

**Impact.** The ask is "fully customizable". Obsidian's model is good defaults with every piece adjustable (new-note folder, templates, daily notes, attachment folder, readable-line width, editor font, trash behavior). Today nothing is adjustable.

**Proposed fix.** A small Vault section, opened from the Options sheet and mirrored in Settings, stored in the vault itself (for example `.openshore/vault.json`) so it travels with the files and the agent can read it. Settings: new-note folder, daily-note folder and date format, template folder, default open mode, editor font (proportional or mono) and size, sort (name or modified), trash versus permanent delete, and which folders the agent may read or write. Ship the defaults that make it great without touching any of these.

**Verifier.** No vault reference in SettingsScreen.tsx (absent from the grep list of vault-referencing files). AppSettings holds only gitosResources for the vault (store.ts:373-375). The engine config has only vault.dir (schema.ts:214-217). The editor font is fixed mono (theme.css:1269-1270). Sort is fixed localeCompare (vault.ts:233-236), and new notes go to the current folder (VaultScreen.tsx:267).

### [ui-21] The editor is a raw textarea: no live preview, no clickable links while editing, no desktop shortcuts or two-pane layout

medium, gap, v1 should, size L, confirmed. `app/src/screens/VaultScreen.tsx:407`

**Evidence.** Editing is a plain `<textarea className="vault-editor">` (407-428) and reading is a separate mode behind a toggle (370-387). Links work only in read mode. The only keyboard handling in the room is Enter in the new-note input (824). On desktop, the note view replaces the tree (one column, single `if (vaultNote) return ...` at 311). There are no outgoing links, unlinked mentions, graph or daily note.

**Impact.** Obsidian's default is Live Preview, with markdown rendering as you type, links clickable, and full undo and keyboard control. Next to it, this editor feels like a settings field, especially on desktop where people will live in it.

**Proposed fix.** Move the editor to CodeMirror 6 with markdown live-preview decorations (the editor Obsidian itself is built on). That brings reliable undo and redo, keyboard autocomplete (fixing ui-15), folding, and Cmd-click links. On desktop, use a two-pane layout (tree or search beside the note) and shortcuts: Cmd+N new, Cmd+E toggle, Cmd+O switcher, Cmd+Shift+F search, Esc back. Outgoing and unlinked mentions under Linked mentions. A daily note entry. Graph view can wait until after v1.

**Verifier.** Editing is a plain textarea (407-428), read mode sits behind the toggle (370-387), links are clickable only in read mode, and the only keyboard handling is Enter in the new-note input (824). The note view replaces the tree via an early return (311). There are no outgoing links, unlinked mentions, graph or daily note anywhere in app/src.

### [ui-22] Storage sheet copy overclaims Obsidian compatibility and labels a desktop-only option "Arriving" on the phone

low, claim-mismatch, v1 should, size S, confirmed. `app/src/screens/VaultScreen.tsx:856`

**Evidence.** The sheet always says "Your notes are files, and you choose the storage that holds them. Point Obsidian at the same files and it just opens." (856-859). The default provider is not files at all: "through the app's existing sealed key-value store, so vault bytes are encrypted at rest" (gitos/local.ts:1-3). Obsidian cannot open a Google Drive folder natively, and Obsidian on iOS cannot open the OpenShore iCloud container. On a phone, "This folder" (desktop-only) renders the `Arriving` pill (VaultScreen.tsx:919-923).

**Impact.** A person who takes the line literally looks for files that do not exist (Local) or a folder Obsidian cannot open (Drive, iOS iCloud), and "Arriving" suggests the folder option is coming to the phone.

**Proposed fix.** Give each provider an honest line: Local "sealed on this device; Export to open in Obsidian"; This folder "Obsidian opens this folder directly"; iCloud "Obsidian on a Mac opens it"; Drive "open with a sync client". Show "On your computer" instead of "Arriving" for 'files' on a phone.

**Verifier.** The sheet copy at 856-859 is unconditional. local.ts:1-3 stores bytes in the sealed KV store, so they are not files. On a phone, 'files' is not arriving (no flag), is not ready (probeReady is Electron-only, index.ts:38), and renders the 'Arriving' pill (919-923). DECISIONS gives not-ready providers an Arriving pill, but 'files' never arrives on a phone. Its toast (pending text) is honest; the pill is not.

### [ui-23] Ordinary markdown links between notes are not vault navigation

low, bug, v1 should, size S, confirmed. `app/src/components/VaultMarkdown.tsx:52`

**Evidence.** Only vault: hrefs are intercepted (35-51). Everything else becomes `<a href={href} target="_blank" rel="noreferrer noopener">` (52-56), including relative links like `[Plan](projects/Plan.md)`, which Obsidian writes when "Use [[Wikilinks]]" is off and which models commonly produce. Electron drops non-http window opens (main.ts:614-617), so such links do nothing.

**Impact.** Notes imported from Obsidian (markdown-link mode) or written by an agent in standard markdown lose their navigation, and those links are missing from Linked mentions.

**Proposed fix.** Treat relative hrefs ending in .md (or without a scheme) as vault links: resolve them against the current note's folder, then through resolveWikilink, and include them in backlinks and the link index (ui-17).

**Verifier.** Reproduced: `[Plan](projects/Plan.md)` renders `<a href="projects/Plan.md" target="_blank" rel="noreferrer noopener">` even when projects/Plan.md exists in paths. main.ts:614-617 denies any non-http(s) window open, so on desktop the link does nothing. backlinksTo only scans WIKILINK, so such links are also absent from Linked mentions.

### [ui-24] Losing team access mid-edit can write a team note's pending text into the personal vault

low, bug, v1 should, size S, confirmed. `app/src/screens/VaultScreen.tsx:125`

**Evidence.** `useEffect(() => { if (team && !teamAvailable) void setVaultScope('personal'); }, ...)` (125-127) neither flushes nor cancels the pending debounced save. setVaultScope clears vaultNote without unmounting the screen (store.ts:5959), so the 600ms timer still fires `void vaultSave(path, text)` (203-206). vaultSave resolves its target at fire time through `vaultTarget()`, which reads `st.vaultScope` (store.ts:3001-3012, 6096), now 'personal'.

**Impact.** If the session expires or the org role changes while a person is typing in a team note, their last keystrokes (the full note body) can land as a new note in their personal vault at the same path, a cross-scope copy of shared content. This is the same bug class as the fixed DL-1.

**Proposed fix.** Call cancelSave() (or flushSave() while the scope is still team) before setVaultScope in that effect, and capture the target resource in scheduleSave so a queued write can never change destination.

**Verifier.** The effect at 125-127 calls setVaultScope('personal') with no flush or cancel. setVaultScope clears vaultNote without unmounting (store.ts:5959). The pending timer (203-206) fires vaultSave, which resolves vaultTarget() at call time (6096 -> 3001-3012) and now targets personal. If a personal note exists at the same path, it is overwritten, which is worse than the stated copy. It needs team availability to drop within 600ms of a keystroke, so it is rare.

### [ui-M1] Team vault: list() advances the base revision under a stale open draft, so a teammate's edit is overwritten silently with no conflict copy

high, data-loss, v1 must, verifier-found. `app/src/lib/gitos/orgVault.ts:102`

**Evidence.** list() runs `for (const r of rows) baseRev.set(revKey(resourceId, r.path), r.rev);` (orgVault.ts:102), and stat() does the same (114). write() sends that as p_base_rev (131-137). The server copies aside only when `existing.rev is distinct from p_base_rev` (0010_org_vault.sql:94-97). The store calls list() after every vaultSave (store.ts:6107), in vaultReadAll on every note open (6157), and in vaultRefresh on every foreground (VaultScreen.tsx:237). The open draft is never re-read (ui-1). Scratch test with a mocked PostgREST implementing the RPC rule: A reads n.md (rev 1). B saves 'v1 + B edit' (rev 2). A calls list(), then writes its stale draft. Server result: [["n.md","v1 + A keystroke"]], with no conflict copy.

**Impact.** On the team vault, the one place built for concurrent writers, a teammate's edit disappears with no conflict file and no sign on either screen whenever the other person's app refreshes the list first. That happens on every foreground, every save and every note open. The server-side conflict protection the org tier was designed around (DECISIONS: 'LWW plus conflict copy') is largely bypassed by the client.

**Proposed fix.** Advance baseRev only when the body is actually read (read()) or written (write() return), never in list() or stat(). Better, carry the rev on vaultNote and pass it explicitly into write so the base always matches the text on screen. Pair this with the ui-1 reload/resolve banner. Add an orgVault test: read, remote bump, list, stale write, expect a conflict copy.

### [ui-M2] Notes the agent or a routine writes with characters the app's normalizer strips (# [ ] ^ : etc.) cannot be opened: the room opens an empty note at a different path

medium, bug, v1 must, verifier-found. `app/src/state/store.ts:6004`

**Evidence.** The tree passes the raw listed path (VaultScreen.tsx:801 `openNote(e.path)`), but vaultOpen re-normalizes it: `const normalized = normalizeNotePath(path)` (store.ts:6004), and normalizeNotePath strips `[<>:"|?*#^[\]]` (vault.ts:78). Scratch: 'Crew/PR #42 check/2026-09-05 06-00.md' becomes 'Crew/PR 42 check/...', 'Decision: use SQLite.md' becomes 'Decision use SQLite.md', and 'Notes [draft].md' becomes 'Notes draft.md'. The listed lookup (6011-6013) then misses, read() returns undefined with known=false, and 6037-6039 opens an empty note at the rewritten path. The engine's vaultWrite normalizer keeps these characters (os-code/src/core/tools/vault.ts:24-33), and routine folder names strip only `\/:*?"<>|` (scheduler.ts:635-641), so a routine named with '#' or brackets hits this.

**Impact.** On the desktop folder vault, the notes the agent and routines write, which are the shared-context feature's point, show in the tree but open blank. Typing there forks a second note. Delete from that view removes nothing but still toasts 'Note deleted.'

**Proposed fix.** In vaultOpen, match the listed path exactly first and fall back to normalization only for user-typed names. Share one path rule between app and engine (os-code/protocol), so the agent's vaultWrite and routine safeName produce names the app can link. Add a store test that opens an agent-written 'a: b #1.md'.

## Engine vault tools, permissions, routines

The engine side of Vault is safe but thin. It has three jailed tools over ~/OSCode/Vault: vaultRead, vaultList, and vaultWrite, which always asks. Alongside them are a hard-scoped, auto-allowed projectMemoryWrite that keeps five notes in the repo (not in the vault, despite stale comments) and a scheduler that drops Crew run notes into Crew/&lt;routine>/. It does not meet the ask yet. Out of the box the agent's vault and the vault the person sees are different stores: the app defaults to a sealed Local store, the phone has no daemon route to ~~/OSCode/Vault, and the engine cannot reach iCloud, Drive, or the team vault. No vault content ever enters a model's context. On the reference box's 7B (small class) the vault tools and projectMemoryWrite are cut from the tool menu entirely. The model-facing surface has no search, no Obsidian link resolution, no backlinks, no section reads, no frontmatter awareness, and an uncapped list, so it cannot help models 'move faster and smarter'. There are also real defects. Members on a shared hub silently read the owner's vault, including other members' Crew notes. A project os-code.config.json can point vault.dir anywhere, and '~~' is not expanded. Replace-mode writes silently drop edits made while the approval is pending. Note-name normalization differs from the app's. Routine note titles are malformed ('2026:09-26 at 06-00'). Proposed v1 order: (1) one store and safe roots (engine-1/2/3); (2) visible to every seat and present in context through a budgeted retrieval-first block, measured with osc eval (engine-4/5); (3) an Obsidian-grade vault core shared with the app, plus a matching tool set (engine-6/7/8/9); (4) sane write UX, structured Crew notes, and customization settings (engine-10/11/15); (5) honest copy until each of these lands (engine-14).

**What is solid:**

- Path containment is sound: every vault path resolves through Jail with deepest-ancestor realpath, so '../' and symlink escapes are refused (os-code/src/core/tools/vault.ts:16-20, os-code/src/core/security/jail.ts:29-41; test os-code/test/vaultTools.test.ts:56-61). Absolute paths are made relative by the split/filter in normalizeNotePath.
- The 'never silent' write guarantee is built into the code structure, not left as a convention: alwaysAsk returns 'ask' before session grants, rules, and trusted repos (os-code/src/core/permissions/index.ts:155-157). The loop refuses session or project grants for it and keeps it loud in acceptEdits and bypass modes (os-code/src/core/agent/loop.ts:1102, 1143-1159). Test: os-code/test/vaultTools.test.ts:79-90.
- vaultWrite shows a unified-diff preview with create/update/append verbs and +/- stats, and append mode re-reads the file at execute time, so appends never clobber (os-code/src/core/tools/vault.ts:57-63, 87-114).
- Project memory is well built: a hard-scoped projectMemoryWrite can only write five presets inside 'OpenShore Project &lt;name> MDs/' and seeds the full set. The permission engine auto-allows only that exact shape, and the files ride into commits with the code (os-code/src/core/tools/projectMemory.ts:38-44, 56-66; os-code/src/core/agent/projectMemory.ts:199-205; os-code/src/core/permissions/index.ts:170-172).
- The Crew scheduler writes its own run note deterministically, so an unattended run never has to approve its own record. The phone reads it back through an owner-scoped route (os-code/src/routines/scheduler.ts:582-614; os-code/src/daemon/serve.ts:785-792).
- The Hermes notes host is a good model for the vault tools to copy: allowlisted shapes, jailed, a size cap with an honest message, admin-only on a shared hub (os-code/src/currents/host.ts:88-131; os-code/src/daemon/serve.ts:880-900).
- On the desktop, the app's 'This folder' provider really does share the agent's folder through jailed Electron IPC, so Obsidian, the app, and the agent can all open ~/OSCode/Vault (app/electron/main.ts:916-966; app/src/lib/gitos/deviceFolder.ts).
- Dot folders such as .obsidian are skipped by the list walk, and symlinked entries are not followed, so there are no walk loops (os-code/src/core/tools/vault.ts:142-152).

### [engine-1] Out of the box the agent's vault and the person's vault are different stores; the phone and the cloud providers never meet the engine

high, gap, v1 must, size L, confirmed. `app/src/state/store.ts:555`

**Evidence.** App default provider: `return settings.gitosResources?.find((r) => r.id === VAULT_RESOURCE_ID)?.providerId ?? 'local';` (store.ts:555-556), and vaultRefresh seeds `providerId: 'local'` (store.ts:5972-5976). Engine root: `const vaultRoot = config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault');` (os-code/src/core/agent/registry.ts:145). The 'files' provider that bridges the two exists only on Electron (`platform() === 'electron' && typeof bridge()?.vaultList === 'function'`, deviceFolder.ts:18-20), and nothing in the app switches to it automatically (a grep for providerId 'files' finds no hits). The daemon has no vault route: grep of serve.ts finds only /routines/runs/:id/note and /currents/hermes/notes. No app chat driver references the vault (app/src/drivers/*: no matches).

**Impact.** A person on the desktop asks the agent to save a note, opens Vault, and the note is not there: it is in ~/OSCode/Vault while the screen shows the sealed Local store. A paired phone can never see the agent's notes. Phone, local, and cloud chats (StackDriver) never see any vault. The engine cannot read notes kept on iCloud, Google Drive, or the team vault. Knowledge does not carry across models or surfaces, which is the core of the ask.

**Proposed fix.** (a) On Electron, default the personal vault to 'files', and migrate existing Local notes once with the existing vaultMoveTo, which already writes conflict copies (app/src/state/store.ts vaultRefresh). (b) Add owner-scoped daemon routes GET /vault/notes, GET/PUT/DELETE /vault/notes/&lt;path> in os-code/src/daemon/serve.ts, backed by the same jailed helpers. Add a 'hub' StorageProvider (app/src/lib/gitos/hub.ts) so a paired phone's Vault can live on 'My computer'. (c) Add an app-side vault tool (read/search/list, write behind the same approval sheet) following app/src/lib/codemagicTool.ts, wired into app/src/drivers/stackDriver.ts for both Anthropic and OpenAI shapes, and reading through vaultTarget(). Then phone and cloud chats see the same notes. (d) Later: engine access to the team vault using the member's Supabase token.

**Verifier.** Checked store.ts:554-556 (vaultProviderId defaults to 'local') and store.ts:5963-5976 (vaultRefresh auto-registers vault.personal with providerId 'local'). The only mentions of 'files' are the roster/provider definitions (providers.ts:111, deviceFolder.ts:31, gitos/index.ts:38). Nothing switches the vault to it; the only path is a manual vaultMoveTo from the storage sheet (VaultScreen.tsx:888). The Local provider is the sealed KV store (providers.ts:8-9), which the engine cannot reach. registry.ts:145 roots the engine at config vault.dir or ~/OSCode/Vault. No file in os-code/src/daemon/ mentions vault, and app/src/drivers/* has no vault references. One small overstatement: a paired phone CAN see Crew run notes, which live in the engine vault, through GET /routines/runs/:id/note (serve.ts:785-793, owner/admin scoped). It still cannot see anything vaultWrite saved. The gap is real and central to the ask.

### [engine-2] Shared-hub members' agents silently read, and can write, the machine owner's vault, including other members' Crew notes

high, security, v1 must, size M, confirmed. `os-code/src/daemon/serve.ts:956`

**Evidence.** Member sessions are bootstrapped with the same registry: `if (!hasRole(auth, 'admin') && !isAdminProvisionedWorkspace(cwd)) {...} const { driver, warnings } = bootstrapSession({ cwd, profile: 'remote-attached', ... })` (serve.ts:956-975). buildToolRegistry registers vaultRead/vaultList/vaultWrite unconditionally (registry.ts:86-88) over one machine-wide root (registry.ts:145). The read risk defaults to allow (permissions/index.ts:83). By contrast, routine notes are owner-scoped (`admin || scheduler.get(routineId)?.ownerUserId === auth.userId`, serve.ts:777-778). Hermes memory is admin-only because it is 'the machine owner's own agent memory ... like every other machine-wide surface on a shared hub' (serve.ts:881-891). Crew notes of every owner land in the same Crew/ folder (scheduler.ts:591).

**Impact.** On an org hub, any member's agent can vaultList and vaultRead the owner's personal notes and every other member's routine results without a prompt. That bypasses the owner scoping the /routines route enforces. The member can also approve their own vaultWrite into the owner's vault, for example to plant text the owner's agent later reads as context.

**Proposed fix.** Thread the caller's role and userId into bootstrapSession, then buildToolContext. Admin/owner sessions use ~~/OSCode/Vault. Members get a per-user root (~~/OSCode/Vaults/&lt;userId>/) or no vault tools at all. Write Crew notes into the routine owner's vault (scheduler.ts writeNote and readNote). Add a daemon test proving a member session's vaultList cannot see the owner's notes or another member's Crew notes.

**Verifier.** serve.ts:956-975: after the provisioned-workspace check, member sessions go through bootstrapSession with no role or userId. bootstrap.ts has no member, role, or owner logic (grep empty). registry.ts:86-88 registers vaultRead, vaultList, and vaultWrite unconditionally over one machine root (registry.ts:145). DEFAULT_PERMISSIONS.read is 'allow' (permissions/index.ts:83), and the remote-attached profile only gates shell, cloud, and push. The session's approvals go to its owner, so a member approves their own vaultWrite. Contrast: hermes notes need requireAdmin (serve.ts:890-891) and run notes are owner-scoped (serve.ts:776-778). One correction: POST /routines is requireAdmin (serve.ts:795-802), so members never own routines. The Crew notes a member can read are therefore the admins' and owner's, not 'other members''. The bypass of the route's scoping still holds.

### [engine-3] vault.dir can be set by a project os-code.config.json, is not tilde-expanded, and is resolved from different cwds by different processes

high, security, v1 must, size S, confirmed. `os-code/src/config/load.ts:84`

**Evidence.** Only the daemon block is stripped from project config: `if (path === projectPath && isPlainObject(value) && 'daemon' in value) { const { daemon: _ignored, ...rest } = value; ...}` (load.ts:84-90). vault.dir passes through, and bootstrap loads config per cwd (bootstrap.ts:116). Scratch proof: a repo with os-code.config.json {vault:{dir:&lt;outside>}} gave loadConfig(repo).config.vault.dir === outside with no warning, and vaultRead({path:'private/diary'}) returned 'secret diary'. `new Jail('~/Documents/Obsidian').root` resolved to '/home/user/openshore.code.ai/os-code/~/Documents/Obsidian'. Routine notes use `loadConfig()` (process cwd, scheduler.ts:681-684), and Electron uses `loadConfig()` from its own cwd (app/electron/main.ts:920-925). vaultJail calls mkdirSync on the root even for reads (vault.ts:18).

**Impact.** A cloned repo can silently widen the agent's no-prompt read reach to any .md file on disk: vault.dir '/' or the home dir makes vaultList walk the whole tree synchronously. With web tools allowed by default (egress webEnabled true, empty allowlist) a prompt-injected repo has an exfiltration path. This is the same threat class DAE-9 closed for daemon.*. A person who types '~~/Obsidian' to point OpenShore at their real vault gets a literal '~~' folder, or an EACCES error. The routine agent, the scheduler, and the desktop app can each resolve a different vault.

**Proposed fix.** Treat vault like daemon: machine config read only from the global file through a loadVaultDir() helper in os-code/src/config/load.ts that expands a leading '~', requires an absolute path, and warns in doctor. Use that one helper in registry.ts, scheduler.ts defaultVaultRoot, and app/electron/main.ts vaultDir. Drop vault.* from project config with the same one-line warning as daemon.*. Stop creating the root on read-risk calls. Add tests next to the DAE-9 test.

**Verifier.** load.ts:84-90 strips only 'daemon' from project config, and bootstrap.ts:113-116 loads config per cwd. There is no tilde expansion anywhere in os-code/src or app/electron (grep empty), and Jail's constructor does resolve(root), so '~~/x' becomes '&lt;cwd>/~~/x'. scheduler.ts:681-684 and electron main.ts:920-925 call loadConfig() with process cwd. vault.ts:18 runs mkdirSync on every call, reads included. My scratch test confirmed loadConfig(repo).config.vault.dir === outside with no warning. It also showed the case is WORSE than reported: with vault.dir pointed at a home dir, vaultWrite({path:'.claude/CLAUDE.md'}) wrote that file, because normalizeNotePath keeps dot segments and folders. On a shared hub a member can commit this config to a provisioned workspace and self-approve writes to any .md under the redirected root, for example agent-instruction files. Caveat on the desktop framing: on local-interactive, project config is already trusted to run harness.verify.command with no prompt (verify.ts:9-12, profiles.ts:26). So a hostile cloned repo gains little new there. The real escalation is the hub (remote-attached), the same class as DAE-9.

### [engine-4] Small and tiny seats (the reference box's 7B) never see any vault tool or projectMemoryWrite, yet the lean prompt tells them to use projectMemoryWrite

high, bug, v1 must, size S, confirmed. `os-code/src/core/agent/loop.ts:139`

**Evidence.** SMALL_MODEL_TOOL_PRIORITY is readFile, editFile, writeFile, grep, glob, searchRepo, runShell, todoWrite, gitDiff, gitStatus, webFetch, webSearch, readTerminal (loop.ts:139-153). The small class shows 10 tools and tiny shows 6 (os-code/src/harness/profile.ts:72, 83), and a 7B derives to 'small' (profile.ts: `if (paramsB < 8) return 'small'`). The project-memory block is pushed for every seat: `if (memorySeg) parts.push(projectMemoryPrompt(memorySeg));` (loop.ts:514-515). Scratch proof with profiles on: the tools sent were exactly [readFile, editFile, writeFile, grep, glob, searchRepo, runShell, todoWrite, gitDiff, gitStatus], and the system prompt contained 'projectMemoryWrite'.

**Impact.** On the founder's own reference machine (CPU-only, a 7B), the agent can neither read nor write the vault, and it is told to call a memory tool it was never offered. Project memory goes stale or produces calls to an unlisted tool. The floor seat, where carrying context between models matters most, gets nothing.

**Proposed fix.** Give lean seats memory mechanically, not by hoping (tenet 3). Reserve slots for projectMemoryWrite and one merged 'vault' tool (an action enum of read/search/list) in SMALL_MODEL_TOOL_PRIORITY, or send projectMemoryPrompt only when the tool is actually shown. Better, inject the Current State top sheet and a vault retrieval block for lean seats (see engine-5) so they need no call. Guard this with a test in os-code/test/harnessLoopProfile.test.ts, and put a with/without number in osc eval on the reference box before claiming it (tenet 2).

**Verifier.** harness.profiles.enabled defaults to true (schema.ts:285-289). A '7b' model id derives to 'small' (profile.ts: paramsB < 8), and small shows maxToolsShown 10 (profile.ts POLICY). limitToolSpecs (loop.ts:1476-1486) ranks by SMALL_MODEL_TOOL_PRIORITY (loop.ts:139-153). All ten of its top entries are registered (registry.ts:54-83), so vaultRead, vaultList, vaultWrite, and projectMemoryWrite are always cut, and tiny (6) loses them too. loop.ts:514-515 still pushes projectMemoryPrompt for lean seats, and its text names the projectMemoryWrite tool (projectMemory.ts:228). The registry would execute an unlisted call, but the model is never offered it, and constrained decoding for small seats makes the call unlikely. This hits the reference 7B.

### [engine-5] No vault content ever reaches a model's context: no retrieval-first step, no pinned notes, no vault map, and the system prompt never mentions the vault

high, gap, v1 must, size L, confirmed. `os-code/src/core/agent/loop.ts:464`

**Evidence.** systemPrompt() assembles the core, plan mode, standing instructions, projectMemoryPrompt, secrets, UX/humanizer, and chain of thought (loop.ts:464-560). No part reads the vault. Scratch proof: a full seat's system prompt was 14,006 chars and /vault/i did not match. projectMemoryPrompt makes the model spend a tool call to open Current State: 'Open "&lt;folder>/Current State.md" ... before you start' (projectMemory.ts:222). The context layer already has root-agnostic retrieval: RepoIndex(root, embedder, model) and keywordSearch(root, query, k) (os-code/src/context/index.ts:34, 197).

**Impact.** The app promises the agent 'reads your notes back when it works, so it remembers how you like things done', but a model only sees the vault if it decides to call vaultList and vaultRead, and small seats cannot (engine-4). Every session, and every model switch, starts cold apart from the repo memory, and each extra round trip costs real time at 3 to 7 tokens per second.

**Proposed fix.** Add a harness-built vault context block under a per-class token budget, behind config (vault.context: 'auto' | 'off') and measured with osc eval. It would carry (1) pinned notes the person picks (for example 'About me.md', via vault.pinned); (2) a compact vault map with top folders, counts, and the N most recent titles; (3) retrieval-first: keyword or embedding search of the vault against the task, using context/index.ts rooted at the vault with a separate index dir, injecting the top-k path, heading, and snippet; (4) for lean seats, the Current State top sheet inlined instead of a readFile turn. Also write a short handoff note (task, decisions, open threads) into project memory or the vault when a session compacts or ends, so the next model on any surface picks up where this one stopped. Under egress lockdown, use keyword retrieval only.

**Verifier.** systemPrompt (loop.ts:464-560) assembles the core, plan, standing instructions, project memory, secrets, UX/humanizer, CoT, and code map. The only 'vault' string in loop.ts is a comment at 1054, and no engine module reads the vault into context. RepoIndex keys its index dir by a hash of the root (context/index.ts:40-46), and keywordSearch(root, ...) takes any root, TEXT_EXT including .md. So the retrieval building blocks exist and can be re-rooted as proposed. Vault content reaches a model only if it chooses to call the tools, which lean seats cannot (engine-4).

### [engine-6] The model-facing vault tools are too thin for a knowledge base: no search, no Obsidian link resolution, no backlinks, no section reads, no frontmatter or tags

medium, gap, v1 must, size L, confirmed. `os-code/src/core/tools/vault.ts:117`

**Evidence.** vaultRead takes only `path`, and a miss returns `No vault note at ${rel} yet.`, which the description follows with 'you may then propose creating it with vaultWrite' (vault.ts:117-136). Probe: with Projects/Ideas.md present, vaultRead({path:'Ideas'}) returned 'No vault note at Ideas.md yet.'. Obsidian, and the app's resolveWikilink (app/src/lib/vault.ts:89-103), resolve a bare [[Ideas]] to a unique filename anywhere in the vault. vaultList returns only 'path (Nb)', with no mtime, title, or tags (vault.ts:149). There is no vaultSearch or backlinks tool. The app already has parseWikilinks, resolveWikilink, backlinksTo, and searchNotes as pure functions (app/src/lib/vault.ts), but the engine cannot import app code.

**Impact.** A model cannot find a note without listing everything and reading notes one by one. Following an Obsidian link to a note in a subfolder fails, and the tool text nudges the model to create a duplicate. It cannot see what links to a note, read one heading of a long note, or filter by tag or recency. That is the opposite of 'move faster and smarter'.

**Proposed fix.** Move the pure vault core (wikilink parse and resolve, backlinks, search, frontmatter, headings) into os-code/src/vault/core.ts, export it through os-code/protocol (as chainOfThought.ts is), and have app/src/lib/vault.ts re-export it, with a parity test. Then extend os-code/src/core/tools/vault.ts. vaultSearch(query, folder?, tag?, k) returns path, heading, and snippet. vaultRead resolves by name, accepts heading or startLine/endLine, and returns a short header (title, frontmatter keys and tags, outgoing links, size). vaultList gains folder, depth, limit, sort (name or recent), and titles and tags. Add vaultBacklinks(path). Write tool descriptions that teach a model the search, then read-a-section, then follow-links workflow.

**Verifier.** vault.ts:117-136: vaultRead takes only path and normalizes it to an exact .md path. My scratch test confirmed vaultRead({path:'Ideas'}) with Projects/Ideas.md present returns 'No vault note at Ideas.md yet.'. vaultList returns 'path (Nb)' only (vault.ts:149). There is no search, backlinks, or section tool in os-code/src (grep). The agent's grep, glob, and searchRepo are jailed to the workspace cwd, so they cannot search the vault either. The app has parseWikilinks, resolveWikilink, backlinksTo, and searchNotes as exported pure functions (app/src/lib/vault.ts:21, 89, 106, 184). The gap is real against the Obsidian baseline.

### [engine-7] vaultList output is uncapped and its walk is synchronous; vaultRead has no size or binary guard and crashes on a folder named like a note

medium, perf, v1 must, size S, confirmed. `os-code/src/core/tools/vault.ts:169`

**Evidence.** `return { ok: true, content: notes.join('\n') };` with no capContent (vault.ts:169), while glob caps its output (glob.ts:32: `capContent(matches.join('\n'))`). Scratch proof: 1,500 notes produced an 82,139-char observation. walk() is a recursive readdirSync/statSync with no entry limit (vault.ts:142-152). vaultRead calls `capContent(readFileSync(abs, 'utf8'))` (vault.ts:134) with no stat size check or binary sniff; readFile has both (readFile.ts:35-43: >2MB refused, 'looks binary'). A directory named 'Weird.md' made vaultRead throw EISDIR (scratch F).

**Impact.** Pointing OpenShore at a real Obsidian vault floods a small seat's context with one call (tiny compacts at 60% of its window). A large or network-mounted vault (iCloud, Drive File Stream) blocks the daemon's event loop for every session and SSE stream. A huge .md is read fully into memory before capping. The model gets an error it cannot act on, not a clear message.

**Proposed fix.** In vault.ts: cap and paginate the list (limit plus a 'N more, narrow with folder' line); walk asynchronously with an entry ceiling; stat before reading, apply readFile's size and binary guards with the same honest messages, and check isFile(). Add cases to os-code/test/vaultTools.test.ts.

**Verifier.** vault.ts:169 returns notes.join('\n') with no capContent, while glob.ts:32 caps. pushObservation (loop.ts:1332-1342) adds no cap either, so the whole list enters history. walk() (vault.ts:142-152) is recursive readdirSync/statSync in the daemon process, which hosts sessions in-process. vaultRead (vault.ts:133-134) has no stat, size, binary, or isFile check, unlike readFile.ts:29-43. My scratch test confirmed a directory named 'Weird.md' makes vaultRead reject with EISDIR. Nuance: that is not a process crash. The loop's try/catch turns it into a 'vaultRead crashed: EISDIR...' observation. The default ~/OSCode/Vault starts small, so the flood matters once a real Obsidian vault is pointed at. That is the headline use case, so must, S.

### [engine-8] A replace-mode vaultWrite silently drops edits made after the preview: the diff the person approved is not what lands

medium, data-loss, v1 should, size S, partial. `os-code/src/core/tools/vault.ts:100`

**Evidence.** preview computes the diff against the file at preview time (vault.ts:87-99). execute re-reads `before` but writes `after = applied(before, args.content, 'replace')`, which is just args.content (vault.ts:100-107), with no staleness check. Probe: the preview showed '-v1 line +agent rewrite'. Before execute, the file gained 'person added this while approval was pending'. After execute the file was exactly 'agent rewrite\n', and the person's line was gone with no warning.

**Impact.** Approvals can sit for minutes on a phone, and the same folder is edited live by Obsidian and the app's 'This folder' provider (documented as last-write-wins). An approved agent rewrite can delete what the person just typed, and the transcript diff misrepresents the change.

**Proposed fix.** Record a content hash in preview and pass it through to execute (or re-derive and compare). When the note changed since preview, refuse with 'the note changed since you approved; read it again', or re-ask. Add an optional expectedHash, returned by vaultRead, for optimistic concurrency on replace. Test both paths in vaultTools.test.ts.

**Verifier.** Mostly holds. preview (vault.ts:87-99) diffs against the file at preview time. execute (vault.ts:100-107) writes args.content for replace with no staleness check. My scratch test confirmed an edit made between preview and execute is silently dropped, and the approval card's detail never showed it. One part is wrong: the post-run tool-end diffText is recomputed against the real 'before' (vault.ts:108), so the transcript's result diff DOES show the deleted line. Only the approval card misrepresents the change. Append mode re-reads and is safe. The race needs an edit to the same note during the approval window, and writeFile has the same general pattern. So should, not must.

### [engine-9] Note-name normalization differs across the engine, the scheduler, and the app (NFC, Obsidian link characters, Windows-illegal characters)

medium, bug, v1 should, size S, confirmed. `os-code/src/core/tools/vault.ts:24`

**Evidence.** The engine only trims and collapses separators (vault.ts:24-34). The app NFC-normalizes and strips `[<>:"|?*#^[\]]` plus '.' and '..' segments (app/src/lib/vault.ts:68-83). The scheduler has a third rule, safeName, which strips `[\\/:*?"<>|]` but not #^[] and does not apply NFC (scheduler.ts:635-641). Project memory has a fourth (projectMemory.ts:140-150). Scratch proof: vaultWrite created 'Ideas [draft]#1.md' and two distinct 'Café.md' files (NFD and NFC), and vaultRead of the NFC name returned only one of them.

**Impact.** Notes the agent names naturally ('Meeting: Auth', 'Issue #42') can never be wikilinked from the app or Obsidian: the app resolves [[Meeting: Auth]] to 'Meeting Auth.md', shows it as unresolved, and tapping it creates a duplicate. Accented names fork into two notes across devices and filesystems. On Windows, ':' in a name writes an NTFS alternate data stream.

**Proposed fix.** Keep one normalizer in os-code/src/vault/notePath.ts, exported through os-code/protocol, and use it in vault.ts, scheduler.ts safeName (for the folder), and app/src/lib/vault.ts, with a parity test like projectMemory's. Tell the model in the vaultWrite description which characters are dropped, and report the final path it saved.

**Verifier.** Engine normalizeNotePath (vault.ts:24-34) only trims and collapses. It applies no NFC, no stripping of : # ^ [ ] < > " | ? _, and no dropping of '.' segments. The app's version (app/src/lib/vault.ts:68-83) does NFC and strips [<>:"|?_#^[\]]. Scheduler safeName (scheduler.ts:635-641) and projectMemory sanitizeFolderSegment (projectMemory.ts:140-150) differ again. So an agent-written 'Meeting: Auth.md' can never be matched by the app's resolveWikilink, whose normalize gives 'Meeting Auth.md' (exact and basename both miss), and tapping the link creates a duplicate. Obsidian itself forbids ':' in names and '#^[]|' in link targets.

### [engine-10] Always-ask with no scoped middle ground makes append-style memory impractical; a configured deny cannot deny it; unattended routines stall on it

medium, ux, v1 should, size M, confirmed. `os-code/src/core/permissions/index.ts:155`

**Evidence.** `if (q.alwaysAsk) { return { decision: 'ask', ... } }` runs before the rules loop (permissions/index.ts:155-157), so `{tool:'vaultWrite', decision:'deny'}` still prompts. The loop blocks session and project grants and mode overrides for it (loop.ts:1102, 1143-1159). A routine waits 15 minutes before a decline (`DEFAULT_APPROVAL_TIMEOUT_MS = 15 * 60_000`, scheduler.ts:55) against a 20-minute default cap (routines/model.ts:108). routineInstructions never mentions that vault writes ask (scheduler.ts:111-120), while the vaultWrite description invites recording 'decisions, findings, plans'.

**Impact.** An agent that should jot one line per insight interrupts the person every time, so in practice the vault stays empty. An admin cannot turn agent vault writes off. An edit-access routine that reaches for vaultWrite burns about 75% of its clock waiting on a phone.

**Proposed fix.** Keep never-silent as the default (it is a founder ruling). (a) Evaluate deny rules before the alwaysAsk short-circuit. (b) Put a founder decision up: an append-only 'agent inbox' exception (for example vault.agentFolder, default 'Agent/'), hard-scoped like projectMemoryWrite and shown as a card, or one batched approval card per task for all vault writes. (c) Either leave vaultWrite out of headless registries (the scheduler note already carries the result) or say in routineInstructions that it asks and may time out.

**Verifier.** permissions/index.ts:155-157 returns 'ask' for alwaysAsk before the rules loop. My scratch test confirmed a {tool:'vaultWrite', decision:'deny'} rule still yields 'ask'. loop.ts:1102 and 1143-1159 block mode overrides and session or project grants for alwaysAsk tools. Edit routines run acceptEdits (scheduler.ts:421), which does not cover alwaysAsk, so a vaultWrite waits DEFAULT_APPROVAL_TIMEOUT_MS = 15 min (scheduler.ts:55, 485-496) against defaultMinutes 20 (model.ts:108). routineInstructions (scheduler.ts:117) mentions only shell approvals. Nuance: routines must run a local orchestrator, and a small or tiny local seat never sees vaultWrite (engine-4), so the stall hits mid and large local seats only. The DECISIONS ruling 'agent writes ... never silent' (DECISIONS.md:102-104) stands, so (b) is correctly framed as a founder call.

### [engine-11] The Crew routine note has a malformed title, no frontmatter or links, a non-linkable session id, and can collide within a minute

low, bug, v1 should, size S, partial. `os-code/src/routines/scheduler.ts:595`

**Evidence.** `# ${active.routine.name}: ${stamp.replace(' ', ' at ').replace('-', ':')}`, where stamp is 'YYYY-MM-DD HH-MM'. The first '-' is in the date: node gives '2026:09-26 at 06-00'. No test pins the title (routines.test.ts:273-280 checks the path, body, and session only). The body is a plain line `Crew: ... · session ${active.driver.id}` with no YAML frontmatter, tags, wikilinks to the previous run or project memory, or record of the model that ran it (scheduler.ts:594-610). `writeFileSync(abs, ...)` has no existence check (scheduler.ts:612), so two runs started in the same minute overwrite each other. routineInstructions does not tell the agent its earlier notes exist.

**Impact.** Every Crew note's heading reads wrong in the Vault and in Obsidian. The notes cannot be queried (Dataview, tags), linked into a timeline, or traced to the model that wrote them. A routine cannot build on yesterday's findings unless the model happens to list Crew/.

**Proposed fix.** Format the title from the Date ('2026-09-26 at 06:00'). Add frontmatter: type: crew-run, routine, crew, workspace, project, state, started, minutes, session, model, tags. Link [[&lt;previous run>]] and the project's Current State. Add a unique suffix on collision. Add one line to routineInstructions pointing at Crew/&lt;routine>/ with vaultRead. Pin the title and frontmatter in os-code/test/routines.test.ts.

**Verifier.** The title bug is confirmed: node gives '2026:09-26 at 06-00' for the scheduler.ts:595 expression. routines.test.ts:273-280 pins the path, body, session, and steps but not the title. The note has no frontmatter, tags, links, or model (scheduler.ts:594-610), and writeFileSync at :612 has no existence check. The collision is an edge case: runNow refuses while the routine is active or queued (scheduler.ts:329-336), so an overwrite needs a run to finish inside one minute and then run again. When it happens, the first run's notePath silently points at the second run's content. The heading bug is cosmetic, but every Crew note has it. Missing frontmatter is a feature gap. Severity is lower than reported.

### [engine-12] Vault writes count as workspace writes: they trigger verify and the Jev judge, and best-of-N does not restore them

low, bug, v1 later, size S, partial. `os-code/src/core/agent/loop.ts:1196`

**Evidence.** `if (result.ok && tool.risk === 'write') this.wroteThisTask = true;` (loop.ts:1196) also covers vaultWrite. maybeVerify runs the project check whenever wroteThisTask is set (loop.ts:340) and retries on failure. maybeJevJudge spends a cloud call on it (loop.ts:394). recordOriginal is skipped for `pathJail === 'own'` (loop.ts:1177), so restoreTouched on a fresh attempt leaves vault appends in place.

**Impact.** In a project with harness.verify set, 'save this to my vault' runs the test suite. If tests are already failing, the model is told to fix them, which is scope creep. A cloud seat with Jev on pays for judging a note. A fresh attempt duplicates an append.

**Proposed fix.** Track vault writes separately in loop.ts (for example vaultWroteThisTask when tool.pathJail === 'own') and exclude them from the verify and judge triggers. Record vault originals (keyed under ctx.vaultRoot) so restoreTouched covers them.

**Verifier.** The verify and judge part holds. loop.ts:1196 sets wroteThisTask for any successful write-risk tool, vaultWrite and projectMemoryWrite included. maybeVerify (loop.ts:338-341) and maybeJevJudge (loop.ts:392-396) key off it, and loop.ts:1177 skips recordOriginal for pathJail 'own'. The best-of-N part is unreachable with defaults. startFreshAttempt runs only after a failed verify with bestOfAttempts > 1, which only tiny and small have (profile.ts POLICY), and those seats are never shown vaultWrite (engine-4). Mid and large have bestOfAttempts 1. Verify also needs harness.verify.command and a shell-auto-approve profile. Real, but minor.

### [engine-13] Stale comments put project memory under Projects/&lt;project>/ in the vault; the plan-mode prompt omits vault reads

low, docs, v1 later, size S, confirmed. `os-code/src/core/tools/index.ts:63`

**Evidence.** 'The project-memory tool derives its Projects/&lt;project>/ folder from this' (tools/index.ts:63-66). 'to place the project's memory notes under Projects/&lt;project>/ in the vault' (bootstrap.ts:47-50). 'only a managed memory file under Projects/&lt;project>/' (permissions/index.ts:164-169). The code writes '&lt;repo>/OpenShore Project &lt;name> MDs/&lt;preset>.md' (projectMemory.ts:162-172; DECISIONS 2026-09-04). The plan prompt lists readable tools without vaultRead, vaultList, or gitLog (loop.ts:502), although PLAN_SAFE_RISKS allows them.

**Impact.** Future sessions, and this review's own brief, reason from the wrong location for the auto-allow. In plan mode, models are not told they may consult the vault.

**Proposed fix.** Update the three comments to the repo-folder convention. Add vaultRead, vaultList, and gitLog to the plan-mode sentence at loop.ts:502.

**Verifier.** Stale comments confirmed at tools/index.ts:63-66, bootstrap.ts:47-50, and permissions/index.ts:164-169. registry.ts:89-92 ('five files under Projects/&lt;project>/') is a fourth. The code and DECISIONS 2026-09-04 put project memory in '&lt;repo>/OpenShore Project &lt;name> MDs/' (projectMemory.ts:162-172, DECISIONS.md:427-431). The plan-mode sentence (loop.ts:~500) omits vaultRead, vaultList, and gitLog. The effect is small, because toolSpecs in plan mode still offers every read-risk tool, vault reads included (loop.ts:1463-1470).

### [engine-14] The Vault's onboarding copy promises agent behavior the engine does not deliver by default

medium, claim-mismatch, v1 must, size S, confirmed. `app/src/screens/VaultScreen.tsx:766`

**Evidence.** 'Plain markdown notes, yours on this device. You write in them, and so does your agent as it works' (VaultScreen.tsx:732-733). 'The agent saves what it learns and reads your notes back when it works, so it remembers how you like things done' (766-767). 'The agent follows the links to find what it needs' (778-779). The starter note repeats all three (287-295). Against that: the default provider is the sealed Local store, which the agent cannot touch (engine-1); nothing injects notes (engine-5); small seats have no vault tools (engine-4); the engine cannot resolve [[links]] (engine-6).

**Impact.** This breaks the honesty-in-copy bar. A new user who follows the ramp on the default setup gets an agent that neither reads nor writes what they see.

**Proposed fix.** Make the copy true before v1 by landing engine-1, 4, 5, and 6. Until then, condition it on the vault living in 'This folder' on the computer, and say 'can' rather than 'does'. Pin the wording in a copy test once the behavior is proven.

**Verifier.** VaultScreen.tsx:732-733 and 766-767 ('The agent saves what it learns and reads your notes back when it works') and 778-779 ('The agent follows the links') are unhedged. They hold only when the vault is on the 'files' provider, a mid or large seat is on the desktop engine, and links point at exact paths, and none of that is the default (engine-1/4/6). The starter note (287-295) is partly hedged ('it can save ... and read your notes back'). It still says 'Anything you write becomes context it can use' and 'Your agent follows those links', which are false on the default Local store.

### [engine-15] Customization is one knob (vault.dir): no private folders, agent folder, pinned notes, templates, or context budget, and vaultList ignores path deny rules

medium, gap, v1 should, size M, confirmed. `os-code/src/config/schema.ts:213`

**Evidence.** `export const VaultSchema = z.object({ dir: z.string().optional() })` (schema.ts:213-220). vaultList has no pathOf (vault.ts:154-160), so a rule like {tool:'vaultRead', decision:'deny', pathGlob:'Journal/**'} blocks reads but vaultList still reveals every title under Journal/. There is no app Settings surface for any vault behavior.

**Impact.** The ask says 'fully customizable'. Today a person cannot keep a private journal out of the agent's reach cleanly, choose where the agent files notes, pick what is always in context, or set a note template, which Obsidian users expect.

**Proposed fix.** Extend VaultSchema (machine config only, see engine-3): dir, exclude (globs applied to list/read/search), agentFolder, pinned (notes for the context block), context ('auto' | 'off', plus a budget), templates (frontmatter for agent notes), dailyFolder. Apply exclude inside the vault tools, not only as permission rules. Surface these in the app's Vault 'Where it lives' sheet or Settings. Defaults must work with no setup.

**Verifier.** VaultSchema is only { dir } (schema.ts:213-220). vaultListTool has no pathOf (vault.ts:154-160), so the permission query has no path, and any pathGlob rule is skipped for it (permissions/index.ts rules loop: `if (!path || !minimatch(...)) continue`). A read deny on Journal/** therefore still lists every Journal title. No engine vault setting appears in app Settings; the app's storage sheet only chooses the provider.

### [engine-m1] The Wayfinding 'Memory' switch (Settings, default on) is inert, and its copy says project notes live in the vault

medium, claim-mismatch, v1 must, verifier-found. `app/src/lib/currents.ts:42`

**Evidence.** WAYFINDING.memory.sub = 'The agent keeps project notes in your vault and reads them back into every session there.' (currents.ts:38-42). guideCards.ts:659: 'Memory keeps what it has learned in your Vault and reads it back.' wayfindingOn is read only by SettingsScreen.tsx:989 to render the checkbox. There are no other consumers in app/src, app/electron, or os-code/src (grep 'wayfinding' in os-code is empty). BootstrapOptions, the daemon POST /sessions body, and app drivers carry no memory flag, so turning Memory off changes nothing: projectMemoryPrompt (loop.ts:514-515) and projectMemoryWrite (registry.ts:92) stay on. DECISIONS 2026-09-04 (DECISIONS.md:427-431) puts project memory in the repo, not the vault. PROGRESS.md:579-583 admits only the Browser switch gates nothing.

**Impact.** A person who turns Memory off to keep the agent from remembering gets no change. The row that is meant to be the vault/memory customization control in Settings does nothing, which cuts against both 'fully customizable' and the honesty bar.

**Proposed fix.** Wire the switch through BootstrapOptions (e.g. memory:false) to drop projectMemoryPrompt, projectMemoryWrite, and the future vault context block (engine-5), with a test like humanizer's off switch. Reword the sub to say where the notes actually live (the project's repo, shown in Vault under Coding projects) and what the vault context block does once it lands.

### [engine-m2] Vault tools skip the loop's pre-approval jail check, so an escaping vault path produces an approval card with 'Preview failed' instead of an outright deny

low, ux, v1 later, verifier-found. `os-code/src/core/agent/loop.ts:1058`

**Evidence.** `if (tool.pathJail === 'own') { path = rawPath; }` (loop.ts:1058-1059) with no jail resolution, while workspace tools are denied up front on JailViolation (loop.ts:1060-1072, ENG-3; DECISIONS.md 2026-09-05 says 'A jail violation at permission-match time DENIES outright ... an approval prompt for it is a wasted tap'). vaultWrite.preview then throws inside vaultJail().resolve (vault.ts:88-90), the loop catches it as `detail = Preview failed: ...` (loop.ts ~1125), and the approval still goes out. On approve, execute throws, and the message says 'Path leaves the workspace ... Tools only touch files under &lt;vault>' (jail.ts), naming the workspace for a vault path.

**Impact.** A wasted, confusing approval tap for a write that can never land, against a standing CTO ruling. Safe (the jail still refuses), but noisy on a phone.

**Proposed fix.** Have own-root tools expose their root (ctx.vaultRoot) so the loop can resolve pathOf against new Jail(vaultRoot) and deny before asking. Word the violation for the vault ('Path leaves the vault').

## Team (org) vault on Supabase

The team (org) vault is a real, working Supabase provider. Reads are properly RLS-scoped to active members: a live Postgres 16 repro of 0010+0015 returned 0 rows for a cross-org reader. Direct table writes are revoked and paths are jailed. Last-writer-wins with a rev check is implemented on the server, but the "never lose work" half of the DECISIONS ruling does not hold in practice. The client's base rev comes from a device-wide cache that every list()/read() moves forward. Foreground refresh, the list after each autosave, backlinks and offline replay all do this, so a stale editor silently overwrites a teammate with no conflict copy (proven by a scratch vitest plus a SQL repro). Three writers clashing in the same minute destroy a version, deletes take no base rev and wipe the body with no restore, and a stale stashed draft replays over a newer save. Measured against the ask, the gaps are these. Nothing is live (no realtime, the open note never refreshes). The team vault cannot feed any model's context: no engine tool, no driver, no retrieval. It cannot be exported or opened in Obsidian: the export button is unreachable in team scope. It has no rename, no version history, no roles or settings, a silent 1000-note truncation, and permanent server refusals shown as "connection" problems. The fix order is: an honest per-editor base plus a revisions table (which fixes all the data-loss paths at once), then live refresh with merge, then team export/import, then a retrieval-first team context slice for every seat.

**What is solid:**

- Read isolation: org_vault_select uses is_org_member, which requires status='active' (supabase/migrations/0010_org_vault.sql:47-48, supabase/migrations/0002_rls.sql:7-18). A live Postgres 16 repro showed an org-2 member selects 0 rows of org 1, and a removed member loses reads the moment status leaves 'active'.
- Write lockdown: insert/update/delete are revoked from authenticated and anon, and the two SECURITY DEFINER RPCs with search_path pinned are the only write path (supabase/migrations/0010_org_vault.sql:55-60, 67-76, 128-133).
- Server-side rev compare plus conflict copy works in the simple two-writer case when the base rev is honest (supabase/migrations/0015_review_2026_09_05.sql:532-548). Verified live: a writer from a stale base 1 against rev 2 produced 'plan (conflict 2026-09-26 2011).md'.
- Path traversal and oversized bodies are refused server-side (org_vault_path_ok and the 1 MiB cap, supabase/migrations/0015_review_2026_09_05.sql:483-496, 517-522). The export repeats the jail on the device (app/src/lib/vaultExport.ts:18-23).
- PostgREST filter quoting for paths with parentheses and commas (conflict copies) is handled (app/src/lib/gitos/orgVault.ts:84-87).
- Sign-in and sign-out reset the base-rev cache and on-screen team state, and fall back to personal scope (app/src/state/store.ts:2895-2925, 3058-3061).
- An org someone else added you to is adopted only through an explicit Join sheet, so the Team Vault target is never silently rewired (app/src/components/OrgJoinSheet.tsx, app/src/state/store.ts:2842-2848).
- A failed team save is caught and stashed instead of thrown (app/src/state/store.ts:6117-6126), and a failed list keeps the last-known tree with an offline card (store.ts:5994-5999, VaultScreen.tsx:701-711).
- The Team tab shows only to signed-in org members and drops back to Personal when that stops being true (app/src/screens/VaultScreen.tsx:125-127, 561-585). The team copy is modest and does not claim live sync (VaultScreen.tsx:587-589, 713-715; orgVault.ts:92).

### [orgvault-1] Any list() or read() moves the device-wide base rev forward, so a stale editor silently overwrites a teammate (no conflict copy)

critical, data-loss, v1 must, size M, confirmed. `app/src/lib/gitos/orgVault.ts:102`

**Evidence.** orgVault.ts:102 `for (const r of rows) baseRev.set(revKey(resourceId, r.path), r.rev);` (list; stat :114 and read :126 do the same), and write uses it at :131 `const base = baseRev.get(revKey(resourceId, path)) ?? 0;`. list() runs on foreground return (VaultScreen.tsx:235-237 `else void vaultRefresh();` -> store.ts:5989), after every autosave (store.ts:6107) and in vaultReadAll (store.ts:6157). The open note's text is never re-read: vaultRefresh sets only vaultFiles (store.ts:5990), and the draft effect runs only when vaultNote?.path changes (VaultScreen.tsx:179-191). Proof 1 (scratch vitest, since deleted): read rev 3, then list reports rev 4, then write sent p_base_rev 4. Proof 2 (live Postgres 16 with 0010+0015 applied): Alice put v1 at base 0 (rev 1); Bob put 'v1 plus Bob's Q4 plan' at base 1 (rev 2); Alice put 'v1 plus Alice typo fix' at base 2 (rev 3). The table holds only Alice's text, with no conflict row.

**Impact.** Alice opens a team note, switches apps, and Bob edits it on his phone. Alice comes back, fixes a typo, and Bob's edit is gone: no conflict copy, no notice. The DECISIONS ruling 'LWW plus conflict copy' fails on the most common co-editing path. Offline replay has the same flaw, because vaultRefresh lists first (setting base = current) and then replays (store.ts:5989-5993), so every offline team edit overwrites whatever teammates did in the meantime.

**Proposed fix.** Make the base belong to the editor session, not a device cache. Add an optional baseRev/etag to StorageProvider.write (app/src/lib/gitos/providers.ts). Set it only when a note is opened (store.vaultOpen) and from write results, and stop list()/stat() from touching it (orgVault.ts:102,114). Carry {path, text, baseRev} through scheduleSave/flushSave (VaultScreen.tsx:199-221) into vaultSave (store.ts:6095). Store baseRev in the pending stash (store.ts:3031) so a replay sends the rev the text was typed against. Add a regression to app/test/orgVault.test.ts: read rev 3, list rev 4, write must send 3.

**Verifier.** Read orgVault.ts:96-142. list() (:102), stat() (:114) and read() (:126) all do baseRev.set(...), and write() sends baseRev.get(...) ?? 0 (:131). Traced the callers: VaultScreen.tsx:234-238 calls vaultRefresh on visibility 'visible', which calls provider.list at store.ts:5989. vaultSave re-lists at store.ts:6107 and vaultReadAll lists at store.ts:6157. vaultRefresh sets only vaultFiles, and the draft effect keys on vaultNote?.path only (VaultScreen.tsx:179-191), so the editor keeps the stale text while the base moves to the current rev. The server compares rev with p_base_rev (0015:532-535), finds them equal, and overwrites with no copy. I reproduced this in a scratch vitest (now deleted): read rev 3, then list rev 4, then write sent p_base_rev 4. Offline replay is the same: vaultRefresh lists (:5989) and then replays (:5993), and the stash entry carries no base (store.ts:3020-3023). Nothing else guards this path.

### [orgvault-2] A stale stashed draft replays over a newer successful save (all vault scopes, team included)

high, data-loss, v1 must, size S, confirmed. `app/src/state/store.ts:6115`

**Evidence.** vaultSave success path: `const saved = await target.provider.write(...)` (6099), then `await replayVaultPending(target);` (6115). replayVaultPending writes every stashed item for the resource (3042-3047) and never checks whether that path was just saved. A stash entry is removed only by a replay or a delete (6137-6141). Scratch test (copied the vaultStore.test.ts harness, since deleted): the save of 'typed offline' fails, then the save of 'typed offline. And the final line.' succeeds. Afterwards vaultNote.text shows the new text but the provider holds 'typed offline'. On the team vault the replay's base is the rev its own write just returned, so no conflict copy is made. The existing test vaultStore.test.ts:144-156 hides this by saving identical text twice.

**Impact.** Someone reconnects, finishes a sentence and closes the note. The server (and every teammate) keeps the older offline text, and on reopen the last sentence is gone.

**Proposed fix.** In vaultSave's success path, delete the stash entry for `${resourceId}::${path}` before replaying the others (store.ts:6099-6115). Carry a timestamp and base rev on stash entries and skip replaying any entry older than the last successful save of that path. Add a vaultStore test that uses two different texts.

**Verifier.** Reproduced in a scratch vitest (now deleted) using the vaultStore harness. The save of 'typed offline' fails and is stashed. The next save of 'typed offline. And the final line.' succeeds. After that, vaultNote.text holds the new text but the provider holds 'typed offline'. Cause: the vaultSave success path calls replayVaultPending (store.ts:6115), which writes every stash entry for the resource (3042-3047) and never drops the entry for the path that was just saved. In team scope, the list at :6107 has already moved the base to the rev of the new save, so the replay overwrites it with no conflict copy. This affects every vault scope, personal included. vaultStore.test.ts:144-156 saves the same text twice, which is why it misses this.

### [orgvault-3] Same-minute conflict copies fold onto one path and destroy a version; racing first-creates overwrite without a copy

medium, data-loss, v1 must, size S, confirmed. `supabase/migrations/0015_review_2026_09_05.sql:538`

**Evidence.** conflict_path := regexp_replace(p_path, '\.md$', '', 'i') || ' (conflict ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24MI') || ').md'; ... on conflict (org_id, path) do update set body = excluded.body (0015:538-547). Live repro: A creates plan.md. B saves from base 1 ('B edit: the budget section', rev 2). C saves from base 1, so B's body is copied aside. A saves from base 1 in the same minute, and C's body overwrites the same copy. Final rows: 'plan (conflict 2026-09-26 2011).md' = 'C edit: the hiring section' and 'plan.md' = 'A edit: the timeline'. B's text exists nowhere. Separately, for a brand-new path `select ... for update` (0015:527-530) has no row to lock, so two concurrent puts both insert, and the second ON CONFLICT DO UPDATE replaces the first body with no copy.

**Impact.** When three teammates edit the same meeting note, one person's work is lost, which contradicts the migration's own promise.

**Proposed fix.** New migration: make copy names unique (include the displaced rev and author, or insert with ON CONFLICT DO NOTHING and retry with a new suffix). Better, write every displaced body to an append-only org_vault_revisions table so nothing is ever overwritten; it also gives version history and restore. Take pg_advisory_xact_lock(hashtext(p_org::text || p_path)) before the existence check so first-creates are serialized.

**Verifier.** The code at 0015:538-547 (org_vault_put, the last redefinition; nothing later replaces it) makes the copy name minute-granular and uses ON CONFLICT DO UPDATE SET body = excluded.body. A third clash in the same minute therefore overwrites the second writer's preserved body, exactly as described. The comment at 0015:536-537 admits the fold but assumes it is harmless. For a new path, `select ... for update` (527-530) locks no row, so two concurrent first-creates both skip the copy and the second upsert replaces the first body. That race needs a millisecond-level collision; the three-writer case is the realistic one. I lowered severity to medium because it needs three writers on one note in one minute. It stays must: once orgvault-1's honest base lands, clashes become far more frequent and this fold becomes the next loss path, and a revisions table fixes both.

### [orgvault-4] Delete takes no base rev, blanks the body, is open to every member, and has no restore

high, data-loss, v1 must, size M, confirmed. `supabase/migrations/0010_org_vault.sql:138`

**Evidence.** org_vault_delete(p_org uuid, p_path text): `update public.org_vault_notes set deleted = true, body = '', updated_at = now(), updated_by = auth.uid(), rev = rev + 1 where org_id = p_org and path = p_path;` (0010:128-145). There is no p_base_rev and the only check is is_org_member. Live repro: after A saved plan.md at rev 4, B's delete left deleted=t with body length 0. The delete UI has no trash or undo (VaultScreen.tsx:505-525), and its own comment says 'a local or iCloud delete is unrecoverable'; team deletes are the same.

**Impact.** A teammate deleting from a stale view destroys another member's just-saved work. One careless or departing member can tombstone the whole team vault with no recovery path. Obsidian Sync, the stated baseline, keeps deleted files and version history.

**Proposed fix.** Add org_vault_delete(p_org, p_path, p_base_rev) that conflict-copies (or refuses) when the rev has moved. Keep the body on the tombstone or copy it to org_vault_revisions. Add 'Recently deleted' with Restore in team scope, an org setting 'only admins delete' (is_org_admin), and a pg_cron purge of tombstones after N days.

**Verifier.** 0010:128-145 is the only definition of org_vault_delete (a grep shows 0015 redefines only put). It takes no base rev, checks only is_org_member, and sets body = ''. The client remove() (orgVault.ts:144-147) passes only org and path. The Options sheet (VaultScreen.tsx:504-535) has a two-tap delete but no trash or undo, and no restore exists anywhere in the store API (store.ts:1184-1213). The claim that one departing member can tombstone everything holds through direct RPC calls. Through the UI it is one note at a time.

### [orgvault-5] No realtime or refresh: a teammate's edit never appears in an open note, and authors are never shown

medium, gap, v1 should, size M, confirmed. `app/src/screens/VaultScreen.tsx:179`

**Evidence.** `grep -rn -i 'realtime|channel|websocket' app/src` finds nothing. The tree refreshes only on mount (VaultScreen.tsx:158-161), on foreground (234-238), on scope switch, and after this device's own writes. vaultRefresh updates only vaultFiles (store.ts:5989-5990), and the draft effect depends only on vaultNote?.path (VaultScreen.tsx:179-191). updated_by exists (0010:34) but is never selected (orgVault.ts:100,110,122).

**Impact.** Two teammates in the same note see each other's changes only after backing out and reopening. The stale view is what feeds the silent overwrite in orgvault-1. A multi-writer knowledge base does not feel shared.

**Proposed fix.** Subscribe to Supabase Realtime postgres_changes on org_vault_notes filtered by org_id, or poll `select path,rev,updated_at,updated_by ... order by updated_at desc limit 50` every 15-30 s while the Vault is visible. When the open note's rev moves: if the editor is clean, reload; if dirty, run a 3-way merge against the saved base text (diff3 or diff-match-patch, the Obsidian Sync behavior). Show 'Edited by &lt;name>, 2 min ago' under the title.

**Verifier.** `grep -rn -i -E 'realtime|\.channel\(|websocket|postgres_changes' app/src` returns nothing. There is no poll either: the only interval on the screen is the lease heartbeat (VaultScreen.tsx:168), and vaultAcquireLease returns early in team scope (store.ts:6182). updated_by is never selected (orgVault.ts:100,110,122), and no code in app/src reads it. I lowered this to medium/should for live realtime. The minimum piece belongs with orgvault-1 as a must: re-read the open note when the app returns to the foreground, or when list shows its rev moved and the editor is clean. Once the base is honest, a stale editor produces a conflict copy rather than a silent overwrite.

### [orgvault-6] The team vault cannot feed any model's context: no engine tool, no driver, no retrieval

high, gap, v1 must, size L, confirmed. `os-code/src/core/tools/vault.ts:17`

**Evidence.** The engine vault tools are jailed to `ctx.vaultRoot` (os-code/src/core/tools/vault.ts:14-18), the local ~/OSCode/Vault. `grep -rn -i 'org_vault|team vault|orgvault' os-code/src` returns nothing. In app/src the org provider is reached only through gitos/index.ts:9,23 and the Vault screen, and no chat driver (stack.ts, providers.ts) references the vault. parked-ideas.md:350-352 records that the on-device vault was chosen as the agent target instead of the team vault.

**Impact.** Team conventions, architecture notes and decisions written in the team vault never reach Claude, a local 7B, or a BYOM seat. Switching models therefore drops the team's shared context, which is the opposite of the founder's ask ('seamlessly move between models and optimize context').

**Proposed fix.** (a) New migration: a generated tsvector column, a GIN index, and an org_vault_search(p_org, q, limit) RPC returning path, snippet and rev. (b) Retrieval-first injection in the app stack driver, budgeted per model class (harness tenets 2 and 3), and a read-only teamVaultSearch/teamVaultRead tool slice for the engine, fed through BootstrapOptions with a short-lived read-scoped token or proxied by the app. (c) A pinned 'Team context' set (frontmatter `context: always`) compiled into a bounded preamble that every seat gets. (d) Agent writes to the team vault only as alwaysAsk proposals attributed to the person (DECISIONS 'never silent'). Back any speed claim with an osc eval number first.

**Verifier.** os-code/src/core/tools/vault.ts:16-19 jails every engine vault tool to ctx.vaultRoot (the local ~/OSCode/Vault). `grep -rn -i -E 'org_vault|team vault|orgvault|teamvault' os-code/src` returns nothing. `grep -rn -i vault app/src/drivers` returns nothing, so no app chat driver injects any vault, personal or team, into model context. The only vault surface on the electron bridge is the on-disk folder (electronBridge.ts:305-311). parked-ideas.md:350-352 records that the founder deliberately made the private on-device vault the agent's WRITE target. That choice covers writes only; read or retrieval of team notes into any seat's context is simply unbuilt. It depends on the same retrieval seam the personal vault needs, and the team slice rides on it.

### [orgvault-7] Conflict copies are invisible, the stale writer takes the canonical name, and a create from a stale list blanks a teammate's note

medium, ux, v1 must, size M, confirmed. `app/src/lib/vault.ts:167`

**Evidence.** isConflictCopy (vault.ts:167-169) is referenced only by app/test/vault.test.ts; no row badge, notice, compare or resolve UI exists. org_vault_put returns only the winning row (0015:550-560), so the client cannot tell a copy was made. The late or stale writer keeps the canonical path (0015:550-557). vaultCreate decides 'exists' from the possibly stale local list (store.ts:6050-6056) and then writes '' with base 0 (orgVault.ts:131). On the server that copies the teammate's body aside and blanks the canonical note (0015:532-557). Copies are minute-granular, so two people co-editing for 10 minutes can leave up to 10 copy files.

**Impact.** After a clash, [[Plan]] resolves to the older-based version, and the up-to-date text sits in a '(conflict ...)' note nobody is told about. Tapping 'New note: Plan' on a stale tree empties a teammate's Plan.

**Proposed fix.** Return {row, conflict_path} from org_vault_put. Show a toast ('Bob saved this at the same time; his version is kept as ...') with Compare / Keep mine / Keep theirs, and badge copies in the tree (treeAt). Add org_vault_create (insert ... on conflict do nothing, returning the existing row) so a create never overwrites. Plan a markdown 3-way merge so most clashes never produce a copy.

**Verifier.** isConflictCopy (vault.ts:167-169) is referenced only in app/test/vault.test.ts, and VaultScreen has no conflict UI (its only 'conflict' strings concern repo sync). org_vault_put returns only the canonical row (0015:550-560), and the client discards the body and returns its own text (orgVault.ts:139-141), so the client cannot learn that a copy was made. vaultCreate checks for an existing note only against the local vaultFiles (store.ts:6050-6056) and then writes '' with base baseRev.get ?? 0 (orgVault.ts:131). When a teammate created the note after the last list, the server copies their body aside and blanks the canonical note (0015:532-557). Their text is not destroyed, but it is hidden under a '(conflict ...)' name nobody is told about.

### [orgvault-8] list() has no pagination, so a team vault past 1000 notes is silently truncated

medium, bug, v1 should, size S, confirmed. `app/src/lib/gitos/orgVault.ts:97`

**Evidence.** orgVault.ts:97-101 selects `select=path,updated_at,rev,size&org_id=eq...&deleted=is.false&order=path` with no limit, offset or Range header. supabase.ts:234-240 makes one fetch and returns the JSON. supabase/config.toml:22 `max_rows = 1000` (the hosted Supabase default is also 1000).

**Impact.** Notes past the first 1000 (alphabetically) vanish from the tree, wikilink resolution, backlinks and export (vaultReadAll iterates the list, store.ts:6157). Creating one of them again from the tree blanks it (orgvault-7).

**Proposed fix.** Paginate with Range/Content-Range or order+offset until a short page, or add one metadata RPC. Add a test with 1001 rows.

**Verifier.** orgVault.ts:97-101 sends no limit, offset or Range header. select() in supabase.ts:234-240 makes a single fetch and returns the JSON. supabase/config.toml:22 sets max_rows = 1000, which matches the hosted default. PostgREST silently caps the result, and the code never checks for a Content-Range header. Everything downstream iterates this list: the tree, resolveWikilink, the vaultCreate existence check, and vaultReadAll (store.ts:6157).

### [orgvault-9] Permanent server refusals (1 MB cap, bad path, not a member) are reported as a connection problem and retried forever

medium, ux, v1 must, size S, confirmed. `app/src/state/store.ts:6117`

**Evidence.** `} catch { await stashVaultDraft(target.resourceId, path, text); set({ vaultError: 'save' }); get().showToast('Could not save to your vault. Your text is kept and saves when the connection returns.');` (6117-6124). The server raises 'a note is limited to 1 MB' (0015:520-522), 'that note path is not allowed' (0015:517-519; normalizeNotePath has no length cap, vault.ts:68-83) and 'not a member of this org' (0015:523-525). rpc() carries the message (supabase.ts:229), but the catch discards it, and the replay retries on every list and save (store.ts:3044-3050).

**Impact.** Paste a 2 MB log, or edit after being removed from the org, and the app promises 'saves when the connection returns', which never happens. The text is stranded in a stash with no UI, breaking the honesty-in-copy bar.

**Proposed fix.** Classify errors in vaultSave and vaultCreate: network failures stash and retry; P0001 or 4xx responses show the server's line, keep the editor dirty and do not stash. Pre-check 1 MB and path length on the client. List unsaved drafts in the Vault as a 'Not saved' row with copy and discard actions.

**Verifier.** The vaultSave catch (store.ts:6117-6124) discards the error and always stashes and promises a reconnect. vaultCreate's catch does the same ('Working offline', 6074-6087). The server messages exist (0015:514-525) and rpc() puts them into the Error (supabase.ts:229). normalizeNotePath has no length cap (vault.ts:68-83), and there is no client-side 1 MB check. The replay runs on every list and every save (store.ts:5993, 6115, 3044-3050), so a permanent refusal is retried forever. One more instance of the same flaw: when the session has expired, token() throws 'Sign in to your team to use the team vault.' (orgVault.ts:69), and the user is still told it 'saves when the connection returns'.

### [orgvault-10] The team vault cannot be exported or opened in Obsidian, and a team export would wipe the personal export

medium, gap, v1 must, size M, confirmed. `app/src/screens/VaultScreen.tsx:590`

**Evidence.** The only Export button sits in the 'Where your vault lives' sheet (VaultScreen.tsx:946-968). That sheet opens only from the 'Where it lives' link rendered under `{!team ? (...)}` (VaultScreen.tsx:590-597), and setStorageOpen(true) appears nowhere else. exportVaultToFiles writes to the single root `const EXPORT_ROOT = 'Vault'` (vaultExport.ts:10) after `Filesystem.rmdir({ path: EXPORT_ROOT, recursive: true })` (vaultExport.ts:36-40). There is no import path.

**Impact.** The team tier cannot be opened in Obsidian, backed up, or taken out, contradicting 0010:22-23 ('so the same tree opens in Obsidian on export') and the CMO's reason Vault ships under its name ('compat is true'). If the button were simply shown, a team export would wipe the personal export folder, including edits made there in Obsidian.

**Proposed fix.** Add Export in team scope that writes to its own root ('Vault Team/&lt;org name>'). Stop rmdir-ing a folder Obsidian may have edited: keep a manifest and remove only files OpenShore wrote. Add 'Import a folder' (batched org_vault_put) so a team can start from an existing Obsidian vault. A desktop two-way folder mirror can follow.

**Verifier.** setStorageOpen(true) appears only at VaultScreen.tsx:593, inside `{!team ? (...) : null}` (590-597). The Export button lives only in that sheet (946-968). vaultExport.ts:10 hardcodes EXPORT_ROOT = 'Vault' and rmdir's it recursively before every export (36-40), so a team export built on the same function would wipe the personal export. There is no import path anywhere. Ironically, isSafeExportPath (vaultExport.ts:12-23) was written with team notes in mind, but team scope cannot reach it.

### [orgvault-11] Each note open makes N serial GETs, and each autosave re-lists the vault and downloads the full body back

medium, perf, v1 should, size S, confirmed. `app/src/state/store.ts:6163`

**Evidence.** vaultReadAll loops `const note = await target.provider.read(target.resourceId, f.path);` for every note whose updatedAt changed (store.ts:6163-6175), and it runs on every note open (VaultScreen.tsx:184). A cold 300-note team vault therefore costs 1 list plus 300 sequential PostgREST requests. org_vault_put `returns public.org_vault_notes`, body included (0015:504,558), which the client ignores (orgVault.ts:141 returns the local `text`). vaultSave re-lists the whole vault after every 600 ms autosave (store.ts:6107).

**Impact.** The first open is slow on cellular, a large note costs up to 2 MB of transfer per autosave, and the extra list() calls feed the base-rev drift in orgvault-1.

**Proposed fix.** Add a bulk body fetch (paginated select of path, body, updated_at, rev) or a backlinks RPC on the FTS index. Make the put RPC return only path, rev and updated_at. Patch vaultFiles locally from the write result instead of re-listing.

**Verifier.** vaultReadAll (store.ts:6154-6177) reads serially and skips only notes whose cached updatedAt matches. The cache is in memory only (store.ts:694), so the first open in each app session costs one list plus N serial GETs. org_vault_put returns the whole row, body included (0015:504, 558), and the client ignores it (orgVault.ts:141). vaultSave re-lists after every autosave (store.ts:6107). The finding describes the cache correctly ('whose updatedAt changed', 'cold'), so the claim is not overstated.

### [orgvault-12] No rename or move for team notes (an Obsidian basic), and a client-side put+delete would inherit the no-base-rev delete

medium, gap, v1 should, size M, confirmed. `app/src/screens/VaultScreen.tsx:504`

**Evidence.** The note Options sheet offers only 'Delete this note' and Cancel (VaultScreen.tsx:504-535). The store's vault API has no rename (store.ts:1184-1213), and 0010/0015 define no move RPC.

**Impact.** Teams cannot reorganize without copy-paste plus delete, which loses history and breaks [[links]]. Obsidian renames and updates links automatically.

**Proposed fix.** Add an org_vault_move(p_org, p_from, p_to, p_base_rev) atomic RPC that writes a revision and a redirect tombstone. On the client, rewrite [[links]] in referring notes through base-checked puts. Expose the same operation on the gitOS seam for the personal providers.

**Verifier.** The Options sheet (VaultScreen.tsx:504-535) offers only Delete and Cancel. The store's vault interface (store.ts:1180-1213) has no rename or move; vaultMoveTo moves providers, not notes. No migration defines a move RPC. The same gap applies to the personal vault.

### [orgvault-13] The LWW and conflict-copy rule is never tested against Postgres, and the pgTAP file is not run in CI

medium, test-gap, v1 must, size M, confirmed. `supabase/tests/rls.test.sql:95`

**Evidence.** app/test/orgVault.test.ts mocks select and rpc (lines 6-10), so the rev compare never executes. rls.test.sql has three vault assertions (95-102, 219-222): traversal refused, member writes, non-member refused. Nothing covers select isolation, a removed member's reads, the conflict copy, delete, or the size cap. .github/workflows/ci.yml runs `deno test supabase/functions/_shared` but never `supabase test db` or pg_prove.

**Impact.** The three data-loss paths above ship with a green build.

**Proposed fix.** Add pgTAP cases: two-writer copy, three-writer same-minute clash, stale delete, removed member selects 0, cross-org select 0, 1 MB cap, first-create race. Add a CI job with a Postgres service container that applies migrations and runs pg_prove. Add a provider regression for the base drift.

**Verifier.** app/test/orgVault.test.ts mocks select and rpc (lines 6-10), so no server logic runs. supabase/tests/rls.test.sql touches the vault only at lines 96-102 (traversal refused, member write) and 215-222 (non-member refused). It has no select-isolation, conflict-copy, delete or cap cases. .github/workflows/ci.yml runs `deno test supabase/functions/_shared` (line 102) but never runs pgTAP. The only mention of `supabase test db` is supabase/README.md:83, as a manual step.

### [orgvault-14] No team-vault roles or settings: every member can write and delete everything, and nothing is configurable

medium, gap, v1 should, size M, confirmed. `supabase/migrations/0010_org_vault.sql:9`

**Evidence.** The design comment reads 'any active member reads and writes' (0010:9-10). Both RPCs gate only on is_org_member (0015:523, 0010:135). org_members.role is only admin|member, with no viewer role and no per-folder access. In team scope the Vault shows no settings (the storage sheet link is hidden, VaultScreen.tsx:590).

**Impact.** The ask says 'fully customizable', yet an org cannot make a read-only handbook, restrict deletes to admins, choose a conflict policy, or pick which folder feeds models.

**Proposed fix.** Add an org_vault_settings row (delete rights: admins|members; members_can_write; context folder; conflict policy merge|copy; routine/agent drop folder) enforced in the RPCs, with an admin UI on the Admin screen. Folder ACLs later.

**Verifier.** 0001_orgs.sql:24 limits the role to admin|member. Both vault RPCs gate on is_org_member alone (0015:523, 0010:135), even though is_org_admin exists (0002:20) and is already used by org_projects (0014:80,174). No org vault settings table exists, and the team scope hides the only settings link (VaultScreen.tsx:590).

### [orgvault-15] Sign-out leaves unsent team drafts and team note bodies on the device; drafts later replay under the next member's identity

low, security, v1 should, size S, partial. `app/src/state/store.ts:2899`

**Evidence.** forgetSession (store.ts:2886-2926) calls resetOrgVault() and clears on-screen state. It never touches VAULT_PENDING_KEY 'oscode.vault.pending' (store.ts:3019) or the module-level vaultBodyCache (store.ts:694). Stash entries are keyed by org id (3031-3034) and replayed on the next successful team list (5989-5993) with updated_by = auth.uid(). DECISIONS R-19 (os-code/DECISIONS.md:185-186) says 'sign-out wipes the synced team-vault state'.

**Impact.** On a shared or handed-off device, the previous member's unsent team edits persist and are later published as the next member's work.

**Proposed fix.** In forgetSession, drop stash entries whose resourceId is an org id (or tag each entry with the user id and replay only the owner's), and clear vaultBodyCache keys for that org.

**Verifier.** The stash half holds. forgetSession (store.ts:2886-2926) calls resetOrgVault and clears on-screen state, but never touches VAULT_PENDING_KEY (3019). Stash entries are keyed by org id (3033), and forgetSession keeps the org serverId in settings (2884-2885, 2910). The next same-org member to sign in therefore replays the stash under their own auth.uid(), which contradicts R-19 ('sign-out wipes the synced team-vault state'). The vaultBodyCache half does not hold as a leak. That cache lives only in memory (store.ts:694), and vaultReadAll reads it only for the current target's resourceId. A member of a different org never reads it, and a same-org member can already read those bodies through RLS. When the next user is in a different org, the old stash never replays; it just sits in sealed storage.

### [orgvault-16] A pending debounced save resolves the vault scope when it fires, so a scope flip writes team text into the personal vault

low, bug, v1 should, size S, confirmed. `app/src/screens/VaultScreen.tsx:199`

**Evidence.** scheduleSave stores only {path, text} (VaultScreen.tsx:199-207), and vaultSave resolves `const target = vaultTarget();` from the current scope when the timer fires (store.ts:6096). The scope flips with the note open through VaultScreen.tsx:125-127 (`if (team && !teamAvailable) void setVaultScope('personal')`, e.g. when refreshOrgRole clears serverRole) or through forgetSession (store.ts:2922), and neither flushes nor cancels the timer. The archived review DL-2 (docs/archive/CODE-REVIEW-LOCAL-FIRST.md) prescribed capturing the target at schedule time.

**Impact.** The last keystrokes of a team note never reach the team. They are written into the personal vault at the same path, overwriting a personal note with that name.

**Proposed fix.** Capture {providerId, resourceId} in scheduleSave and pass them to vaultSave. Flush or cancel the timer inside setVaultScope and forgetSession.

**Verifier.** scheduleSave stores only {path, text} (VaultScreen.tsx:198-207), and vaultSave resolves vaultTarget() from the live scope when the timer fires (store.ts:6096, 3001-3011). Nothing flushes or cancels the timer on setVaultScope (store.ts:5956-5962) or forgetSession. That contradicts the screen's own comment at 193-197, which claims a flush on scope change. The flip paths are real: the effect at 125-127, when refreshOrgRole sets serverRole undefined for a removed member (store.ts:4886), and forgetSession. forgetSession can even be triggered by the team save itself: the org token getter (store.ts:3112-3118) calls accessToken, then freshAuth, and on AuthExpiredError that calls forgetSession (2866-2871). The window is 600 ms, so this stays low severity.

### [orgvault-17] The team vault is not gated to commercial tiers and has no org storage quota

low, gap, v1 should, size S, partial. `app/src/state/store.ts:5949`

**Evidence.** teamVaultAvailable checks only `authConfigured() && st.authSession && st.serverRole && st.settings.account?.org?.serverId` (store.ts:5949-5953). org_vault_put checks only is_org_member (0015:523). Any signed-in user can create a server org and become its active admin (store.ts:2745-2766; orgs_insert `owner_uid = auth.uid()` in 0002). The only size limit is 1 MiB per note. DECISIONS.md:109-110: 'org Vault inside commercial tiers'.

**Impact.** Unpaid orgs get unbounded Postgres storage, and the pricing ruling is not enforced.

**Proposed fix.** Check an active org_entitlements row in org_vault_put, keep a per-org byte/note counter with a quota, and show an upgrade card on the Team tab when the org is not entitled.

**Verifier.** The code evidence is accurate: teamVaultAvailable (store.ts:5949-5953) and org_vault_put (0015:523) never consult org_entitlements, and the only size limit is 1 MiB per note. But the ungated state matches the current beta posture: DECISIONS.md:218-222 turns every pay gate off for the beta, and 0015's no_entitlement_max_seats() returns null by founder call. Gating is a billing and Board decision that flips with PAY_GATES_ENABLED. The part that belongs to Vault v1 is a per-org storage quota or rate limit against abuse. One contradiction is real: the CTO reasoning recorded at DECISIONS.md:693-695, 'the roster grants nothing without an entitlement', does not hold, because the roster grants unbounded shared storage.

### [orgvault-18] Paths are unique case-sensitively while resolution is case-insensitive, and conflict paths can exceed the 512-char rule and become uneditable

low, bug, v1 later, size S, confirmed. `supabase/migrations/0010_org_vault.sql:35`

**Evidence.** `primary key (org_id, path)` is case-sensitive (0010:35), while the client resolves case-insensitively (store.ts:6011-6013, vault.ts:92-94). Two members working from stale trees can create 'Plan.md' and 'plan.md', which collide on export to case-insensitive APFS/NTFS. The conflict suffix is appended without re-running org_vault_path_ok (0015:538-539). In the live repro a 500-char name produced a 530-char conflict path, and a later put to it failed with 'that note path is not allowed'.

**Impact.** Duplicate notes and wikilinks that resolve ambiguously, one note silently lost on export, and a conflict copy that can be deleted but never edited.

**Proposed fix.** Add a unique index on (org_id, lower(path)) where not deleted (or normalize in the RPC). Truncate the base name before appending the conflict suffix so the result passes org_vault_path_ok.

**Verifier.** 0010:35 `primary key (org_id, path)` is case-sensitive, while resolution is case-insensitive (store.ts:6011-6013, vault.ts:92-94). vaultCreate checks for existing notes case-insensitively, but only against a possibly stale local list. conflict_path is built at 0015:538-539 and inserted without running org_vault_path_ok, so a 496-character stem plus ' (conflict YYYY-MM-DD HHMI).md' yields 526 characters, over the 512 limit (0015:490). Later puts to that path fail at 0015:517. org_vault_delete has no path check, so the copy can be deleted but never edited, as claimed.

### [orgvault-19] Docs and migration comments say a concurrent overwrite is 'never lost', which the repros disprove

low, claim-mismatch, v1 must, size S, confirmed. `os-code/docs/parked-ideas.md:341`

**Evidence.** parked-ideas.md:340-341: 'the overwritten body is preserved as a "(conflict ...)" note, never lost'. 0010_org_vault.sql:11-13: 'so a concurrent overwrite never silently loses a member's work'. Both are contradicted by orgvault-1, orgvault-3 and orgvault-4.

**Impact.** The next session, and the founder, will trust a guarantee that does not hold, and CLAUDE.md tells sessions not to re-scope the org tier.

**Proposed fix.** Record the known gaps in os-code/PROGRESS.md 'What remains' now, and correct the claim once the revisions-table fix lands.

**Verifier.** parked-ideas.md:340-341 says the overwritten body is preserved 'never lost', and 0010_org_vault.sql:11-13 says 'a concurrent overwrite never silently loses a member's work'. orgvault-1 (scratch-proven), orgvault-3 and orgvault-4 contradict both. `grep -n -i vault os-code/PROGRESS.md` shows no known-gaps entry for the org vault. Given CLAUDE.md's 'do not re-scope the org tier', recording the gaps is a small, necessary honesty fix.

### [orgvault-20] updated_by has no ON DELETE clause, so a future account deletion will fail for anyone who ever wrote a team note

low, gap, v1 later, size S, confirmed. `supabase/migrations/0010_org_vault.sql:34`

**Evidence.** `updated_by uuid references auth.users (id),` (0010:34) uses the default NO ACTION, unlike the `on delete set null` or `cascade` used elsewhere (e.g. 0001_orgs.sql:22, 0016:95). No account-deletion flow exists yet (a grep for deleteUser/delete_account finds nothing), but App Store review requires one.

**Impact.** When in-app account deletion ships, deleting the auth user fails with an FK violation for any member who ever saved a team note.

**Proposed fix.** Migration: alter the FK to `on delete set null` (and the same on org_projects created_by/updated_by and org_members invited_by).

**Verifier.** 0010:34 `updated_by uuid references auth.users (id)` has no ON DELETE clause, and neither do 0001:26 invited_by and 0014:36,39,51. Compare 0001:22 and 0016:95, which use `on delete set null`. No account-deletion flow exists: a grep for deleteUser/delete_account/admin/users in app/src, os-code/src and supabase/functions finds nothing, and 0018's termination does not delete auth users. This is latent until account deletion ships.

### [orgvault-m1] 'Note deleted.' is toasted before the delete runs, whatever the outcome

low, ux, v1 should, size S, verifier-found. `app/src/screens/VaultScreen.tsx:520`

**Evidence.** `void vaultDelete(path);
 showToast('Note deleted.');` (VaultScreen.tsx:520-521). vaultDelete is async, and on failure it keeps the note open and shows 'Could not delete that note...' (store.ts:6148-6151). For the online-only team vault this happens whenever the network drops or the session has expired.

**Impact.** Offline, the person first reads 'Note deleted.' and then a contradictory error, while the note is still there. This breaks the honesty-in-copy bar for the one destructive action in the Vault.

**Proposed fix.** Have vaultDelete return a boolean, await it, and toast 'Note deleted.' only on success. The failure path already shows its own toast.

### [orgvault-m2] An expired session during a team save signs the person out mid-edit, closes the note, and the toast blames the connection

low, ux, v1 should, size S, verifier-found. `app/src/state/store.ts:3112`

**Evidence.** The org vault's token getter is `async () => { try { return await accessToken(); } ... }` (store.ts:3112-3118). accessToken calls freshAuth, which on AuthExpiredError calls forgetSession() (store.ts:2866-2871). forgetSession sets vaultScope 'personal' and vaultNote undefined (2922-2924). Back in orgVault.ts:69, token() then throws 'Sign in to your team to use the team vault.', and vaultSave's catch shows 'Your text is kept and saves when the connection returns' (store.ts:6122-6124). The stash replays only after someone signs back in to the same org and opens team scope, and then with the drifted base from orgvault-1.

**Impact.** The open team note disappears while the person is typing, and the message tells them to wait for a connection that is not the problem. Any keystrokes still in the 600 ms debounce go to the personal vault (orgvault-16).

**Proposed fix.** When the team session expires, keep the note open and read-only with a 'Sign in again to save to your team' notice. Give the classified error its own copy (the same fix as orgvault-9). Capture the target in scheduleSave (orgvault-16).

## Vault as model context across model switches

Today Vault is a solid Obsidian-style notebook, but it is not yet a context layer that works across models. Only a desktop engine session (the in-process ElectronDriver, or a phone-driven 'desktop' RemoteDriver) can reach any vault. It does so through three pull-only tools (vaultRead, vaultList, vaultWrite) that the system prompt never mentions and that small and tiny seats are never shown. The Stack, cloud Claude, OpenAI-compatible and BYOM, on-device pocket models (Harbor and Harbor Lite included) and desktop-chat drivers carry no vault content at all. The vault those tools reach (~/OSCode/Vault) is not the vault the person sees. The app's personal vault defaults to the sealed Local store on every device, the phone has no daemon route to the engine vault, and the team vault is invisible to every model. A mid-chat model switch carries only the spoken turns word for word: no tool output, no repo instructions, no summary or handoff. Switching into the desktop agent drops the thread entirely, pocket targets silently drop its head, and cloud targets can overflow a smaller window. There is no vault retrieval, ranking, per-class context budget (the budget fields in profile.ts are never read), prompt caching or handoff note, but reusable parts exist: guideHarness.retrieveCards, RepoIndex and keywordSearch, compactHistory, projectMemoryPrompt, and the Hermes notes daemon route.

**What is solid:**

- The app's pure vault core is Obsidian-faithful and tested: [[target|alias]] parsing, shortest-path bare-name resolution, backlinks derived by scanning, title-then-body search, and a lazy folder tree (app/src/lib/vault.ts:19-238).
- One storage seam with real providers: Local sealed KV, iCloud Drive container, Google Drive (drive.file), the on-disk device folder, and the Supabase team vault. It has a durable offline draft stash and replay (app/src/lib/gitos/*.ts; app/src/state/store.ts:3014-3053, 5964-6200).
- The engine's vault tools are jailed to the vault root, symlink-safe, and every write is always-ask with a diff before any auto-allow path (os-code/src/core/tools/vault.ts:76-115; os-code/src/core/permissions/index.ts:155-157).
- Crew routines write their own dated result note into the on-disk vault, and the phone can read it back through the daemon (os-code/src/routines/scheduler.ts:318, 588; os-code/src/daemon/serve.ts routines note route; app/src/lib/routines.ts:168).
- A mid-chat switch between chat brains is race-safe (it refuses while busy or with pending approvals, and builds before committing) and carries plan and clarify cards, not only prose (app/src/state/store.ts:3900-3990; app/src/state/types.ts:476-496).
- Pocket seats never overflow: fitDeviceHistory keeps the newest turns that fit a 4096-token window (app/src/drivers/deviceModel.ts:35, 58-81). The engine compacts with a model summary plus a manual /compact (os-code/src/context/compaction.ts:61-126; os-code/src/core/agent/loop.ts:283-300, 672-678).
- Project memory: five repo-committed notes, a prompt block that tells the agent to read Current State first, and a hard-scoped auto-allowed projectMemoryWrite. The notes are readable in the Vault's Coding projects card (os-code/src/core/agent/projectMemory.ts:216-231; app/src/screens/ProjectMemoryScreen.tsx:113).
- Building blocks for retrieval-first already exist: a pure, Node-free card scorer used by Harbor Lite (app/src/lib/guideHarness.ts:107-137), and embedding plus keyword repo retrieval in the engine (os-code/src/context/index.ts:34, 197).
- A precedent for the phone reading notes that live on the computer: the daemon's Hermes notes routes, jailed and read-only (os-code/src/daemon/serve.ts:890-905; os-code/src/currents/host.ts:62-100).

### [keyask-1] No phone, cloud, pocket, BYOM or desktop-chat seat can read or write the vault; only desktop engine sessions can

critical, gap, v1 must, size L, confirmed. `app/src/state/store.ts:2431`

**Evidence.** `grep -rli vault app/src/drivers` returns nothing. Every chat brain's context is standingContext: `[project?.instructions?.trim(), repoContextLine(conv.repoIds ?? [])]` (store.ts:2431-2441), passed through chatContext (2446-2453) to CloudClaudeDriver (system = SYSTEM_PROMPT, effortDirective, VIDEO note, readChatContext: cloudClaudeDriver.ts:150-156), CloudOpenAiDriver (cloudOpenAiDriver.ts:158-168), DesktopChatDriver (desktopChatDriver.ts body.context) and OnDeviceDriver (onDeviceDriver.ts:127). StackDriver.systemFor (stackDriver.ts:481-543) holds BASE_SYSTEM, effort, the project name and instructions, crew, UX, humanizer and codemagic: no vault. BYOM and Hermes seats ride the same StackDriver path. The only tool loop on the phone is codemagic (stackDriver.ts:1558). The daemon /chat surface sends no tools (serve.ts:760-766). Vault tools are registered only in the engine (os-code/src/core/agent/registry.ts:86-88).

**Impact.** Suppose a person writes 'Always use pnpm; auth uses PKCE' in Vault and then chats with cloud Claude, a BYOM model, Harbor, or their Stack on the phone. The model has never seen that note and cannot fetch it. Only a paid desktop coding session can, and only if the model chooses to call vaultRead. Switching models therefore loses everything the Vault was supposed to carry.

**Proposed fix.** (a) Add a pure, Node-free context-pack builder, os-code/src/harness/vaultContext.ts, exported through os-code/protocol so both app and engine use it. `buildContextPack({notes, query, project, budgetTokens, pins})` returns the text plus the paths it used. (b) App hook: compute the pack per send beside standingContext/chatContext (store.ts:2431-2453). Pass it to the cloud drivers and DesktopChatDriver through ChatContext; change OnDeviceDriver's fixed extraSystem into a ChatContext function; add StackContext.vaultPack, used in StackDriver.systemFor after the project block (stackDriver.ts:497-505) with a per-seat budget. (c) Engine hook: push the pack in AgentSession.systemPrompt next to projectMemoryPrompt (loop.ts:508-515). (d) Emit a transcript card, 'Used 3 notes from your Vault', tappable to open them (tenet 1: cards, not rooms). (e) Phone tool slice: offer vaultSearch and vaultRead in StackDriver's Anthropic and OpenAI function-calling loops, the same way codemagic is offered (premium-harness-proposal.md:228-231 already calls for this).

**Verifier.** Checked: `grep -rli vault app/src/drivers` returns nothing. standingContext (store.ts:2431-2441) is only project instructions plus repoContextLine, and chatContext (2446-2453) adds only the guided-setup line. CloudClaudeDriver builds its system from SYSTEM_PROMPT, effortDirective, the video note and readChatContext (cloudClaudeDriver.ts:150-156). CloudOpenAiDriver does the same (158-168), and OnDeviceDriver joins base, extraSystem, walk and cot (onDeviceDriver.ts:127). StackDriver.systemFor (stackDriver.ts:481-532) carries no vault. StackDriver offers only the codemagic tool (1583, 1858). The daemon /chat route builds no tools (serve.ts:675-766). The vault tools are registered only in the engine (registry.ts:86-88). No 'attach a note to chat' bridge exists in VaultScreen or the composer either. Two small corrections. First, 'paid' is inaccurate while the beta flag has Personal pay gates off (store.ts:562-567). Second, StackDriver.runToolStepOnEngine opens an engine session (stackDriver.ts:1048) that does register the vault tools, though only for docked play tool steps. For the fix: the desktop-chat context field is capped at 8000 chars and sliced mid-text (serve.ts:103,110), so a pack sent through ChatContext has to be budgeted against that cap or it gets cut mid-note.

### [keyask-2] The Vault the person sees and the vault the agent uses are different stores by default, on every device

high, bug, v1 must, size L, confirmed. `app/src/state/store.ts:5976`

**Evidence.** The personal vault is created with `providerId: 'local'` (store.ts:5972-5978), the sealed key-value store under `oscode.gitos.file.<resourceId>.<path>` (gitos/local.ts:15-17). The engine's vault is `config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault')` (registry.ts:145). The one provider that shares that folder is desktop-only: `platform() === 'electron' && typeof bridge()?.vaultList === 'function'` (gitos/deviceFolder.ts:19-21). iCloud stores under `Documents/<resourceId>` in the app container (gitos/icloud.ts:3). The daemon exposes no vault route at all; only /currents/hermes/notes exists (serve.ts:890). Crew shows 'Saved in your vault: {note.path}' (CrewCommandScreen.tsx:1043) for a note written to ~/OSCode/Vault.

**Impact.** A phone user can never see what the agent saved, and the agent can never read what the phone user wrote. A desktop user gets the same split unless they find 'Where it lives' and move to 'This folder'. A routine's 'note in your vault' never appears in the Vault room on the phone, or on a default desktop. The person experiences two knowledge bases that disagree, which defeats portable context across models and devices.

**Proposed fix.** (1) Desktop: create the personal vault on 'files' when isDeviceFolderAvailable() (store.ts:5976), and migrate an existing Local vault once with vaultMoveTo('files') (store.ts:6213). (2) Daemon: add GET /vault, GET /vault/&lt;path> and PUT /vault/&lt;path> (person-authored writes), mirroring the jailed Hermes notes routes (serve.ts:890-905) and owner-scoped on a shared hub. (3) Phone: add a gitos 'hub' StorageProvider over those routes, offered as a 'Your computer' scope when docked, with writes buffered through the existing outbox grain when away. (4) Optional on a Mac: document setting vault.dir to the iCloud container folder so phone iCloud and the engine share bytes. Until all of this lands, copy must name which store the agent uses.

**Verifier.** vaultRefresh creates the personal vault with providerId 'local' (store.ts:5972-5978), and vaultProviderId defaults to 'local' (store.ts:555-557). Local is the sealed KV store (gitos/local.ts:14-16). The only provider sharing the engine folder is 'files', which is Electron-only (deviceFolder.ts:18-20) and never auto-chosen. The engine root is config.vault.dir or ~/OSCode/Vault (registry.ts:145), and routines write there too (scheduler.ts:681-683). The daemon has no vault route: grep of serve.ts shows only /currents/hermes/notes (890), which is admin-only and read-only. The gitos registry (gitos/index.ts) has no hub or daemon provider. Crew shows 'Saved in your vault: {note.path}' (CrewCommandScreen.tsx:1043). DECISIONS 96-135 shows the Local default was a seam-first build choice, not a ruling that the stores should stay split.

### [keyask-3] Vault and Wayfinding copy promise agent read-back and link-following that does not happen; the Memory switch is dead

high, claim-mismatch, v1 must, size S, confirmed. `app/src/lib/currents.ts:42`

**Evidence.** Wayfinding Memory: `sub: 'The agent keeps project notes in your vault and reads them back into every session there.'` (currents.ts:38-43). The only consumer of wayfindingOn is the Settings switch (SettingsScreen.tsx:989), and setWayfinding just saves (store.ts:6696-6699). Nothing in bootstrap, the daemon or any driver reads settings.wayfinding. Project notes live in the repo, not the vault (DECISIONS 2026-09-04). VaultScreen promises 'you and your agent both write' (589), 'The agent saves what it learns and reads your notes back when it works' (766), and 'The agent follows the links to find what it needs' (778), and the starter note repeats this (287-296). A scratch test (deleted afterwards) showed that neither the large-seat nor the small-seat engine system prompt mentions the vault or contains any note text. Stale 'Projects/&lt;project>/ in the vault' comments remain at bootstrap.ts:47-50, permissions/index.ts:165-168 and registry.ts:89-90.

**Impact.** Turning Memory off changes nothing, and turning it on promises something that does not exist. A new user is told the vault is what their models read, which breaks the honesty bar in CLAUDE.md.

**Proposed fix.** Rewrite the copy today to say what is true: 'Desktop coding sessions can read and propose notes here.' Then make Memory real: have it gate the context pack and the handoff writer (keyask-1, keyask-4), carry it to the engine as BootstrapOptions.memory, and have the daemon honor it. Fix the three stale comments. Add a guard test that every Wayfinding id has a runtime consumer.

**Verifier.** The Memory sub says 'keeps project notes in your vault and reads them back into every session' (currents.ts:38-43). wayfindingOn is consumed only by SettingsScreen.tsx:989, and setWayfinding only saves (store.ts:6696-6699). Nothing in app/electron or os-code mentions wayfinding. The finding understates this: ALL THREE Wayfinding switches (memory, skills, browser) gate nothing. PROGRESS.md:579-582 already concedes 'the Browser switch gates nothing' and calls the switches labels. Project memory lives in the repo (DECISIONS 2026-09-04, projectMemory.ts:7-9), so 'in your vault' contradicts a settled ruling. The engine only instructs the agent to read Current State (projectMemory.ts:222); it does not read it back into the session. VaultScreen copy at 287-296 and 761-780 promises agent read-back and link-following. On the default Local store no agent can read those notes (keyask-2). The stale 'Projects/&lt;project>/ in the vault' comments are confirmed at bootstrap.ts:47-50, permissions/index.ts:165-168 and registry.ts:89-91.

### [keyask-4] A model switch hands over the raw transcript only; switching into the desktop agent loses the thread, pocket targets drop the head, cloud targets can overflow

high, gap, v1 must, size L, confirmed. `app/src/state/store.ts:3906`

**Evidence.** `const seedable = source.kind === 'stack' || ... 'desktop-chat'`, otherwise `await get().newConversation(source); return;` (store.ts:3906-3914), so a switch to 'desktop' starts empty. The 'desktop' case of buildUnguardedDriver never uses `seed` (store.ts:2458-2610), and BootstrapOptions has no seed or handoff field (bootstrap.ts:32-97). seedFromTranscript keeps only user, assistant, plan and clarify text: 'tool/status/note artifacts are execution detail' (types.ts:466-496). Diffs, command output, files touched, repo CLAUDE.md/OSCODE.md (read only by the engine, bootstrap.ts:226) and project memory do not cross. A pocket target cuts the head with `TRIMMED_HISTORY_OPENER = '(Earlier messages in this chat were trimmed to fit.)'` (deviceModel.ts:48, 58-81; 4096 tokens at :35). Cloud drivers send `...this.history` in full, and contextWindow feeds only the meter (cloudOpenAiDriver.ts:158-170, 293; cloudClaudeDriver.ts:150-158).

**Impact.** Moving from a long Claude chat to the phone's 3B keeps the last few turns and silently forgets the goal and the decisions. Moving to a 32k-window model can fail with a context-length error. Handing a phone conversation to the desktop agent starts from zero. None of this is fast or smart, and every switch re-sends the entire history.

**Proposed fix.** Add a model-agnostic handoff. (1) A pure `buildHandoff(items, budget)` in os-code/src/harness/handoff.ts: an extractive offline form (goal from the first user turn, the latest plan card, open clarify questions, decisions, files named in tool cards, next step), optionally refined on the fast seat. (2) Write it to the vault as `Handoffs/<project>/<date> <chat title>.md`. This needs a founder ruling to extend the hard-scoped auto-allow (like projectMemoryWrite, permissions/index.ts:170) to one handoff folder; the alternative is an approve card, since vaultWrite is alwaysAsk (vault.ts:83). (3) In switchModel, seed the new driver with the handoff plus the newest turns, fitted to the TARGET window: generalize fitDeviceHistory with the target's context window (providers catalog contextTokens, contextWindowFor). (4) Make 'desktop' seedable: add BootstrapOptions.handoff and a daemonCreateSession body field, and feed it as the first run's contextPreamble (loop.ts:575-601). (5) Keep the switch note honest: 'Handed over with a summary of 14 earlier turns.'

**Verifier.** switchModel treats only stack, cloud, device and desktop-chat as seedable, and otherwise calls newConversation (store.ts:3905-3913). The 'desktop' case (2458-2610) never references seed; the first seed use is at 2619. BootstrapOptions seeds history only from a journal on resume (bootstrap.ts:291-293), and there is no handoff field. seedFromTranscript keeps user, assistant, plan and clarify only (types.ts:466-496). fitDeviceHistory trims the head at 4096 and adds the opener only when the kept window starts on an assistant turn. When it starts on a user turn, the head is dropped with no marker at all (deviceModel.ts:58-81). Cloud drivers send the full history, and contextWindow feeds only the meter (cloudOpenAiDriver.ts:158-170, 293; cloudClaudeDriver.ts:28-34, 150-158). StackDriver fits history only for device seats (stackDriver.ts:1355). One more point: the desktop-chat target also forwards the full history unfitted (serve.ts:715-725) to a local model whose served window is not set (see missed item).

### [keyask-5] Phone-driven engine sessions never send projectName, so project memory splits into two folders

high, bug, v1 must, size S, confirmed. `app/src/drivers/remoteDriver.ts:224`

**Evidence.** daemonCreateSession's body has cwd, instructions, permissionMode, humanize, chainOfThought, currents and harnessCurrents, but no projectName (remoteDriver.ts:209-235). The daemon accepts it: `const projectName = typeof body.projectName === 'string' ? ...` (serve.ts:934, 969). The in-process desktop path does pass `projectName: project?.name` (store.ts:2528); the phone path at store.ts:2585-2592 does not. StackDriver's engine step passes only `{ permissionMode: 'acceptEdits', humanize }`: no projectName and no instructions (stackDriver.ts:1048-1051). memorySegment falls back to `sanitizeFolderSegment(basename(cwd))` (projectMemory.ts:156-160). The app reads by project name: `listMemoryNotes(r, segmentForProject(project.name))` (ProjectMemoryScreen.tsx:113).

**Impact.** Take project 'My App' in the folder 'my-app'. A desktop session writes 'OpenShore Project My App MDs/', while the same project driven from the phone writes and reads 'OpenShore Project my-app MDs/'. Current State diverges by device, and the phone's sessions never show in the Vault's Coding projects card. The Stack's engine steps also run without the project's standing instructions.

**Proposed fix.** Add projectName (and, for the Stack step, the project instructions) to daemonCreateSession's opts and body, and pass them from store.ts:2585 and stackDriver.ts:1048. Add a parity test that a phone-created session and a desktop-created session resolve the same memorySegment.

**Verifier.** daemonCreateSession's opts and body carry cwd, instructions, permissionMode, humanize, chainOfThought, currents and harnessCurrents, and no projectName (remoteDriver.ts:209-235). The daemon reads body.projectName (serve.ts:934, 969). The in-process path passes projectName (store.ts:2528), but the phone path's explicit opts object omits it (store.ts:2585-2592). The comment there explains leaving out only projectSecrets, so the omission looks accidental. StackDriver passes only permissionMode and humanize (stackDriver.ts:1048-1051), so it sends no instructions either. memorySegment falls back to the cwd basename (projectMemory.ts:156-160). The app reads by project name only: segmentForProject is sanitizeFolderSegment(name) (projectMemoryRead.ts:125-127), used at ProjectMemoryScreen.tsx:113, which the Vault 'Coding projects' card opens (VaultScreen.tsx:603-621).

### [keyask-6] Small and tiny seats (the reference box's floor) are never shown the vault tools or projectMemoryWrite, yet are told to use it

high, gap, v1 must, size M, confirmed. `os-code/src/core/agent/loop.ts:139`

**Evidence.** SMALL_MODEL_TOOL_PRIORITY lists readFile, editFile, writeFile, grep, glob, searchRepo, runShell, todoWrite, gitDiff, gitStatus, webFetch, webSearch and readTerminal. vaultRead, vaultList, vaultWrite and projectMemoryWrite are absent (loop.ts:139-153). limitToolSpecs keeps the top maxToolsShown (loop.ts:1475-1485): 6 for tiny and 10 for small (profile.ts:72, 83), and profiles are on by default (schema.ts HarnessSchema `enabled: z.boolean().default(true)`). The scratch test output was `SMALL tools: readFile,editFile,writeFile,grep,glob,searchRepo,runShell,todoWrite,gitDiff,gitStatus` and `SMALL prompt mentions projectMemoryWrite: true`, because projectMemoryPrompt is pushed for every seat (loop.ts:514-515).

**Impact.** On the founder's CPU-only box, where a 3B to 7B model is the seat that matters (tenet 2), the agent cannot read or propose vault notes and cannot keep project memory current. It still spends context on instructions for a tool it was not offered. The seat that most needs the context layer is the one excluded from it.

**Proposed fix.** Follow tenet 3: the harness does the retrieval for a lean seat. Inject the context pack and the Current State body directly (keyask-7), so a small seat needs no vault tool to benefit. Also either add projectMemoryWrite to the priority list or let the harness write Current State after a verified change. Drop projectMemoryPrompt's write instructions for a lean seat that cannot see the tool. Measure with and without on `osc eval` per class before claiming a lift.

**Verifier.** SMALL_MODEL_TOOL_PRIORITY (loop.ts:139-153) omits vaultRead, vaultList, vaultWrite and projectMemoryWrite. limitToolSpecs ranks the unlisted tools last and slices to maxToolsShown (loop.ts:1475-1485). That is 6 for tiny and 10 for small (profile.ts:72, 83), and profiles are enabled by default (schema.ts:288). projectMemoryPrompt is pushed with no leanSeat guard (loop.ts:514-515), so a lean seat is told to use a tool it is not offered. One corner case: in plan mode under egress lockdown, the web tools are unregistered and only 8 priority read tools remain, so gitLog and vaultRead can fill a small seat's last two slots. This does not change the finding for normal runs. The tool comment says an unshown tool still executes if called, but with constrained decoding on for small classes the model cannot name it.

### [keyask-7] No vault retrieval, ranking or budgeting; the per-class context budgets in profile.ts are dead code; retrieval-first was never built

high, gap, v1 must, size L, confirmed. `os-code/src/harness/profile.ts:46`

**Evidence.** The engine vault tools only list and read by exact path (vault.ts:121-171); there is no search. The app's searchNotes is a case-insensitive substring match with no ranking (app/src/lib/vault.ts:184-210). `codeMapContextFraction` and `compactAtContextFraction` (profile.ts:46-49, 77-111) are read nowhere outside profile.ts and schema.ts (grep). The code map is a flat `maxChars ?? 6000` (context/codeMap.ts:83) and compaction a flat `Math.floor(contextTokens * 0.7)` (compaction.ts:66). The proposal's 'Retrieval before the first turn' (docs/premium-harness-proposal.md:297-301) is not in run() (loop.ts:575-678). The memory prompt tells the model to go and read Current State (projectMemory.ts:222) instead of the harness injecting it. There is no frontmatter, tag or alias parsing anywhere in the vault code.

**Impact.** Nothing ranks which notes matter for this turn, and nothing sizes the context to the seat. A 3B and a frontier model would get the same, or no, knowledge. The ask to 'optimize context so the models can move faster and smarter' has no mechanism behind it today.

**Proposed fix.** In os-code/src/harness/vaultContext.ts (pure): (1) Tokenize notes into fields (title, headings, Obsidian properties tags/aliases, body) and rank with BM25 plus a title/alias boost; guideHarness.scoreCards (app/src/lib/guideHarness.ts:107) shows the house style. (2) Expand one hop along [[wikilinks]] and backlinks (reuse app vault.ts resolveWikilink and backlinksTo). (3) Always include pinned notes, the project's Current State and the latest handoff. (4) Fit to a budget: add `vaultPackFraction` to ModelClassPolicy (for example tiny 0.08, small 0.12, mid 0.15, large 0.2, subject to eval), and actually wire codeMapContextFraction and compactAtContextFraction in loop.ts. The app mirrors this per seat: device 4096 tokens gives about 300 to 400 tokens; cloud uses the catalog window. (5) When an embedder is configured, run a RepoIndex over vaultRoot (context/index.ts:34) for semantic recall, with keywordSearch as the fallback. (6) Run retrieval-first in run() on the task text and add a `vaultSearch` read tool for follow-ups. (7) Gate each claim on an `osc eval` with and without the pack per class (tenet 2).

**Verifier.** Engine vault tools only list and read by exact path (vault.ts:117-171). App searchNotes is an unranked substring match, titles first (app vault.ts:184-210). codeMapContextFraction and compactAtContextFraction appear only in profile.ts and schema.ts:278-279. The code map is a flat 6000 chars (os-code/src/context/codeMap.ts:83), and compaction is a flat 0.7 (os-code/src/context/compaction.ts:66). The proposal's retrieval-first (premium-harness-proposal.md:297-301) is absent from run(): contextPreamble is the only prefix, and there is no searchRepo call before the first turn. projectMemoryPrompt tells the model to open Current State (projectMemory.ts:222) rather than injecting it. There is no frontmatter, tags or aliases parsing anywhere in the vault code. The reusable parts exist as cited: scoreCards and retrieveCards (guideHarness.ts:107, 130), RepoIndex (context/index.ts:34) and keywordSearch (197).

### [keyask-8] The agent cannot follow Obsidian wikilinks: vaultRead does no link resolution, and engine and app normalize note paths differently

medium, bug, v1 should, size S, partial. `os-code/src/core/tools/vault.ts:24`

**Evidence.** The engine's normalizeNotePath only trims, collapses separators and appends .md (vault.ts:24-34). It does not resolve by filename, strip `#heading` or `^block`, apply NFC, or strip `[<>:"|?*#^[\]]`. The app's version does all of that and resolves a bare name to the shortest matching path (app/src/lib/vault.ts:68-102). Scratch test: with Projects/Ideas.md present, `vaultRead({path: 'Ideas'})` returned `No vault note at Ideas.md yet.`

**Impact.** The app's copy says 'The agent follows the links to find what it needs' (VaultScreen.tsx:778). In practice a model that reads [[Ideas]] in one note cannot open it, and [[Auth#PKCE]] maps to a file that does not exist. The agent may also create a duplicate 'Ideas.md' at the root, forking the note.

**Proposed fix.** Move the app's pure normalizeNotePath, resolveWikilink and parseWikilinks into os-code (a Node-free module exported through os-code/protocol) and import them in both app/src/lib/vault.ts and os-code/src/core/tools/vault.ts. vaultRead should resolve bare names and heading suffixes, and return the note's outgoing links so a small model can follow one hop. Add a parity test like projectMemory.test.ts pins the memory spec.

**Verifier.** What holds: the engine's normalizeNotePath only trims, collapses separators and appends .md (vault.ts:24-34). It does no NFC, no forbidden-char strip and no bare-name resolution. The app does all three (app vault.ts:68-102), and its WIKILINK regex strips #heading and ^block suffixes (vault.ts:19). By the code, vaultRead({path:'Ideas'}) with Projects/Ideas.md present returns 'No vault note at Ideas.md yet.' (vault.ts:133), and 'Auth#PKCE' maps to 'Auth#PKCE.md'. What is overstated: 'cannot open it'. A mid or large seat can call vaultList (a full path listing, vault.ts:154-170) and then vaultRead the exact path, so link-following takes two calls and is not impossible. Duplicate-note creation goes through vaultWrite's always-ask diff (vault.ts:83), so the person sees 'Create Ideas.md' before it lands. The copy mismatch at VaultScreen.tsx:778 stands.

### [keyask-9] vault.dir is honored from a repo's os-code.config.json: a repo chooses the agent's auto-allowed read root, and the app and agent diverge

low, security, v1 should, size S, partial. `os-code/src/config/load.ts:84`

**Evidence.** loadConfig strips only the `daemon` block from the project file (load.ts:79-93), so `vault.dir` merges from the repo. The tool root is `config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault')` (registry.ts:145). Read risk defaults to allow (permissions/index.ts:83), and vaultList walks the whole root with no cap (vault.ts:142-170). Electron's vaultDir calls `loadConfig()` with no cwd (app/electron/main.ts:920-925), so it never sees the project override.

**Impact.** A cloned repo, or a member's commit on a shared hub (the DAE-9 threat), can set vault.dir to, say, /Users/alice/Documents. vaultList and vaultRead then send every .md there to the session's model, possibly a cloud one, without a prompt. More commonly, a benign per-project vault.dir silently sends agent notes to a folder the app's Vault never shows.

**Proposed fix.** Treat vault like daemon, as machine config: drop `vault` from project files in loadConfig with a warning, and read it through a global-only helper in both registry.ts and electron/main.ts. Separately, cap vaultList output (capContent, plus a count and pagination).

**Verifier.** What holds: loadConfig strips only `daemon` from the project file (load.ts:79-89). Sessions call loadConfig(options.cwd) (bootstrap.ts:116), so a repo's vault.dir becomes vaultRoot (registry.ts:145). Read defaults to allow (permissions/index.ts:83). Electron's vaultDir uses loadConfig() at process.cwd() (electron/main.ts:920-925), so the app and the agent can diverge. What is overstated: the security framing as a must. The same project file can already set permissions.defaults (shell or write 'allow'), rules, providers and verify.command (schema.ts:153-166, 301-315, 318-341), and bootstrap feeds config.permissions straight to the PermissionEngine (bootstrap.ts:202). A hostile repo config already has strictly stronger levers than choosing a markdown read root, so this is not a distinct escalation. The real fix is a general project-config trust policy, not a vault-specific one. The divergence half (a benign per-project vault.dir silently splits notes from the app's Vault) is the part worth fixing for v1, together with keyask-2.

### [keyask-10] Vault tool output ignores the seat's window: vaultList is uncapped and vaultRead is capped at 24k chars for every class

medium, perf, v1 should, size S, partial. `os-code/src/core/tools/vault.ts:154`

**Evidence.** vaultListTool returns `notes.join('\n')` with no capContent (vault.ts:165-169). vaultRead uses `capContent(readFileSync(abs, 'utf8'))` with the default `maxChars = 24_000` (vault.ts:134; tools/index.ts:169). That is about 6k to 7.5k tokens on the engine's 4-chars-per-token estimate (compaction.ts:9), for any class.

**Impact.** On a vault of a few thousand notes, one vaultList floods a small seat's window and forces compaction or a failed turn. One long note read by an 8k-window 3B leaves no room for the task. Context use is the opposite of 'faster and smarter'.

**Proposed fix.** Paginate and cap vaultList (return a count, folders first, and a 'narrow with folder or vaultSearch' hint). Have vaultRead return an outline (headings and links) first, with a `section` argument, and size its cap from the active ModelClassProfile (a per-class read cap alongside vaultPackFraction).

**Verifier.** What holds: vaultList returns notes.join('\n') with no capContent (vault.ts:165-169). There is no global observation cap either, since pushObservation writes content as-is (loop.ts:1332-1342) and only compaction later trims old observations. vaultRead uses capContent's default of 24,000 chars for every class (vault.ts:134, tools/index.ts:169). What is overstated: the impact example of 'floods a small seat's window'. Tiny and small seats are never offered the vault tools (keyask-6), so the flood hits mid and large seats. Those can still be small in practice, because the engine never sets Ollama's served window (see missed item), so a 7B 'mid' seat on the reference box can be flooded by one vaultList on a large Obsidian vault.

### [keyask-11] No prompt caching or stable-prefix ordering, so a context pack would be paid in full on every turn and every switch back

medium, perf, v1 should, size M, partial. `app/src/drivers/cloudClaudeDriver.ts:150`

**Evidence.** `grep -rn cache_control app/src os-code/src` finds nothing. CloudClaudeDriver sends `system: [SYSTEM_PROMPT, effortDirective(), ..., readChatContext(this.extraSystem)].filter(Boolean).join('\n')` as one plain string (cloudClaudeDriver.ts:150-156). The engine's Anthropic provider also flattens the system prompt to a string (os-code/src/providers/anthropic.ts:118-126, 382-393).

**Impact.** Once vault context is injected (keyask-1), each turn and each return to a model re-bills and re-prefills the whole pack. On the reference box, a stable prefix is what lets llama.cpp and Ollama reuse the KV cache. Without it, switching back to a local seat pays the full prefill again: slower and more expensive, the opposite of the ask.

**Proposed fix.** Order every system prompt as stable to volatile: base, then standards, then the context pack, then volatile lines (effort, walk step, date). Send the stable part as its own Anthropic system block with `cache_control: {type: 'ephemeral'}`, in both the app SDK driver and the engine provider. Keep the pack deterministic (sorted, and rebuilt only when the notes' updatedAt or the query changes).

**Verifier.** What holds: there is no cache_control anywhere in app/src or os-code/src. CloudClaudeDriver sends one joined system string (cloudClaudeDriver.ts:150-156), and the engine Anthropic provider sends body.system as flattened text (providers/anthropic.ts:118-126). That means long cloud Claude chats already re-bill their whole history every turn today, independent of any pack. StackDriver.systemFor also puts volatile lines (effort, the walk step) ahead of the large stable UX and humanizer blocks (stackDriver.ts:496-525), which defeats prefix reuse. What is overstated: the local-seat claim. Ollama and llama.cpp reuse a matching prefix automatically, with no cache_control, and only while the model stays loaded (keep_alive). A switch that unloads the model pays the prefill regardless of ordering. The pack-cost impact is prospective, since it depends on keyask-1 landing.

### [keyask-12] The team vault is invisible to every model

medium, gap, v1 should, size M, confirmed. `app/src/state/store.ts:3001`

**Evidence.** The org vault is reached only by vaultTarget() for the Vault screen: `if (st.vaultScope === 'team') { ... providerFor('org') ... }` (store.ts:3001-3011). No driver, no BootstrapOptions field and no engine tool reads it. The engine has no Supabase access for vault content.

**Impact.** An organization's shared decisions, runbooks and conventions do not reach any teammate's model, on any seat. For a team, the part of the Vault most worth carrying between models does not travel at all.

**Proposed fix.** Have the context-pack builder take notes from any StorageProvider. For a project that belongs to an org, merge a read-only team slice (RLS already scopes it) into the pack on the app side, and hand it to engine sessions as a BootstrapOptions.contextPack string, so the engine never needs org credentials. Label it in the 'Used notes' card as Team.

**Verifier.** providerFor('org') has exactly one consumer outside gitos/, vaultTarget at store.ts:3005, which serves only the Vault screen actions. There is no driver path, no BootstrapOptions field, no daemon route and no engine tool for org vault content. The fix direction (the app merges a read-only team slice into the pack, and engine sessions receive it as a string) fits the existing rule that org credentials stay app-side.

### [keyask-13] Not customizable: config holds only vault.dir, with no pins, include or exclude rules, budgets, handoff settings, or Obsidian properties

medium, gap, v1 should, size M, confirmed. `os-code/src/config/schema.ts:213`

**Evidence.** `VaultSchema = z.object({ dir: z.string().optional() })` (schema.ts:213-220). The app's vault.ts parses wikilinks only: no YAML frontmatter, tags or aliases, and resolveWikilink matches filenames only (vault.ts:89-102). There is no in-vault settings file, and none of the app's Settings rows affect vault context.

**Impact.** The ask is 'amazing out of the box but fully customizable'. Today a person cannot say 'always include my Coding Style note', 'never send my Journal folder to a cloud model', 'give pocket models less', or 'do not write handoffs'. Obsidian users also expect aliases, tags and properties to count.

**Proposed fix.** Add a global `vault.context` block: enabled; pins[]; exclude[] globs (default excludes Journal/ and anything tagged private); cloud: 'allow'|'local-only' for excluded folders; per-class budget overrides; handoffs: on|off and folder. Mirror it with an in-vault `.openshore/vault.json`, or frontmatter in an `OpenShore.md` index note, so it travels with the vault the Obsidian way. Parse Obsidian properties (tags, aliases, `openshore: pin|exclude`) in the shared pure module (keyask-8) and honor aliases in resolveWikilink. Surface the main switches as Wayfinding and Vault rows, keeping defaults on.

**Verifier.** VaultSchema is only { dir } (schema.ts:213-220). A grep for frontmatter, aliases and tags across app vault.ts, VaultMarkdown.tsx, VaultScreen.tsx and vaultExport.ts finds nothing. resolveWikilink matches exact path, then filename (vault.ts:89-102), with no alias matching. No Settings row changes what reaches a model, and the Wayfinding rows are inert (keyask-3). There are no pins, excludes, per-class budgets or cloud or local-only scoping for notes.

### [keyask-14] No test proves vault content reaches any model; the existing 119 vault tests cover storage and tool I/O only

medium, test-gap, v1 must, size M, confirmed. `os-code/test/vaultTools.test.ts:22`

**Evidence.** vaultTools.test.ts covers write, read, list and path escape on the tool functions directly (lines 22-60). app vault, vaultStore, orgVault, gdrive and deviceFolder tests cover the seam. Nothing asserts that a system prompt or tool list contains vault context for any seat class or driver, or that a switch hands anything over. The scratch test showed the large-seat prompt has no vault mention while every existing test still passes.

**Impact.** The core promise, that models read your Vault, can regress or stay unbuilt with CI green. This is the same drift that let the Wayfinding Memory copy outlive its implementation.

**Proposed fix.** Add os-code/test/vaultContext.test.ts (a pack is present per class within budget, a small seat gets the pack without tools, Memory off removes it) and app/test/vaultContext.test.ts (every driver kind's system includes the pack, and switchModel seeds a handoff including into 'desktop'). Add a parity test for the shared note normalizer. Add an `osc eval` suite with and without the pack on the reference box, per tenet 2, before any copy claims a speedup.

**Verifier.** Vault-touching tests are vaultTools, routines and repoClone in os-code, and vault, vaultStore, vaultExport, orgVault, gdrive, deviceFolder and store in app. A grep for any assertion tying vault content to a system prompt or tool list returns nothing. vaultTools.test.ts exercises the tool functions directly. Nothing guards that Wayfinding switches have runtime consumers, which is how keyask-3 drifted. Priority is must only as part of building keyask-1, 4 and 7, since tests cannot precede the feature they guard.

### [missed-1/ctx] The engine never sets Ollama's served context window, so every context budget (compaction, meter, any future vault pack) is sized against a window the model is not running with

high, bug, v1 must, verifier-found. `os-code/src/providers/openaiCompatible.ts:214`

**Evidence.** chatOllama sends only temperature, num_predict and stop in `options` (openaiCompatible.ts:194-218), with no num_ctx. Yet the harness's contextTokens comes from the model's trained length: `if (k.endsWith('.context_length') ...) info.contextTokens = v` (131), falling back to defaultContextTokens, which is 32768 for qwen/deepseek and 131072 for llama3.1/3.2 (capabilities.ts:94-101). The loop compacts against that number: `compactHistory(this.history, caps.contextTokens, ...)` (loop.ts:672, budget 0.7x at compaction.ts:66), and the meter uses it too (loop.ts:1539-1540). The only num_ctx anywhere in the repo is app/scripts/guide-eval.ts:33. Nothing sets OLLAMA_CONTEXT_LENGTH either. The daemon /chat route (desktop-chat target) forwards the full message list the same way (serve.ts:715-725).

**Impact.** Unless the person configured Ollama themselves, it serves its own default window, about 4096 tokens on current releases and on a CPU-only box. The harness meanwhile believes it has 32k to 128k, so compaction triggers around 23k tokens, long after Ollama has already truncated the prompt and silently dropped the oldest turns, including the task statement and any injected notes. On the reference box this makes the per-class budgets in keyask-7 meaningless, and a vault or handoff pack would be dropped by the server without the harness knowing. The context meter also underreports.

**Proposed fix.** Choose a served window per seat: min(model context_length, a per-class or RAM-derived ceiling from ModelClassPolicy). Send it as options.num_ctx on every Ollama request, in the engine and in the /chat route. Use that same number for compaction, the meter, fitDeviceHistory-style fitting on desktop-chat, and the vault pack budget. Measure the prefill cost per class on the reference box with osc eval (tenet 2).

## Obsidian parity and compat honesty

Against the Obsidian baseline, Vault today does the basic wikilink loop well: [[target|alias]] parsing, case-insensitive exact-then-basename resolution, backlinks, `[[` autocomplete, and dashed links that create a note on tap. It covers almost nothing else Obsidian users rely on. There is no search UI (searchNotes is built and tested but never wired in), no rename or move (so no link updating), no properties, tags or aliases, no embeds or attachments, no callouts, daily notes or templates, and no settings beyond the engine's `vault.dir`. Several behaviors would corrupt or lose data in a vault that Obsidian also opens: the second autosave after a Google Drive conflict overwrites the other writer (proven with the repo's fake-Drive harness); the desktop folder provider overwrites Obsidian or agent edits with a stale draft; iCloud lists `.obsidian/` config and attachments as editable notes; and path normalization makes notes whose names contain `#`, `[`, `^`, `?` or `:` impossible to open or delete, even though the agent and Crew routines can create such names. The compatibility claim holds for only one place, desktop "This folder" (~/OSCode/Vault). It is false for the default Local provider (a sealed key-value store) and for Obsidian on iPhone (it only opens vaults in its own folder). It is one-way on Google Drive (drive.file hides notes Obsidian creates), and on desktop, Export writes to IndexedDB while the toast says it wrote files. For the "models first" part of the ask, the engine tools cannot resolve an Obsidian link by name, cannot search, and have no notion of provenance or which models may read a note. help.obsidian.md and obsidian.md were blocked by the egress proxy, so Obsidian behaviors come from reviewer knowledge plus web-search snippets of Obsidian's forum and help pages (iOS vault location limits).

**What is solid:**

- Obsidian wikilink grammar with alias and heading/block-suffix tolerance, resolved case-insensitively by exact path then basename (app/src/lib/vault.ts:19, 89-102)
- Backlinks computed from note bodies, credited to the note the link really resolves to, with the excerpt taken around that link, and cached by updatedAt so each note open is cheap (app/src/lib/vault.ts:106-134, app/src/state/store.ts:6154-6177)
- Live `[[` autocomplete that cancels on `]]`, a newline or the alias pipe, the way Obsidian does (app/src/lib/vault.ts:38-48, app/src/screens/VaultScreen.tsx:429-457)
- Unresolved links render dashed and create the note on tap, and a vault: URL transform lets wikilinks through while still blocking hostile schemes (app/src/components/VaultMarkdown.tsx:15-50)
- Autosave debounces, then flushes on background, unmount, note switch and scope change, and opening a note never rewrites its bytes (app/src/screens/VaultScreen.tsx:193-264)
- Desktop 'This folder' provider and the engine tools read and write real .md files under ~/OSCode/Vault, skip dot-entries so `.obsidian/` is never touched, and are path-jailed (app/electron/main.ts:933-973, os-code/src/core/tools/vault.ts:142-152)
- Agent vault writes always ask with a diff, ahead of any auto-allow path (os-code/src/core/tools/vault.ts:76-115, os-code/src/core/permissions/index.ts:151-156)
- Evicted iCloud placeholders are never opened as empty notes or overwritten (app/src/state/store.ts:6016-6036, app/plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/OscodeIcloudPlugin.swift:84-101)
- Google Drive keeps a real folder tree, writes a conflict copy on the first clash, and merges its index with tombstones (app/src/lib/gitos/gdrive.ts:50-77, 413-433)
- Team vault writes go only through a SECURITY DEFINER RPC that does last-write-wins plus a conflict copy (supabase/migrations/0010_org_vault.sql:67-121)
- Export refuses paths that would escape the export folder (app/src/lib/vaultExport.ts:18-23)

### [obs-1] Google Drive: the second autosave after a conflict overwrites the other writer's version

high, data-loss, v1 must, size M, confirmed. `app/src/lib/gitos/gdrive.ts:430`

**Evidence.** On a clash, writeFile saves OUR text as the conflict copy, then marks the base entry as current: `handle.index.files[path] = { id: cached.id, updatedAt: live.updatedAt, size: live.size };` (gdrive.ts:430). The store ignores the returned conflict path and keeps the editor pointed at the base path: `vaultNote: get().vaultNote?.path === path ? { path, text: saved.text, ... }` (store.ts:6108-6111). Proven with the repo's fake-Drive harness (a scratch test, since deleted): write 'v1'; another writer sets the file to 'OBSIDIAN EDIT'; write 'v1 + a' lands at `note (conflict 2026-09-26T20-21-49-539Z).md`; write 'v1 + ab' goes to `note.md`. What survives: note.md='v1 + ab', conflict copy='v1 + a'. 'OBSIDIAN EDIT' exists nowhere. The existing COR-5 test stops after one write, so it never sees this.

**Impact.** Someone edits a note in Obsidian (through Drive for desktop) or on a second device while the note is open in OpenShore. Two keystrokes later their edit is gone for good. The user sees no conflict notice, because isConflictCopy is never used in the UI.

**Proposed fix.** gdrive.ts: record the base modifiedTime from read() (the same pattern as orgVault's baseRev) and compare writes against that, not against a base refreshed at write time. store.ts vaultSave: when saved.path !== path, stop autosaving to the base, reload it, and show the note read-only with a 'Conflict: keep mine / keep theirs / open both' card built on isConflictCopy (vault.ts:167). Add a two-write regression test to app/test/gdrive.test.ts.

**Verifier.** I reproduced it with a copy of the fake-Drive harness in a scratch test, since deleted. Write 'v1'; another writer sets 'OBSIDIAN EDIT'; write 'v1 + a' returns 'note (conflict ...).md'; write 'v1 + ab' returns 'note.md'. The surviving files are note.md='v1 + ab' and the conflict copy 'v1 + a'. 'OBSIDIAN EDIT' is gone. The cause is gdrive.ts:430, which refreshes the base index entry to live.updatedAt. That lets the next write pass the guard at gdrive.ts:422 and hit putContent at :434. store.ts:6108-6111 keeps vaultNote on the base path and ignores saved.path, and VaultScreen keeps autosaving to vaultNote.path. isConflictCopy has no caller outside vault.ts, so nothing warns the user. The single-writer lease stops a second OpenShore device from writing, but it does not stop Obsidian editing through Drive for desktop, or Drive web. COR-5 (gdrive.test.ts:174-187) checks only one write.

### [obs-2] Notes whose names contain # ^ [ ] ? : and similar cannot be opened or deleted, and the agent and routines can create such names

medium, bug, v1 must, size M, confirmed. `app/src/lib/vault.ts:78`

**Evidence.** The app normalizes every path it opens, including paths it listed from disk: `.map((s) => s.trim().replace(/[<>:"|?*#^[\]]/g, ''))` (vault.ts:78), called from vaultOpen (store.ts:6004), and the listing lookup compares against that normalized name (store.ts:6011-6014). Scratch run: normalizeNotePath('C# notes.md') = 'C notes.md', 'What next?.md' = 'What next.md', 'Crew/[draft] plan.md' = 'Crew/draft plan.md'. The engine's normalizer, whose comment says 'the same shape the app uses', strips none of these (os-code/src/core/tools/vault.ts:24-34). Crew routines' safeName keeps `#`, `^`, `[` and `]` (os-code/src/routines/scheduler.ts:635-641). The NFC step also changes NFD names (a scratch check confirmed the name changes), and Google Drive matches names exactly.

**Impact.** A routine named 'C# nightly', or an agent note called 'Q&A?.md', appears in the tree, but tapping it opens a blank note under a different path. Typing then forks a second file, and Delete removes the wrong path, so the real note can never be removed from the app.

**Proposed fix.** Move path rules into one pure module exported through os-code/protocol and used by both app/src/lib/vault.ts and os-code/src/core/tools/vault.ts. Normalize only names a person types for a NEW note. Open, save and delete by the exact listed path. Have the engine's vaultWrite and routines' safeName apply the same rule for new names. Add a cross-package test that any name vaultWrite accepts can be opened by vaultOpen.

**Verifier.** Scratch run: 'C# notes.md' becomes 'C notes.md', 'Crew/C# nightly/2026-09-26 06-00.md' becomes 'Crew/C nightly/...', 'What next?.md' becomes 'What next.md', 'Ratio 1^2.md' becomes 'Ratio 12.md', and NFD names change. vaultOpen (store.ts:6004-6014) normalizes first, then looks the name up in the listing. A tree tap (VaultScreen.tsx:801 to openNote to vaultOpen) on such a name finds nothing, reads nothing, and opens a blank note under the stripped path. The first keystroke creates a second file. vaultDelete removes the stripped path, which on the files provider is a no-op because main.ts:972 checks existsSync. The engine's normalizer (os-code/src/core/tools/vault.ts:24-34) strips none of these characters. Routine safeName (scheduler.ts:635-641) keeps # ^ [ ]. I lowered severity from high to medium: nothing already saved is destroyed, and today it bites mainly on the opt-in desktop files provider, or on iCloud with names Obsidian created. It becomes more exposed once obs-3 makes files the desktop default. The same root cause, opening by a normalized, case-folded path instead of the exact listed one, also leaves one of 'Note.md' and 'note.md' unreachable on a case-sensitive Linux vault. Scratch: resolveWikilink('note', ['Note.md','note.md']) returns 'Note.md'.

### [obs-3] The Obsidian compatibility promise is shown for the default provider, which is a sealed key-value store, and the app and agent vaults are two different stores by default

high, claim-mismatch, v1 must, size M, confirmed. `app/src/screens/VaultScreen.tsx:857`

**Evidence.** The storage sheet always says: 'Your notes are files, and you choose the storage that holds them. Point Obsidian at the same files and it just opens.' (VaultScreen.tsx:856-858). The personal vault is created with `providerId: 'local'` on every platform (store.ts:5972-5977), and Local stores bytes as `oscode.gitos.file.<resourceId>.<path>` keys, 'sealed at rest' (local.ts, providers.ts:106-110). Nothing switches a desktop to 'files' (grep for the provider id outside lib/gitos finds nothing). Onboarding says 'You write in them, and so does your agent as it works' (VaultScreen.tsx:731-733), and Crew says 'Each run leaves a note in your vault' (CrewCommandScreen.tsx:465). The agent and routines write only to ~/OSCode/Vault.

**Impact.** A new user, even on desktop, gets a vault Obsidian cannot open and the agent can neither read nor write. The agent's notes and routine results never show up there. The core promise of the feature is false out of the box.

**Proposed fix.** On Electron, default the personal vault to 'files' (~/OSCode/Vault) and migrate existing Local notes with vaultMoveTo on first run. Make the storage-sheet copy per provider (Local: 'Private to this app. Export to open in Obsidian.'). On the phone, say plainly that agent notes live on the paired computer until a synced provider holds them.

**Verifier.** store.ts:5972-5977 creates the personal vault with providerId 'local', and vaultProviderId defaults to 'local' (store.ts:555-557). Nothing outside lib/gitos refers to the 'files' provider, and no code switches a desktop to it on first run. local.ts stores bytes as oscode.gitos.file.&lt;rid>.&lt;path> keys in the sealed KV store. The storage sheet copy (VaultScreen.tsx:856-858) is the same for every provider. The onboarding copy is also false on Local: 'Notes are .md files kept on this device' (:754) and 'You write in them, and so does your agent' (:731-733, :764-768). The agent's tools and Crew only touch ~/OSCode/Vault (registry.ts:145, scheduler.ts:681-683). On the phone no app-side model has vault tools at all, so the 'your agent writes here' promise fails there too, not only on Local.

### [obs-4] The engine's vault tools cannot follow Obsidian links, search, or see structure, which contradicts 'your agent follows those links'

high, gap, v1 must, size M, confirmed. `os-code/src/core/tools/vault.ts:130`

**Evidence.** vaultRead resolves only the literal path: `const rel = normalizeNotePath(args.path); ... if (!existsSync(abs)) return { ok: true, content: `No vault note at ${rel} yet.` }` (vault.ts:130-133). The description then invites 'you may then propose creating it with vaultWrite' (vault.ts:124). So vaultRead('Ideas') misses Projects/Ideas.md. vaultList returns only `${rel} (${size}b)` (vault.ts:149), with no title, aliases, tags, mtime, links or summary. No vaultSearch tool exists (registry.ts:86-88). The welcome note and onboarding say 'Your agent follows those links to find what it needs' (VaultScreen.tsx:294-295, 778-779).

**Impact.** Models call vaultList and then guess paths, spend tokens reading whole notes to find one fact, and propose duplicate root-level notes for [[links]] that already resolve in Obsidian. This works against the 'move faster and smarter, optimize context' goal.

**Proposed fix.** Using the shared resolver (see obs-2), make vaultRead resolve bare names and aliases the Obsidian way and return frontmatter, resolved outgoing links and backlinks. Add vaultSearch (text, plus tag:, path:, file: and property filters, returning snippets) and a compact vaultMap (path, title, aliases, tags, summary property, updated) sized to the seat's context budget. Update the tool descriptions to say 'search before you write'.

**Verifier.** vaultRead takes only a literal path (vault.ts:130-133), so 'Ideas' is read as the root file Ideas.md. It tells the model to propose creating the note when it is missing (:124). vaultList returns only 'path (size b)' (:149). The registry registers only vaultRead, vaultList and vaultWrite (registry.ts:86-88). A search of os-code/src found no other retrieval over vaultRoot: the workspace grep and glob tools are jailed to cwd, and nothing in harness/ touches the vault. The copy 'Your agent follows those links' (VaultScreen.tsx:294-295, 778-779) cannot be true, because no tool resolves a wikilink.

### [obs-5] The desktop 'This folder' provider (the one advertised for Obsidian) overwrites Obsidian or agent edits with a stale draft

high, data-loss, v1 must, size M, confirmed. `app/electron/main.ts:967`

**Evidence.** `guarded('osc:vaultWrite', (p, t) => { ... writeFileSync(abs, text); ...})` (main.ts:962-969) writes with no mtime or hash base check. deviceFolder.ts says 'Concurrency is last-write-wins at the file level (you, the agent, and Obsidian can all touch it)'. The open note's `draft` is loaded once per path (VaultScreen.tsx:179-182), and every keystroke saves the whole draft (VaultScreen.tsx:413-415). PROGRESS already notes 'no live fs-watch'.

**Impact.** With a note open in OpenShore, an approved agent vaultWrite, a Crew append, or an Obsidian edit to that note is silently reverted by the next keystroke. The approval-diff guarantee means little if the approved text can be wiped this way.

**Proposed fix.** Pass the base updatedAt (or a content hash) through bridge.vaultWrite. main.ts refuses a write when the file changed on disk, and the store shows the same conflict card as obs-1. Watch the vault directory with fs.watch in main.ts and push change events, so a note open in read mode reloads and one being edited is flagged.

**Verifier.** osc:vaultWrite (main.ts:962-969) writes with no base check. The draft is set only when vaultNote.path changes (VaultScreen.tsx:179-182). vaultRefresh on returning to the app updates only vaultFiles (store.ts:5989-5990) and never re-reads the open note. vaultNote survives leaving the Vault view, because only backToNotes, a scope change or sign-out clears it. So this common flow loses data: open a note, go to chat, approve an agent vaultWrite append to that note, come back. The screen remounts with the stale store text, and the first edit keystroke overwrites the approved text. Small correction: the 'no fs-watch' note is in os-code/docs/progress-archive.md:3802, not in PROGRESS.md.

### [obs-6] No search anywhere in the Vault UI, although searchNotes is built and tested

high, gap, v1 must, size M, confirmed. `app/src/screens/VaultScreen.tsx:10`

**Evidence.** VaultScreen imports only `backlinksTo, noteFolder, noteTitle, normalizeNotePath, treeAt, wikilinkContext` (VaultScreen.tsx:10-17). A grep for searchNotes and isConflictCopy across app/src and os-code/src finds only their definitions in vault.ts. app/test/vault.test.ts:180 is titled 'searchNotes (review 6: a way to find a note)'. The only way to find a note is to tap through folders.

**Impact.** Past a few dozen notes (a few weeks of Crew routines writing Crew/&lt;routine>/&lt;stamp>.md), finding anything on a phone is tedious. Obsidian's quick switcher and search are the features people use most.

**Proposed fix.** Add a search field above the tree in VaultScreen.tsx that calls searchNotes over vaultReadAll's cached bodies, with a quick-switcher style title match first. Add Obsidian operators in vault.ts: tag:, path:, file:, line:, and "exact phrase". Share the query parser with the engine's vaultSearch (obs-4).

**Verifier.** VaultScreen imports only backlinksTo, noteFolder, noteTitle, normalizeNotePath, treeAt and wikilinkContext (VaultScreen.tsx:10-17). searchNotes and isConflictCopy have no callers anywhere in app/src or os-code/src outside vault.ts. No other surface reads vaultFiles or vaultReadAll (Sidebar and App only route to the screen). The only way to find a note is to browse the folder tree.

### [obs-7] No rename or move of notes or folders, so Obsidian's 'automatically update internal links' has nothing to hook onto

high, gap, v1 must, size L, confirmed. `app/src/lib/gitos/providers.ts:59`

**Evidence.** The seam is `list, stat, read, write, remove` plus lease operations, with no rename (providers.ts:59-77). The note Options sheet offers only 'Delete this note' and Cancel (VaultScreen.tsx:504-535). Folders exist only as a side effect of a slash in a new note's name, and there is no create-folder, delete-folder or move action.

**Impact.** A misnamed note, or one the agent filed in the wrong folder, can only be fixed by copy, paste and delete. Every [[link]] to it breaks, and on Drive or iCloud the file loses its identity and history. Obsidian users rename constantly and expect their links to follow.

**Proposed fix.** Add rename(resourceId, from, to) to StorageProvider: fs.rename in main.ts and the engine, a coordinated move in the iCloud plugin, a PATCH of name and parents on Drive, and a new org RPC. Add a pure rewriteLinks(from, to, notes) in vault.ts that uses the shared resolver and keeps aliases and heading suffixes, and ask 'Update N links in M notes?' the way Obsidian does. Add folder create, rename and delete.

**Verifier.** The StorageProvider interface (providers.ts:60-79) has only list, stat, read, write, remove and the lease operations. A search for rename or move across gitos, vault.ts, VaultScreen and main.ts finds nothing. The Options sheet offers only Delete and Cancel (VaultScreen.tsx:504-535). Folders appear only as a side effect of a slash in a new note's name. Plain rename and move is a must for v1. Rewriting links on rename could be split out as a fast follow if scope forces it.

### [obs-8] Frontmatter (Obsidian Properties) renders as a big heading; tags and aliases are not understood

high, gap, v1 must, size M, confirmed. `app/src/components/VaultMarkdown.tsx:30`

**Evidence.** `remarkPlugins={[remarkGfm]}` (VaultMarkdown.tsx:30), with no frontmatter plugin. Scratch render of '---\ntags: [project, ai]\naliases: [VP]\n---\n\n# Body' produced `<hr/>\n<h2>tags: [project, ai]\naliases: [VP]</h2>\n<h1>Body</h1>`. '#project/alpha' renders as plain text. resolveWikilink and autocomplete look only at file names (vault.ts:89-102, VaultScreen.tsx:324-333), never at `aliases`.

**Impact.** Every note written with Obsidian's Properties UI, which by default carries tags, created dates and aliases, opens in OpenShore with a large YAML heading. Links to an alias show as unresolved and create a duplicate note on tap. Models lose the cheapest retrieval signal a vault has.

**Proposed fix.** Add remark-frontmatter and a YAML parse in VaultMarkdown.tsx, and show a quiet properties card that is hidden when empty. Index tags, including nested tags, and aliases in a pure vault.ts metadata pass shared with the engine. Resolve and autocomplete aliases. Never reserialize the YAML: edits keep it byte-for-byte.

**Verifier.** The markdown renderer has only remarkGfm (VaultMarkdown.tsx:30). I reproduced the render: the frontmatter becomes &lt;hr/>&lt;h2>tags: [project, ai]\naliases: [VP]&lt;/h2>, because the closing --- turns it into a setext H2. '#project/alpha' renders as plain &lt;p>. resolveWikilink and the autocomplete match file names only, and the codebase has no YAML or alias handling.

### [obs-9] iCloud lists .obsidian config, attachments and .canvas files as editable notes, and a move can overwrite another vault's .obsidian

medium, bug, v1 must, size S, partial. `app/src/lib/gitos/icloud.ts:27`

**Evidence.** The native list enumerates every regular file with no .skipsHiddenFiles option. Its own handling of hidden `.<name>.icloud` placeholders shows that hidden entries are enumerated (OscodeIcloudPlugin.swift:78-107). The JS layer drops only the lease: `files.filter((f) => f.path !== LEASE_PATH)` (icloud.ts:27). A scratch run of treeAt over ['.obsidian/app.json','Canvas.canvas','pic.png','Note.md'] returned a '.obsidian' folder row plus notes named 'Canvas.canvas' and 'pic.png'. By contrast, the desktop bridge filters correctly: `if (entry.name.startsWith('.')) continue; ... /\.md$/i` (main.ts:939-942). vaultMoveTo copies every listed file (store.ts:6227-6250), and the target 'files' stat cannot see dot-files, so the 'target is newer' guard never fires.

**Impact.** After Obsidian on a Mac opens the iCloud folder, the phone shows a '.obsidian' folder whose JSON opens as a note and autosaves back into Obsidian's config. Binary files open to an endless 'Still downloading' toast. Every note open re-reads workspace.json for backlinks. Moving the vault iCloud to 'This folder' overwrites that folder's own .obsidian settings.

**Proposed fix.** Apply one filter at the seam (a helper in providers.ts used by every provider): notes are *.md; skip dot-segments; list known attachment types as non-note entries once obs-10 lands; honor userIgnoreFilters from .obsidian/app.json. Make vaultMoveTo copy only filtered entries.

**Verifier.** The main claim holds. The Swift list (OscodeIcloudPlugin.swift:74-107) enumerates without .skipsHiddenFiles, and icloud.ts:27 drops only the lease file. Scratch treeAt returns a '.obsidian' folder row plus 'Canvas.canvas' and 'pic.png' as notes. A binary read returns found:false (String(data:encoding:.utf8) is nil for non-UTF-8 bytes), so vaultOpen shows 'Still downloading' (store.ts:6030-6035). The desktop bridge filters correctly (main.ts:939-942). The sub-claim that moving from iCloud to 'This folder' overwrites that folder's .obsidian cannot happen. iCloud is ready only on iOS (on Electron the web mock reports available:false), 'files' is ready only on Electron, and gitosResources is device-local settings, so one device never has both providers. What can happen is iCloud to Local or iCloud to Drive on the phone, which copies .obsidian/*.json as notes.

### [obs-10] Obsidian on iPhone cannot open the export folder or the iCloud folder, contrary to the copy

medium, claim-mismatch, v1 must, size L, confirmed. `app/src/lib/vaultExport.ts:3`

**Evidence.** The export comment says 'That folder is exactly what Obsidian mobile opens as a vault, so the handoff is literal' (vaultExport.ts:2-6). The toast says 'exported to Files, under OpenShore / Vault. Obsidian opens that folder as a vault.' (VaultScreen.tsx:960). The iCloud plugin says files 'open in Obsidian mobile unchanged' (OscodeIcloudPlugin.swift:4-7), and parked-ideas.md repeats 'Obsidian mobile opens it as a vault'. Obsidian on iOS only opens vaults inside its own folder (On My iPhone > Obsidian, or iCloud Drive > Obsidian). Obsidian's sync help page and several 2025-2026 forum threads confirm it has no 'open folder as vault' for other locations. Export writes to OpenShore's container; the iCloud provider writes iCloud Drive/OpenShore/vault.personal. Obsidian on a Mac can open the iCloud folder.

**Impact.** An iPhone-only user follows the toast, opens Obsidian, and cannot reach the folder. Export is also a one-way snapshot that the next export wipes (rmdir, vaultExport.ts:36-43), so edits made there are lost.

**Proposed fix.** Short term: rewrite the three strings (Mac/desktop Obsidian opens the iCloud folder; on iPhone, copy the exported folder into On My iPhone > Obsidian). Real fix for v1: an iOS 'Use a folder' provider built on UIDocumentPicker folder selection with a security-scoped bookmark, so OpenShore reads and writes an existing Obsidian vault in iCloud Drive/Obsidian in place. Name the folder 'Vault' (or let the user choose), not the resource id 'vault.personal'.

**Verifier.** The code claims are accurate. vaultExport.ts:2-6 says the export folder is exactly what Obsidian mobile opens as a vault. The toast at VaultScreen.tsx:960 says the same. OscodeIcloudPlugin.swift:4-7 says files 'open in Obsidian mobile unchanged', and os-code/docs/parked-ideas.md:325-326 repeats it. The iCloud root is Documents/&lt;resourceId>, which is 'vault.personal'. Export rmdirs its root first (vaultExport.ts:36-43). On the iOS limit: Obsidian forum threads and feature requests (open existing vault outside iCloud/Obsidian, full file system access on iOS) and the Obsidian sync help page point to iCloud Drive/Obsidian or On My iPhone/Obsidian as the only vault locations. That rests on web-search snippets, not a live product check. Priority split: rewriting the copy is a must and size S. The UIDocumentPicker folder provider (size L) is closer to should than must.

### [obs-11] On desktop, 'Export as plain files' writes to IndexedDB and reports success

medium, bug, v1 must, size S, confirmed. `app/src/lib/vaultExport.ts:34`

**Evidence.** `if (platform() === 'web') return undefined;` (vaultExport.ts:34). On desktop platform() returns 'electron' (platform.ts:12-16), so export goes on to call @capacitor/filesystem. Electron registers no native Filesystem plugin (no match in app/electron/), so the web implementation runs, and it stores files in IndexedDB database 'Disc' (node_modules @capacitor/filesystem/dist/esm/web.js:27, 94). The button renders on every platform (VaultScreen.tsx:946-968), and the toast says the notes were 'exported to Files ... Obsidian opens that folder as a vault.'

**Impact.** A desktop user who wants their notes out, the 'true-compat escape hatch' named in DECISIONS.md, gets a success toast and no files on disk.

**Proposed fix.** On Electron, add an IPC call in main.ts that writes the notes to a folder the user picks with dialog.showOpenDialog, or hide Export on desktop and offer 'Keep the vault as a folder' (move to 'files') instead. Add a test that export never reports a count on Electron without a real write.

**Verifier.** vaultExport.ts:34 skips only when platform() is 'web'. platform() returns 'electron' on desktop (platform.ts:12-15), and Capacitor.isNativePlatform() is false there. app/electron has no Filesystem plugin, so registerPlugin falls back to FilesystemWeb, which writes to the IndexedDB database 'Disc' (node_modules/@capacitor/filesystem/dist/esm/web.js:27, 94). The Export button is rendered on every platform (VaultScreen.tsx:946-968) and reports '&lt;n> notes exported to Files'.

### [obs-12] No attachments or embeds: images break, move and export drop binary files, and tapping a link to a file creates a junk .md

medium, gap, v1 should, size L, confirmed. `app/src/lib/vault.ts:149`

**Evidence.** Embeds become a chip: `` `embed not supported yet: ${name}` `` (vault.ts:147-150). A scratch render of '![alt](attachments/pic.png)' gave `<img src="attachments/pic.png">`, which resolves against the app's URL and shows a broken image. The seam carries text only (StoredFile.text, providers.ts:28-33). The iCloud plugin decodes as UTF-8 and returns found:false for binaries (Swift:148-149), so vaultMoveTo skips them silently (store.ts:6229-6232) and export never sees them. normalizeNotePath appends .md to any target (vault.ts:82), so tapping [[spec.pdf]] creates 'spec.pdf.md'.

**Impact.** Research notes with diagrams or screenshots, which are common in Obsidian vaults, are unreadable in OpenShore. Moving providers leaves images behind while the toast says 'Your vault lives on X now.' Stray .pdf.md files appear in the user's Obsidian vault.

**Proposed fix.** Add a bytes path to the seam (readBytes/writeBytes, or StoredFile.bytes). Resolve attachments with attachmentFolderPath from .obsidian/app.json. Render images from blob URLs and show PDFs as openable chips. Transclude ![[Note]] and ![[Note#Heading]] one level deep. Never append .md to a target with a known non-markdown extension. Make vaultMoveTo count and report skipped files.

**Verifier.** All claims reproduced in a scratch run. Embeds become the 'embed not supported yet' chip (vault.ts:147-150). '![alt](attachments/pic.png)' renders as &lt;img src="attachments/pic.png">, a relative URL that nothing serves. StoredFile carries text only (providers.ts:28-33). [[spec.pdf]] becomes [spec.pdf](vault:spec.pdf.md?new), and a tap runs vaultCreate, which writes an empty spec.pdf.md right away. vaultMoveTo drops files whose read() returns undefined (store.ts:6229-6232) and still reports success.

### [obs-13] Markdown-style internal links open as broken external links, and relative wikilinks resolve to the wrong note

medium, bug, v1 should, size S, confirmed. `app/src/components/VaultMarkdown.tsx:53`

**Evidence.** Every non-vault: href falls through to `<a href={href} target="_blank" ...>` (VaultMarkdown.tsx:52-56). A scratch render of '[Other](Other%20Note.md)' gave `<a href="Other%20Note.md" target="_blank">`. resolveWikilink has no source path (vault.ts:89) and normalizeNotePath drops '..', so resolveWikilink('../Projects/Plan', ['Archive/Plan.md','Work/Projects/Plan.md']) returned 'Archive/Plan.md'.

**Impact.** Vaults that set Obsidian's 'Use [[Wikilinks]]' off, or its 'New link format' to relative or absolute (common with Git or static-site workflows), have dead or wrong links in OpenShore, and backlinks credit the wrong note.

**Proposed fix.** Give resolveWikilink and backlinksTo a sourcePath and handle './' and '../' relative to it. In VaultMarkdown, treat relative hrefs that end in .md (after URL-decoding) as vault links. Honor newLinkFormat and useMarkdownLinks from .obsidian/app.json when inserting links.

**Verifier.** Reproduced. '[Other](Other%20Note.md)' renders as &lt;a href="Other%20Note.md" target="_blank">. resolveWikilink('../Projects/Plan', ['Archive/Plan.md','Work/Projects/Plan.md']) returns 'Archive/Plan.md'. It is worse than reported: the resolver has no path-suffix matching at all. resolveWikilink('Projects/Plan', same list) also returns 'Archive/Plan.md', where Obsidian resolves the partial path to Work/Projects/Plan.md (see the missed item obs-m1 below).

### [obs-14] No customization: the app has no vault settings, the engine has only vault.dir, and .obsidian config is never read

medium, gap, v1 should, size M, confirmed. `os-code/src/config/schema.ts:213`

**Evidence.** `export const VaultSchema = z.object({ dir: z.string().optional() })` (schema.ts:213-220). Electron reads the same key from global config only (main.ts:920-926). A grep of app/src/state/types.ts and SettingsScreen.tsx finds no vault setting. No code reads .obsidian/app.json, daily-notes.json or templates.json.

**Impact.** The ask is 'amazing out of the box but fully customizable'. Today, pointing OpenShore at an existing Obsidian vault means hand-editing os-code.config.json on desktop, and nothing (folder for new notes, link format, attachment folder, excluded folders, daily note format) can be set in the app.

**Proposed fix.** Add a Vault settings sheet: location, including 'Open an existing Obsidian vault' (a folder picker on desktop, UIDocumentPicker on iOS); default folder for new notes; daily note folder and format; templates folder; link format; attachments folder; folders hidden from models. Default every field from .obsidian/*.json when present, so an existing vault configures itself.

**Verifier.** VaultSchema is z.object({ dir: z.string().optional() }) (schema.ts:213-220). SettingsScreen.tsx and state/types.ts have no vault settings. Nothing in app/src or os-code/src reads .obsidian/app.json, daily-notes.json or templates.json. main.ts:920-926 resolves vault.dir through loadConfig().

### [obs-15] No provenance on agent-written notes and no per-note control over which models may read them

medium, gap, v1 should, size M, confirmed. `os-code/src/core/tools/vault.ts:107`

**Evidence.** vaultWrite writes the model's content as-is: `writeFileSync(abs, after);` (vault.ts:106-107), with no record of which seat, model or session wrote it. Routine notes put the session id in body prose only: `Crew: ... · session ${active.driver.id}` (scheduler.ts:597). vaultRead returns any note to any seat, cloud seats included (vault.ts:121-136), with no local-only marker. This conflicts with tenet 4's teal/amber split.

**Impact.** When a person switches models, the next model cannot tell a human-verified decision from an unreviewed agent guess. A note the person considers private (health, finances, credentials context) goes to a cloud model the first time that model calls vaultRead.

**Proposed fix.** Reserve an `openshore:` frontmatter namespace: source (person or agent), model, seat class (local or cloud), session, created, updated, reviewed, and visibility (all, local-only, or none). The engine merges these into existing YAML on write without clobbering the person's keys. vaultRead and vaultSearch enforce visibility against the seat class. The note view shows a small teal or amber provenance chip. A per-folder default (for example Private/ as local-only) comes from Vault settings (obs-14).

**Verifier.** vaultWrite writes the model's content verbatim (vault.ts:104-107) with no seat, model or session record. The routine note puts the session id only in body prose (scheduler.ts:597). vaultRead and vaultList are registered for every seat, local or cloud (registry.ts:86-88). The engine already has a precedent for local-only data: secretsGate.ts sends project secrets only to a local orchestrator. The vault has no equivalent, so any note can reach a cloud model. Tying this to tenet 4 is a loose fit; the secretsGate precedent is the stronger argument.

### [obs-16] Missing core Obsidian reading and navigation features: unlinked mentions, outgoing links, outline, daily notes, templates, bookmarks, callouts, highlights, comments, block ids

medium, gap, v1 should, size M, confirmed. `app/src/components/VaultMarkdown.tsx:60`

**Evidence.** Scratch renders: '> [!warning] Careful' gave `<blockquote><p>[!warning] Careful ...`; 'visible %%hidden comment%% end' shows the comment; '==marked==' is literal; [[Note#Section]] and [[Note#^abc123]] both display just 'Note' and open the top of the note. VaultScreen has only Linked mentions (VaultScreen.tsx:472-485). There is no outline, no daily note or template command, and no bookmarks or recents.

**Impact.** Obsidian notes that use %% %% to hide text show it in reading view, and callout-heavy notes lose their structure. There is no quick way to jump to today's note, which is where Crew routines and a person's day meet.

**Proposed fix.** Add small remark plugins for callouts, ==highlight==, %%comments%% (hidden) and ^block-ids (hidden, used as anchors). Scroll to the heading or block and label links 'Note > Heading'. Add an outline sheet built from headings. Add a 'Today' daily-note command using Vault settings, which routines could also append to. Add templates from a templates folder with {{date}}/{{title}}. Add unlinked mentions (a title search excluding linked notes) under Linked mentions.

**Verifier.** Reproduced. '> [!warning] Careful' renders as a plain blockquote showing the literal '[!warning]'. '%%hidden comment%%' and '==marked==' render as literal text. [[Note#Section]] and [[Note#^abc123]] both render as a link labelled 'Note' to vault:Note.md, because WIKILINK drops the suffix (vault.ts:19, :157). The screen has only Linked mentions (VaultScreen.tsx:472-485), with no outline, daily note, template, bookmark or unlinked-mentions feature.

### [obs-17] The [[ autocomplete inserts a bare title even when the name is ambiguous, so the link points at a different note

low, bug, v1 should, size S, confirmed. `app/src/screens/VaultScreen.tsx:439`

**Evidence.** Chips are built from `{ p, t: noteTitle(p) }` and a pick calls `insertWikilink(t)` (VaultScreen.tsx:326, 439), which writes `[[${targetName}]]` (VaultScreen.tsx:342). The resolver breaks ties by shortest path: scratch resolveWikilink('Plan', ['Work/Plan.md','Zz/Plan.md','a/Plan.md']) returned 'a/Plan.md'.

**Impact.** With two 'Plan' notes the picker shows two identical chips, and choosing Work/Plan links to a/Plan. Obsidian inserts the shortest unambiguous path in this case.

**Proposed fix.** Insert the shortest path suffix that is unique across the vault. Show the folder as a sub-label on chips when titles collide.

**Verifier.** The chips show only noteTitle (VaultScreen.tsx:326, :442), and a pick calls insertWikilink(t), which writes [[t]] (:337-345). A scratch run of resolveWikilink('Plan', ['Work/Plan.md','Zz/Plan.md','a/Plan.md']) returned 'a/Plan.md'. Two identically labelled chips therefore insert the same link, which points at the shortest path.

### [obs-18] Wikilinks inside code spans and fenced blocks are rewritten and counted as backlinks

low, bug, v1 should, size S, confirmed. `app/src/lib/vault.ts:151`

**Evidence.** The link rewrite is a regex over the raw source that runs before markdown parsing (vault.ts:146-158). Scratch: 'use `[[Foo]]` syntax' rendered `<code>[Foo](vault:Foo.md?new)</code>`. backlinksTo('Foo.md') credited a note whose only mention is inside a ``` fence.

**Impact.** Notes that document Obsidian syntax, or code the agent saved, show corrupted code in reading view, and backlink counts are inflated.

**Proposed fix.** Do the wikilink transform as a remark plugin on mdast text nodes, so code and inlineCode are skipped. Derive backlinks from the same AST pass so the reader and the index always agree.

**Verifier.** Reproduced. 'use `[[Foo]]` syntax' renders as &lt;code>[Foo](vault:Foo.md?new)&lt;/code>. backlinksTo('Foo.md', ...) credits a note whose only mention is inside a ``` fence. The rewrite is a regex over the raw text that runs before the markdown parser (vault.ts:146-158).

### [obs-19] Graph view, canvas and Bases are absent; the team vault has no Obsidian path at all

low, gap, v1 later, size L, confirmed. `app/src/screens/VaultScreen.tsx:786`

**Evidence.** The tree view is the only way to browse (VaultScreen.tsx:786-807). There is no graph or local graph, and .canvas files are not rendered; on iCloud they show as text notes (obs-9). Team notes live in Postgres (0010_org_vault.sql:20-35), and the storage and export sheet is hidden in team scope (VaultScreen.tsx:590).

**Impact.** These are nice to have for people but matter less for models. The main risk is corruption rather than absence: a .canvas file opened as a note could be damaged by an edit.

**Proposed fix.** Later: a local graph (1-hop) in the note view built from the link index, and a read-only canvas preview. For v1, hide .canvas files (obs-9). For the team vault, add a 'Download as folder' export and state in the copy that it is not an Obsidian folder.

**Verifier.** The tree is the only browse view (VaultScreen.tsx:786-807). There is no graph or canvas rendering, .canvas files show as notes on iCloud (see obs-9), team notes live in Postgres, and the storage/export sheet is hidden in team scope (VaultScreen.tsx:590). 'Later' is the right priority. Hiding .canvas is covered by obs-9.

### [obs-m1] Links that name a folder resolve to a same-named note in a different folder, so a link meant to create a new note opens the wrong one

medium, bug, v1 must, size S, verifier-found. `app/src/lib/vault.ts:97`

**Evidence.** resolveWikilink falls back to matching only the last path segment and ignores the folder part: `const base = lower.split('/').pop()!; const byName = paths.filter((p) => p.toLowerCase().split('/').pop() === base)` (vault.ts:97-101). Scratch run: resolveWikilink('Ideas/Plan', ['Archive/Plan.md']) returned 'Archive/Plan.md', and backlinksTo('Archive/Plan.md', ...) credited 'Today.md', whose text is 'start [[Ideas/Plan]] here'. resolveWikilink('Projects/Plan', ['Archive/Plan.md','Work/Projects/Plan.md']) also returned 'Archive/Plan.md'.

**Impact.** A person or model writes [[Ideas/Plan]] to start a new note in Ideas. OpenShore shows it as a solid, resolved link, opens the unrelated Archive/Plan.md, and lists it under that note's Linked mentions. Obsidian would show the link as unresolved and create Ideas/Plan.md, or would resolve a partial path such as Projects/Plan to the note whose path ends with it. The graph is quietly wrong, and so are backlinks and any link context handed to a model.

**Proposed fix.** In the shared resolver (see obs-2 and obs-4), when the target contains a slash, match only paths that equal it or end with '/' + target (case-insensitive), preferring the shortest. Fall back to basename matching only for bare names. Add cases to app/test/vault.test.ts for a folder-qualified target that is missing and for a partial path.

## Out-of-the-box defaults and customization

Out of the box, Vault is two unconnected stores that the copy describes as one. On desktop the app's personal vault defaults to the sealed Local key-value store, while the agent's vault tools and Crew routines write to ~/OSCode/Vault. On the phone and on a paired phone, no chat driver or daemon route reaches any vault. So the onboarding promise ("you and your agent both write here", "the agent follows the links") only holds after a manual, unexplained move to "This folder" on a desktop. Customization is thin and mostly JSON-only. The one real knob, vault.dir, has no UI, no ~ expansion, and can be overridden by a cloned repo's os-code.config.json. The Wayfinding Memory switch is saved but gates nothing. A deny rule for vaultWrite is shadowed by alwaysAsk. There is no context budget, default folder layout, template, daily note, or per-folder agent access. The small and tiny seats (the founder's 7B reference box) never see the vault tools at all, yet 58% of their system prompt tells them to use projectMemoryWrite, a tool they are not given. For v1: make desktop one folder by default, make the copy honest per surface, wire or remove the Memory switch, give lean seats a coherent vault slice with a budget, move vault.dir to machine config with a folder picker, and honor deny. Over-building for v1: graph view, per-note ACLs in the team vault, a plugin or theme system, and per-folder model routing.

**What is solid:**

- Agent vault tools are jailed to their own root, symlink-safe, and vaultWrite always shows a unified-diff preview before landing (os-code/src/core/tools/vault.ts:16-20, 76-115; os-code/src/core/security/jail.ts:28-40)
- App note-path normalization strips traversal segments, filesystem-forbidden characters and Obsidian link syntax, NFC-normalized (app/src/lib/vault.ts:68-83)
- Obsidian-faithful wikilink resolution: exact path first, then shortest unique basename; backlinks derived, never stored (app/src/lib/vault.ts:89-134)
- Storage seam with Local, This folder (desktop), iCloud and Google Drive; moving the vault copies first and lands a conflict copy instead of regressing newer work (app/src/state/store.ts:6213-6258, app/src/lib/gitos/index.ts:18-42)
- Offline durability: failed writes are stashed to the sealed store and replayed on the next successful list or write (app/src/state/store.ts:3014-3053, 6124-6134)
- Dotfolders (.obsidian, .trash) are skipped by both the engine list and the Electron list, so pointing at a real Obsidian vault does not leak its config (os-code/src/core/tools/vault.ts:144; app/electron/main.ts:938)
- In-flow onboarding ramp and an opt-in welcome note replaced the broken fixed .greeting (app/src/screens/VaultScreen.tsx:720-784; docs/design/vault-page-redesign.md)
- Tokens and Secrets is correctly kept out of any vault, in the sealed device store (app/src/lib/projectSecrets.ts:6-15)
- Project memory prompt teaches a top-sheet-first read, a good context-economy pattern for mid and large seats (os-code/src/core/agent/projectMemory.ts:216-231)
- Routine results land deterministically under Crew/&lt;routine>/&lt;stamp>.md without an approval an unattended run could never give (os-code/src/routines/scheduler.ts:581-617)
- Export to plain files is the true-compat escape hatch (app/src/lib/vaultExport.ts; VaultScreen.tsx:946-968)

### [custom-1] On desktop, the app's Vault and the agent's vault are different stores by default

high, gap, v1 must, size M, confirmed. `app/src/state/store.ts:5976`

**Evidence.** vaultRefresh auto-registers the personal vault as `{ id: VAULT_RESOURCE_ID, name: 'Vault', kind: 'vault', providerId: 'local', ... }` on every platform (store.ts:5970-5979). Local is the sealed KV store (`oscode.gitos.file.<resourceId>.<path>`, app/src/lib/gitos/local.ts:8-16). The agent's tools resolve `const vaultRoot = config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault')` (os-code/src/core/agent/registry.ts:145), and so do routine notes (scheduler.ts:681-684). The shared folder is the 'files' provider (deviceFolder.ts:1-11). Per progress-archive.md:3797-3799 the person has to move to it by hand from the Where it lives sheet. Nothing selects it on Electron: grep finds no `providerId: 'files'` default anywhere.

**Impact.** A new desktop user writes notes in Vault, and the agent's vaultList answers 'The vault is empty.' The agent's approved vaultWrite notes and every Crew routine note never appear in the Vault room. The feature's core promise, one knowledge base shared by you and your models, is broken until the person finds and taps 'This folder'.

**Proposed fix.** On Electron, default the personal vault to 'files' on first open. If a Local vault already has notes, run the existing vaultMoveTo('files') once with its conflict-copy logic (store.ts vaultRefresh and vaultMoveTo). Show the absolute folder path in the storage sheet with Reveal folder and Open in Obsidian (obsidian://open?path=). Add a desktop-platform case to app/test/vaultStore.test.ts.

**Verifier.** vaultRefresh auto-registers the personal vault with providerId 'local' on every platform (app/src/state/store.ts:5970-5977), and vaultProviderId falls back to 'local' (store.ts:555-557). No code anywhere selects 'files' by default: the only references to the 'files' id are the provider definition, the roster and probeReady (gitos/index.ts:38). The engine resolves `config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault')` (os-code/src/core/agent/registry.ts:145), and so does scheduler defaultVaultRoot (scheduler.ts:681-684). progress-archive.md:3797-3799 confirms the person moves the vault by hand from the Where it lives sheet. On a default desktop, vaultList runs against ~/OSCode/Vault while the room reads the sealed KV store.

### [custom-2] Onboarding, welcome note, and storage copy promise agent access that does not exist on most surfaces

high, claim-mismatch, v1 must, size S, partial. `app/src/screens/VaultScreen.tsx:731`

**Evidence.** Onboarding lead: 'You write in them, and so does your agent as it works' (731-734). 'The agent saves what it learns and reads your notes back' (764-768). 'The agent follows the links to find what it needs' (777-780). The welcome note repeats these (289-296). The storage sheet, for any provider including Local: 'Point Obsidian at the same files and it just opens.' (856-858). The app/src/drivers files have no vault reference (grep of cloudClaudeDriver, stackDriver, onDeviceDriver and the rest returns none). The engine vaultRead resolves only an exact path, `normalizeNotePath(args.path)` then `jail.resolve(rel)` (os-code/src/core/tools/vault.ts:130-134), so [[Ideas]] for Projects/Ideas.md reads as 'No vault note at Ideas.md yet.' Crew copy 'Saved in your vault: {note.path}' (CrewCommandScreen.tsx:1043) and the guide card 'Routines leave their notes here' (guideCards.ts:537) point at a folder the phone's Vault never shows.

**Impact.** On a phone, on a desktop left on the default, or on a paired phone, the person is told their agent reads and writes these notes. It does not. This breaks the honesty standing rule and the founder's framing of Vault as the context layer.

**Proposed fix.** Make the copy provider-aware in VaultScreen.tsx. When the provider is not 'files' on desktop, or on any phone, say what is true, for example: 'Your agent on your computer uses the folder vault. Move here to share it.' Also show Obsidian compat only for file-backed providers. Add a vault-backed wikilink resolver to the engine (reuse app resolveWikilink semantics in os-code/src/core/tools/vault.ts) before keeping the 'follows links' line. Add a copy guard test in app/test/vault.test.ts.

**Verifier.** Holds: the onboarding copy (VaultScreen.tsx:731-734, 764-768, 777-780) and the welcome note (289-296) say the agent reads and writes these notes, and the storage sheet says 'Point Obsidian at the same files and it just opens' for every provider, sealed Local included (856-858). The engine vaultRead only resolves exact paths, and there is no wikilink resolver (vault.ts:129-135). App-side drivers (cloudClaude, cloudOpenAi, onDevice, stack, desktopChat) have no vault tools. Wrong part: the grep of app/src/drivers is not proof that no agent reaches a vault. ElectronDriver and RemoteDriver host the os-code engine, whose registry always registers vaultRead, vaultList and vaultWrite (registry.ts:86-88), and daemon POST /sessions bootstraps a full engine session (serve.ts:964-975). So a paired phone's coding agent DOES read and write the desktop's ~/OSCode/Vault. What it cannot see are the phone-local notes the phone's Vault room shows. The copy is still untrue about the notes on screen, which is the actual defect.

### [custom-3] The Wayfinding Memory switch is saved but gates nothing, and project memory has no off switch anywhere

high, bug, v1 must, size M, confirmed. `app/src/lib/currents.ts:39`

**Evidence.** Label: 'The agent keeps project notes in your vault and reads them back into every session there.' (currents.ts:39-43). The switch writes `settings.wayfinding` (store.ts:6696-6700). `wayfindingOn` is only called by SettingsScreen.tsx:989 (grep across app/src, app/electron and os-code/src finds no other consumer). sessionOpts carries `humanize` and `chainOfThought` but no memory flag (store.ts:2522-2540). BootstrapOptions has no memory field (os-code/src/core/agent/bootstrap.ts:33-96). The engine adds the memory prompt and tool unconditionally: `if (memorySeg) parts.push(projectMemoryPrompt(memorySeg))` (loop.ts:514-515), `registry.register(projectMemoryWriteTool)` (registry.ts:92). ConfigSchema has no memory key (schema.ts:319-341). PROGRESS.md:579-582 says only the Browser switch 'gates nothing'.

**Impact.** Someone who turns Memory off, to keep the agent out of their notes or to stop it committing an 'OpenShore Project X MDs/' folder into a client or open-source repo, sees no change. The agent keeps auto-writing the five notes without asking, and they ride into commits. There is no project-level escape hatch either.

**Proposed fix.** Add `memory?: boolean` to BootstrapOptions, following the humanize precedent: the override can only turn memory off. Thread it from store.ts sessionOpts and the daemon and electron bridge. When memory is off, loop.ts skips projectMemoryPrompt and registry.ts skips projectMemoryWrite. Decide whether vault tools follow the same switch. Add a `memory: { enabled, folder? }` block to os-code/src/config/schema.ts. Guard it in app/test/currents.test.ts and a new os-code test, and correct PROGRESS.md.

**Verifier.** wayfindingOn has exactly one consumer, SettingsScreen.tsx:989. The only other hits are store.ts:6697-6699 (save plus log), guide copy and guide eval. sessionOpts (store.ts:2522-2540) carries humanize and chainOfThought but no memory flag, and BootstrapOptions has no memory field. loop.ts:514-515 always pushes projectMemoryPrompt when a memory segment exists, and registry.ts:92 always registers projectMemoryWrite, which permissions/index.ts:168-170 auto-allows. PROGRESS.md:579-583 names only Browser as gating nothing and calls all three switches 'honest labels', which understates the Memory case. The guide card (guideCards.ts:659) repeats the claim.

### [custom-4] Small and tiny seats never get the vault tools, yet most of their prompt tells them to use projectMemoryWrite

high, gap, v1 must, size S, confirmed. `os-code/src/core/agent/loop.ts:139`

**Evidence.** SMALL_MODEL_TOOL_PRIORITY lists readFile, editFile, writeFile, grep, glob, searchRepo, runShell, todoWrite, gitDiff, gitStatus, webFetch, webSearch and readTerminal (loop.ts:139-153). limitToolSpecs slices to maxToolsShown (loop.ts:1473-1485), which is 6 for tiny and 10 for small (harness/profile.ts:71-83), and a 7B derives to small (profile.ts:160-163). Scratch run (deleted), makeTestSession with harness.profiles on: small-seat tools were exactly readFile, editFile, writeFile, grep, glob, searchRepo, runShell, todoWrite, gitDiff, gitStatus, with no vaultRead, vaultList, vaultWrite or projectMemoryWrite. The system prompt was 3,027 chars and contains 'projectMemoryWrite'. projectMemoryPrompt('Demo') alone is 1,758 chars (58%).

**Impact.** Switching from a cloud seat to the founder's CPU-only 7B silently drops vault access, the opposite of 'seamlessly move between models'. The lean seat spends most of its deliberately trimmed prompt on instructions for a tool it cannot call, which invites hallucinated calls on a 3 to 7 tok/s box.

**Proposed fix.** In loop.ts, emit the full memory block only when projectMemoryWrite survives limitToolSpecs. Otherwise give lean seats a digest of roughly 250 chars ('read &lt;folder>/Current State.md first'). Put vaultRead, or a new compact vaultSearch, into the lean priority behind a harness profile knob. Measure with osc eval on the reference box before claiming a lift (tenet 2). Extend test/harnessLoopProfile.test.ts.

**Verifier.** harness.profiles.enabled defaults to true (schema.ts:285-288). A 3B to 8B model derives to 'small' (profile.ts:160-163), with maxToolsShown 10, or 6 for tiny. limitToolSpecs ranks by SMALL_MODEL_TOOL_PRIORITY and slices (loop.ts:1475-1485). The registered defaults (registry.ts) mean the top 10 are exactly readFile, editFile, writeFile, grep, glob, searchRepo, runShell, todoWrite, gitDiff, gitStatus, with no vault tool and no projectMemoryWrite. The memory block is pushed unconditionally (loop.ts:514-515). I measured projectMemoryPrompt('Demo') at 1,758 chars against dist. Two softenings: the lean-seat note does say 'shows it N of M tools' (loop.ts:449-458), so the drop is not fully silent, and the registry still executes an off-menu call if one arrives (loop.ts comment near 1460), so a text-mode call to projectMemoryWrite would run rather than fail. A lean seat can also still read Current State with readFile, because the notes live in the repo. The core claim holds: a small seat gets no vault access and a prompt about a write tool it is not shown.

### [custom-5] vault.dir can come from a repo's os-code.config.json, is not tilde-expanded, and can split from the app's folder

medium, security, v1 must, size S, confirmed. `os-code/src/config/load.ts:84`

**Evidence.** Only `daemon` is dropped from project files: `if (path === projectPath && isPlainObject(value) && 'daemon' in value)` (load.ts:79-91). vault is merged per project. The schema is `dir: z.string().optional()` with no transform (schema.ts:213-220). registry.ts:145 uses it raw, and Jail resolves it against the process cwd. Scratch run (deleted): a project file `{vault:{dir:'~/Notes'}}` gave config.vault.dir '~~/Notes' and ctx.vaultRoot '~~/Notes' literally. Electron's vaultDir() calls loadConfig() with the main process cwd (app/electron/main.ts:920-925), not the session workspace.

**Impact.** A cloned or outbox-committed repo can repoint the agent's vault at any directory. vaultRead and vaultList are read-risk and auto-allowed, so every .md there is readable without a prompt, widening the read jail the same way DAE-9 closed for daemon.*. A person who hand-types '~~/Obsidian/Main' gets an empty vault and a literal '~~' folder in the daemon's cwd. A project override makes the agent write to one folder while the app's 'This folder' shows another.

**Proposed fix.** Treat vault like daemon: read it from the global file only in load.ts (warn when a project file sets it). Expand ~ and require an absolute path in schema.ts or registry.ts. Report the resolved vault path in `osc doctor`. Cover it in a test in os-code/test.

**Verifier.** load.ts:79-91 strips only `daemon` from the project file, so vault.dir merges from os-code.config.json. bootstrapSession loads config from the workspace cwd (bootstrap.ts:116). VaultSchema is `dir: z.string().optional()` with no expansion (schema.ts:213-220), and Jail resolves it with resolve(root) against process.cwd() (jail.ts:22). Electron's vaultDir() calls loadConfig() with no cwd (main.ts:920-926), and scheduler defaultVaultRoot does the same (scheduler.ts:681-684), so a project override splits the agent's folder from the app's and the routines' folders. Context: a project file can already set permissions, providers and verify.command, so on a single-user machine project config is trusted in general. The specific widening is on a hub: member sessions (serve.ts:956-975) could, through a committed config, read and list .md files outside the workspace jail without a prompt, since read is allow by default (permissions/index.ts:80-91). That is the same class of issue DAE-9 closed for daemon.*.

### [custom-6] The vault location, and pointing at an existing Obsidian vault, can only be set by hand-editing JSON

medium, gap, v1 must, size M, partial. `app/src/screens/VaultScreen.tsx:852`

**Evidence.** The storage sheet lists providers with a blurb but never shows a path and has no folder picker (VaultScreen.tsx:852-972). Grep finds no showOpenDialog, showItemInFolder or obsidian:// anywhere in app/src or app/electron. No CLI command sets vault.dir (os-code/src/commands has none), and the only docs mention is parked-ideas.md:355. On a phone, the desktop-only 'This folder' row renders with an 'Arriving' pill (isReady false, line 922) although it can never arrive there. SettingsScreen has no Vault group (no 'vault' match).

**Impact.** The founder's baseline is Obsidian, whose first screen is 'open folder as vault'. Here a person with an existing Obsidian vault has to find ~/.os-code/config.json, know the key, and type an absolute path. The founder's iCloud-on-Mac convergence path (vault.dir = the ubiquity container's Documents/vault.personal) is undiscoverable.

**Proposed fix.** Add a desktop-only 'Use a folder...' row to the storage sheet: an Electron dialog writes vault.dir via saveGlobalConfig (new IPC in app/electron/main.ts), then vaultMoveTo('files'). Show the resolved path with Reveal and Open in Obsidian. On the phone, label the row 'On your computer', not Arriving.

**Verifier.** Holds: the storage sheet (VaultScreen.tsx:852-972) shows no path and has no vault folder picker. Nothing writes vault.dir: saveGlobalConfig is used only for stack and providers in engineHost.ts, doctor.ts has no vault reference, and no command sets it. On the phone the 'This folder' row shows the 'Arriving' pill, because probeReady('files') is false and there is no desktop-only label (VaultScreen.tsx:919-923). Tapping it toasts the honest pending line (providers.ts:118). Wrong detail: the claim that grep finds no showOpenDialog anywhere in app/electron is false. An `osc:pickFolder` IPC with dialog.showOpenDialog({properties:['openDirectory']}) already exists at app/electron/main.ts:840-846, for project folders. That makes the fix smaller, since it can reuse the dialog and add only a vault.dir write. showItemInFolder and obsidian:// are indeed absent.

### [custom-7] A deny rule for vaultWrite is ignored, and no per-folder agent access is possible

medium, bug, v1 should, size S, confirmed. `os-code/src/core/permissions/index.ts:151`

**Evidence.** `if (q.alwaysAsk) { return { decision: 'ask', reason: 'this action always asks first' }; }` runs before any rule (index.ts:151-156). Scratch run (deleted): PermissionEngine with rules [{tool:'vaultWrite',decision:'deny'}] returned {decision:'ask'}. vaultList declares no pathOf (os-code/src/core/tools/vault.ts:154-171), so a pathGlob deny on vaultRead still lets the model enumerate 'Private/**' names. In loop.ts:1102 acceptEdits never auto-allows alwaysAsk, so an edit routine's vaultWrite waits out the 15-minute approval timer (scheduler.ts:55) inside a 20-minute default cap.

**Impact.** A person cannot switch vault writes off or fence folders (Journal/, Private/) from the agent, and a routine that tries to record a finding can stall most of its run.

**Proposed fix.** In permissions/index.ts, evaluate deny rules and a deny default before the alwaysAsk short-circuit, so alwaysAsk only upgrades allow to ask and never downgrades deny. Give vaultList a pathOf(folder) and filter denied subtrees out of its output. Tell routines vaultWrite is unavailable, or drop it from headless registries. Add cases to os-code/test/vaultTools.test.ts.

**Verifier.** permissions/index.ts:151-156 returns 'ask' for alwaysAsk before any rule is evaluated, so a configured deny for vaultWrite, or a write default of deny, becomes ask. vaultList declares no pathOf (vault.ts:154-171), but that matches grep and glob, so it is a general pattern rather than vault-specific. loop.ts:1101 excludes alwaysAsk from the acceptEdits upgrade, the approval timeout is 15 minutes (scheduler.ts:55), and the default routine cap is 20 minutes (routines/model.ts:108), so an unattended edit routine's vaultWrite can wait out most of the run. That wait is the designed ask-the-phone behavior, though. Each write still asks and can be declined, so I lowered v1 to should, but ignoring an explicit deny is a real engine defect with a tiny fix.

### [custom-8] No context budget: vaultList is uncapped, there is no vault search tool, and the prompt never mentions the vault

medium, perf, v1 must, size M, confirmed. `os-code/src/core/tools/vault.ts:160`

**Evidence.** vaultList walks the whole tree and returns `notes.join('\n')` with no capContent (vault.ts:160-170), while vaultRead caps at 24,000 chars (vault.ts:134, tools/index.ts:169). The loop pushes results uncapped: `this.pushObservation(call, redactSecrets(result.content), toolMode)` (loop.ts:1206). The registry has no vault search (registry.ts:86-88), and searchRepo covers only cwd (registry.ts:125-138). Scratch run (deleted): a large-seat system prompt contains no 'vault' at all, and nothing in loop.ts:474-515 describes the vault or its conventions. No schema key limits vault context.

**Impact.** Pointed at a real 3,000-note Obsidian vault, a single vaultList puts roughly 100KB or more into the context and overflows a 32K local window. Models otherwise have no cue to consult the vault, so it does not make them 'faster and smarter'. A person cannot choose a budget.

**Proposed fix.** Cap vaultList (count, depth and capContent) and add a keyword vaultSearch, reusing app searchNotes or harness/localSearch.ts. Add `vault.contextChars` (small default) and a short VAULT prompt block (top folders plus a pinned index note) to schema.ts and loop.ts. Skip the block when Memory is off, and measure it with osc eval.

**Verifier.** vaultList returns notes.join('\n') uncapped (vault.ts:160-170). It is the only list or search tool without capContent: glob, grep, readFile, git and vaultRead all cap (tools/index.ts:169 plus the call sites). pushObservation adds content raw (loop.ts:1206, 1332-1342). Compaction folds older turns but cannot shrink a single oversized observation. No vault search exists, since searchRepo is cwd-only (registry.ts:125-138), and there is no vault key beyond dir in the schema. The system prompt never mentions the vault: the only 'vault' in loop.ts is a comment at line 1054. One softening: the vault tool descriptions themselves (vault.ts:78-79, 123-124, 156-157) are a cue for large seats, so 'no cue' is slightly overstated.

### [custom-9] A paired phone cannot browse the desktop vault where the agent and routines write

medium, gap, v1 should, size L, confirmed. `os-code/src/daemon/serve.ts:890`

**Evidence.** The daemon serves Hermes notes (`parts[1] === 'hermes' && parts[2] === 'notes'`, serve.ts:890-894) and single routine notes (serve.ts:785), but has no vault list or read route (grep 'vault' in serve.ts: none). The 'files' provider requires Electron: `platform() === 'electron' && typeof bridge()?.vaultList === 'function'` (app/src/lib/gitos/deviceFolder.ts:17-20).

**Impact.** The 'paired' first-open case shows only the phone's own vault. Everything the desktop agent saved is invisible from the phone, and so is every Crew note outside its inbox card. The phone is meant to be the remote control and viewer.

**Proposed fix.** Add owner-scoped, jailed daemon routes (GET /vault/list, GET/PUT /vault/note), reusing the Electron walker in app/electron/main.ts:933-973 moved into os-code. Add a 'hub' StorageProvider that the phone can select when paired. Writes from the phone are the person's own and need no approval.

**Verifier.** serve.ts has no vault route (grep 'vault' in os-code/src/daemon returns nothing). It serves routine notes per run (serve.ts:785-790, owner-filtered through visible()) and admin-only Hermes notes (serve.ts:890-894). deviceFolder is Electron-only (deviceFolder.ts:18-20). Correction to the reviewer's framing: the paired phone's coding agent does reach the desktop vault through the daemon engine. What is missing is the person browsing it from the phone.

### [custom-10] On a shared hub, every member's agent reads one machine-wide vault, including other members' routine notes

medium, security, v1 should, size M, confirmed. `os-code/src/core/agent/bootstrap.ts:192`

**Evidence.** buildToolContext receives cwd, config, router, providers, projectName and egressLockdown, with no owner (bootstrap.ts:192-199). vaultRoot defaults to the daemon user's ~/OSCode/Vault (registry.ts:145). Routines are owner-scoped (`ownerUserId`, routines/model.ts:69; list filters by owner, scheduler.ts:276-279), but writeNote puts every owner's results under the same root's Crew/ (scheduler.ts:588-592). vaultRead and vaultList are auto-allowed reads.

**Impact.** Member A's agent can vaultList and read member B's Crew findings and personal notes on a multi-user hub, against the repo's own stance that nothing is mined machine-wide on a shared hub.

**Proposed fix.** Resolve the vault root per owner when the daemon is multi-user (for example ~/OSCode/Vault/&lt;userId>/), keep the single-user path unchanged, and use the same root in scheduler.writeNote and readNote. Add a test in os-code/test/daemonRoutines.test.ts.

**Verifier.** buildToolContext takes no owner (bootstrap.ts:192-199), so every daemon session, member sessions from serve.ts:956-975 included, gets the one vaultRoot (registry.ts:145), with read and list auto-allowed. writeNote puts every routine's note under root/Crew/ (scheduler.ts:588-592). The daemon's own HTTP route owner-scopes routine notes through visible() (serve.ts:785-790), but vaultRead and vaultList bypass that scoping, so the inconsistency is real. A member's approved vaultWrite also lands in the machine owner's personal vault.

### [custom-11] No default structure, templates, or daily note: each writer invents its own paths

medium, gap, v1 should, size M, confirmed. `app/src/screens/VaultScreen.tsx:280`

**Evidence.** The only seeding is an opt-in root note, 'Welcome to your Vault' (VaultScreen.tsx:280-305). The agent is steered to arbitrary folders by its tool example 'decisions/auth.md' (os-code/src/core/tools/vault.ts:68). Routines use Crew/&lt;routine>/&lt;YYYY-MM-DD HH-MM>.md (scheduler.ts:590-592). Project memory lives in the repo, not the vault (projectMemory.ts:7-9). Grep finds no Inbox, Templates or daily-note concept, and no config for any of them.

**Impact.** The out-of-box vault fills with an unstructured mix from three writers, and neither the person nor the model can predict where things go. Obsidian's Daily notes and Templates core plugins, the baseline the founder named, have no equivalent.

**Proposed fix.** Seed a small convention on first open: Inbox/, Agent/ (the default for agent writes), Crew/ and Templates/, plus one 'Vault conventions' note the agent reads. Add a `vault.layout` block (agent folder, daily folder and date format, templates folder) to schema.ts with those defaults, surfaced later in the app. Daily-note format and a template picker can follow v1.

**Verifier.** The only seed is the opt-in welcome note (VaultScreen.tsx:280-305). The vaultWrite schema example is 'decisions/auth.md' (vault.ts:68), routines write Crew/&lt;name>/&lt;stamp>.md (scheduler.ts:590-592), and project memory lives in the repo (projectMemory.ts:7-9). A grep for Templates/, Inbox/, daily note or dailyNote finds only the unrelated ~/.os-code/inbox for image ingest. There is no layout config.

### [custom-12] searchNotes is built and tested but never wired, so there is no way to find a note in the app

medium, gap, v1 must, size S, confirmed. `app/src/lib/vault.ts:184`

**Evidence.** searchNotes (vault.ts:184-210) is used only by test/vault.test.ts:180, described as 'review 6: a way to find a note'. VaultScreen.tsx imports backlinksTo, noteFolder, noteTitle, normalizeNotePath, treeAt and wikilinkContext, but not searchNotes (lines 10-17), and renders no search field.

**Impact.** Past a few dozen notes, or immediately after pointing at an existing Obsidian vault, the person can only drill folders. Quick switcher and search are basic out-of-box function in Obsidian.

**Proposed fix.** Add a search field above the tree in VaultScreen.tsx using searchNotes, with bodies from the vaultReadAll cache (store.ts:6164-6187). Title hits appear immediately and body hits once the cache warms.

**Verifier.** searchNotes (app/src/lib/vault.ts:184) is referenced only by app/test/vault.test.ts. VaultScreen imports backlinksTo, noteFolder, noteTitle, normalizeNotePath, treeAt and wikilinkContext (lines 10-17) and has no search field: its only filter is the in-note [[ autocomplete at 320-333, and the only &lt;input> is the New note sheet at 819. No other screen consumes vaultFiles or vaultReadAll. The [[ autocomplete is a clumsy partial quick-switcher, but only inside an open note.

### [custom-13] Obsidian properties (YAML frontmatter) render as a divider and a large heading

low, bug, v1 should, size S, confirmed. `app/src/components/VaultMarkdown.tsx:29`

**Evidence.** Plugins are only `remarkPlugins={[remarkGfm]}` and `rehypePlugins={[rehypeHighlight]}` (VaultMarkdown.tsx:28-31), with no remark-frontmatter. Rendering '---\ntags: [project, idea]\naliases: Big Plan\n---\n\n# Plan' with the app's own react-markdown and remark-gfm (scratchpad script) produced `<hr/><h2>tags: [project, idea]\naliases: Big Plan</h2><h1>Plan</h1>`.

**Impact.** Most notes in a real Obsidian vault open with a stray rule and an H2 made of metadata, which undercuts 'point Obsidian at the same folder and it just opens' in the other direction.

**Proposed fix.** Add remark-frontmatter in VaultMarkdown.tsx, render properties as a quiet chip row (or hide them), and exclude frontmatter from backlink excerpts in app/src/lib/vault.ts. Cover it in app/test/vault.test.ts.

**Verifier.** VaultMarkdown.tsx:28-31 uses only remarkGfm and rehypeHighlight, and no frontmatter handling exists in app/src/lib/vault.ts. By CommonMark, a leading '---' is a thematic break, and the YAML lines followed by '---' form a setext H2, so the reported output follows from the spec. I did not re-run it.

### [custom-14] Routine note heading is garbled ('2026:09-26 at 06-00')

low, bug, v1 must, size S, confirmed. `os-code/src/routines/scheduler.ts:595`

**Evidence.** `const stamp = `${yyyy}-${mm}-${dd} ${hh}-${min}`` (scheduler.ts:590). Then `# ${name}: ${stamp.replace(' ', ' at ').replace('-', ':')}`(scheduler.ts:595). The second replace hits the first '-' in the date.`node -e` on '2026-09-26 06-00' prints '2026:09-26 at 06-00'.

**Impact.** Every Crew note, the dated artifact routines exist to produce, opens with a malformed date in its title.

**Proposed fix.** Build the heading from the parts (`${date} at ${hh}:${min}`) in scheduler.ts and assert the H1 in os-code/test/routines.test.ts.

**Verifier.** scheduler.ts:590 builds 'YYYY-MM-DD HH-MM', and :595 runs .replace(' ', ' at ').replace('-', ':'). node on '2026-09-26 06-00' prints '2026:09-26 at 06-00'. No test asserts the H1. The fix is trivial.

### [custom-15] The approval sheet offers 'Approve for this session' on vaultWrite, which never takes effect

low, ux, v1 should, size S, partial. `app/src/components/ApprovalSheet.tsx:124`

**Evidence.** The sheet always shows 'Approve for this session' unless it is a spend (ApprovalSheet.tsx:124-129). The engine then emits `${call.name} always asks before it runs, so it will prompt again next time.` (loop.ts:1143-1150), because the ApprovalRequest it sends has no alwaysAsk field (loop.ts:1131-1138).

**Impact.** The person taps a button that does nothing, and the next vault save asks again. This is a small breach of 'every tappable answers honestly'.

**Proposed fix.** Add alwaysAsk to the approval request (loop.ts and os-code/protocol), and hide the session and project allow buttons for it in ApprovalSheet.tsx.

**Verifier.** ApprovalRequest has no alwaysAsk field (os-code/src/core/agent/types.ts:8-17). The sheet shows 'Approve for this session' for any non-spend request (ApprovalSheet.tsx:124-129), including vaultWrite (the project allow is already hidden, since projectAllowable does not match vaultWrite, line 77-80). Overstated part: the button is not a no-op. It approves this call, and the engine then posts a note that it will prompt again (loop.ts:1141-1149). The defect is the misleading label, not a dead tap.

### [custom-16] Engine and app normalize note names differently, although the engine comment says they match

low, bug, v1 should, size S, confirmed. `os-code/src/core/tools/vault.ts:24`

**Evidence.** The engine comment says 'the same shape the app uses', but it only trims and collapses separators (vault.ts:22-34). The app also NFC-normalizes and strips `<>:"|?*#^[]` (app/src/lib/vault.ts:68-83).

**Impact.** The agent can create 'Q&A #2.md' or NFD-named notes that the app cannot wikilink, or that fork into two notes on an iCloud or APFS round trip.

**Proposed fix.** Move one normalizer into os-code/protocol, use it in both places, and pin it with a parity test like projectMemory.test.ts.

**Verifier.** The engine normalizeNotePath (os-code/src/core/tools/vault.ts:22-34) only trims, collapses and appends .md. The app version (app/src/lib/vault.ts:68-83) also NFC-normalizes, strips <>:"|?*#^[] and drops '.' and '..'. The engine comment 'the same shape the app uses' is false. The engine stays jail-safe through Jail, so this is a parity issue rather than a traversal issue.

### [custom-17] Stale comments still say project memory lives under Projects/&lt;project>/ in the vault

low, docs, v1 later, size S, confirmed. `os-code/src/core/agent/bootstrap.ts:48`

**Evidence.** bootstrap.ts:47-48 says 'place the project's memory notes under Projects/&lt;project>/ in the vault'. permissions/index.ts:167 says 'a managed memory file under Projects/&lt;project>/'. tools/index.ts:64-65 and registry.ts:89-91 say the same. DECISIONS.md 2026-09-04 moved the notes into the repo ('OpenShore Project &lt;name> MDs/'), and projectMemory.ts:7-9 agrees.

**Impact.** Future sessions and reviewers are told the wrong home for project memory, which invites exactly the vault or repo confusion this review found.

**Proposed fix.** Correct the four comments to the repo-folder convention.

**Verifier.** bootstrap.ts:47-48, tools/index.ts:63-66, registry.ts:89-91 and permissions/index.ts:165-167 still say Projects/&lt;project>/ in the vault. projectMemory.ts:7-9 and DECISIONS.md (2026-09-04) put the notes in the repo folder 'OpenShore Project &lt;name> MDs/'.

### [custom-m1] On desktop, 'Export as plain files' writes to IndexedDB, not disk, and says it landed in Files for Obsidian

high, bug, v1 must, size S, verifier-found. `app/src/lib/vaultExport.ts:34`

**Evidence.** exportVaultToFiles only bails on `if (platform() === 'web') return undefined;` (vaultExport.ts:34), then calls Capacitor Filesystem.writeFile with Directory.Documents. On Electron, platform() returns 'electron' (app/src/lib/platform.ts:13-15), but there is no Capacitor Electron platform: app/package.json lists only @capacitor/ios, and app/electron has no Capacitor bridge. So registerPlugin falls back to the web implementation, `web: () => import('./web').then((m) => new m.FilesystemWeb())` (node_modules/@capacitor/filesystem/dist/esm/index.js:3-5), which stores files in the IndexedDB database 'Disc' (web.js:27, 90-94). The storage sheet renders the Export button on every platform, and on success toasts `${count} notes exported to Files, under OpenShore / Vault. Obsidian opens that folder as a vault.` (VaultScreen.tsx:947-962). I did not run this inside Electron; the conclusion is traced through the code.

**Impact.** The desktop default is the sealed Local store (custom-1), and Export is the documented 'true-compat escape hatch' (vaultExport.ts:5-6). On the desktop it reports success while no .md file reaches the disk, so a person who follows it and points Obsidian at a folder finds nothing. This is a direct honesty breach on the default path.

**Proposed fix.** In vaultExport.ts, route Electron to a new bridge IPC that writes real files (reuse the Electron vault walker's Jail pattern in app/electron/main.ts:916-973, target a chosen folder or ~/OSCode/Vault export), or hide Export on desktop in favor of 'Move to This folder'. Make the toast platform-aware: 'Files, under OpenShore / Vault' is iOS wording. Add an electron-platform case to app/test/vaultExport.test.ts.

## Tests, docs, and claims audit

The existing Vault tests pass: 85 in app across 7 files and 34 in os-code across 2. They mostly exercise pure helpers and mocked providers, though, and the paths that can lose data, plus the claims the ask depends on, have no tests. I used one scratch test (since deleted) to prove six defects. Team-vault conflict detection is bypassed by list(). A Google Drive conflict copy is followed by an overwrite of the other device's edit on the very next autosave. Concurrent Local writes drop a note from the index. The app and the engine normalize note paths differently. vaultRead cannot follow a bare [[wikilink]]. vaultList returns roughly 106k characters for 2,500 notes with no cap. The largest gaps against the ask are in the product itself. Out of the box, the app's Vault and the agent's vault are two separate stores on every platform. Tiny and small seats, the reference box's class, are never shown the vault tools. Nothing puts vault content into any model's context. So the copy saying "you and your agent both write here" and "Obsidian just opens it" is not true by default. Against the original brief, the org backend, the phone storage location, the name, native browsing and backlinks are met. Personal-as-agent-target, agent context, the org permission model, true Obsidian compatibility and enc:v1 for sensitive notes are only partial. The team tier's "no member's work is ever silently lost" guarantee does not hold.

**What is solid:**

- Obsidian wikilink grammar (alias, #heading and ^block tolerance, embeds shown as an honest chip), and bare-name resolution that picks the shortest path: app/src/lib/vault.ts:19, :89, :146. Covered by app/test/vault.test.ts.
- The app-side path jail: normalizeNotePath drops . and .. segments, converts to NFC, and strips characters that filesystems or Obsidian reject: app/src/lib/vault.ts:68. Covered by app/test/vault.test.ts:47-69.
- Store data-safety for a single writer: an offline draft is stashed and replayed, a known-but-undownloaded note never opens as an empty editor, a create writes immediately, and the body cache skips re-reading unchanged files: app/src/state/store.ts:6003-6177. Covered by app/test/vaultStore.test.ts.
- Autosave is debounced at 600ms and flushed on note switch, background, unmount and back navigation. A delete cancels the pending save so the note is not recreated: app/src/screens/VaultScreen.tsx:198-258, :517.
- Agent writes are never silent. alwaysAsk is checked before any session grant, rule or trusted-repo allow, and the approval shows a unified diff: os-code/src/core/permissions/index.ts:151-156, os-code/src/core/tools/vault.ts:83-99. Covered by os-code/test/vaultTools.test.ts:79.
- The engine's vault tools resolve every path through the Jail (symlink-safe) and reject ../ escapes: os-code/src/core/tools/vault.ts:16-20. Covered by os-code/test/vaultTools.test.ts:56.
- The team vault's server boundary: RLS lets only members read (is_org_member), table writes are revoked so the SECURITY DEFINER RPCs are the only write path, a path guard applies, and bodies are capped at 1 MB: supabase/migrations/0010_org_vault.sql, supabase/migrations/0015_review_2026_09_05.sql:483-527. The path guard and membership are covered by supabase/tests/rls.test.sql:96-102 and :220.
- Sign-out clears team-vault screen state and the cached base revisions: app/src/lib/gitos/orgVault.ts resetOrgVault, store.ts:2895-2924. Covered by app/test/orgVault.test.ts:110.
- Export refuses note paths that would climb out of the export folder: app/src/lib/vaultExport.ts isSafeExportPath. Covered by app/test/vaultExport.test.ts.
- Drive sync hardening: the index merge keeps tombstones, first contact creates exactly one root folder, a duplicate filename is refused instead of forked, and a delete on a stale index falls through to a live lookup: app/src/lib/gitos/gdrive.ts:53, :436-446. Covered by app/test/gdrive.test.ts.
- The onboarding ramp and the seeded welcome note on an empty personal vault are in-flow, with no floating layer over tappable buttons: app/src/screens/VaultScreen.tsx:720-784.
- Crew routines write a dated note under Vault/Crew/&lt;routine>/: os-code/src/routines/scheduler.ts:588-613. Covered by os-code/test/routines.test.ts:275.

### [truth-1] Team vault: list() advances the write base, so a stale draft or offline replay overwrites a teammate with no conflict copy

high, data-loss, v1 must, size M, confirmed. `app/src/lib/gitos/orgVault.ts:102`

**Evidence.** list() runs `for (const r of rows) baseRev.set(revKey(resourceId, r.path), r.rev);` and write() then sends `p_base_rev: base`. The server only copies aside when `existing.rev is distinct from p_base_rev` (0015). list() runs on every foreground (VaultScreen onVisibility calls vaultRefresh), after every save (store.ts:6107), and on every note open through vaultReadAll (store.ts:6157). vaultRefresh calls list() and THEN replayVaultPending (store.ts:5989-5993). The open editor's draft is only reloaded when vaultNote.path changes (VaultScreen.tsx:191). Scratch proof: read a.md at rev 4, list() returns rev 5, then write() sends p_base_rev 5, so the server sees no conflict. app/test/orgVault.test.ts never runs list() between read() and write().

**Impact.** Alice has a team note open. Bob saves a change. Alice switches apps and comes back, then keeps typing. Her next autosave replaces Bob's version, with no conflict copy and no notice. An offline draft replayed hours later does the same.

**Proposed fix.** In orgVault.ts, set the write base only from read() and write(), never from list() or stat(). Better, carry baseRev on vaultNote and inside the VaultPending stash entry (store.ts:3020) so a replay sends the rev the draft started from. When list() shows a newer rev for the open note, show a 'changed elsewhere' banner with reload. Add orgVault.test cases for read, list, then write, and for a replay after an interleaved list.

**Verifier.** orgVault.ts:102 `for (const r of rows) baseRev.set(revKey(resourceId, r.path), r.rev);` and write() sends that as p_base_rev. The server (0015:537-540) only copies aside when `existing.rev is distinct from p_base_rev`. The call sites all hold: vaultRefresh runs list() and then replayVaultPending (store.ts:5989-5993), VaultScreen's onVisibility calls vaultRefresh on foreground (VaultScreen.tsx:236), and the draft only reloads on a path change (VaultScreen.tsx:179-191). I reproduced it with a scratch test (since deleted): read at rev 4, list returns rev 5, then write sent `p_base_rev: 5`. The 0010 header says 'The editor sends the rev it started from', which the client does not do. One caveat on the proposed fix: 'set the base only from read() and write()' is not enough on its own, because vaultReadAll (backlinks) and export also call provider.read(). The per-draft base (carry baseRev on vaultNote and on the stash entry) is the real fix.

### [truth-2] Google Drive: the autosave after a conflict copy overwrites the other device's edit; list() never sees remote changes

high, data-loss, v1 must, size M, confirmed. `app/src/lib/gitos/gdrive.ts:430`

**Evidence.** On a conflict, write() stores the incoming text as a conflict copy, then `handle.index.files[path] = { id: cached.id, updatedAt: live.updatedAt, size: live.size };` and returns `{ path: cpath, ... }`. store.vaultSave ignores saved.path and keeps the open note on the original path (store.ts:6108-6111), so the next debounced save sees live === cached and calls putContent. Scratch proof: after write('v1'), another device writes 'OTHER DEVICE WORK', then write('my edit') lands as a conflict copy, then write('my edit plus one more key'). Final contents: ["my edit plus one more key","my edit"]. The other device's text is gone from every file. listFiles (gdrive.ts:382) returns the module-cached handle.index, and handleCache is never refreshed, so a foreground refresh never shows another device's new notes. gdrive.test.ts COR-5 stops after the first conflict write.

**Impact.** Two devices editing the same Drive note: the second device's first keystroke after the conflict permanently erases the first device's edit. The 'refresh on foreground so synced edits show up' comment (VaultScreen.tsx:232) is false for Drive.

**Proposed fix.** When write() returns a different path, the store must stop autosaving to the original. Put the note into a conflict state that shows both versions and have the person pick or merge. Never advance the cached base without reloading the draft. In listFiles, re-read the remote index.json (or check changes via the Drive changes API) instead of returning the process-lifetime cache. Add gdrive.test cases for the second write after a conflict and for list after a remote change.

**Verifier.** gdrive.ts:421-431: on a conflict it writes the conflict copy, then `handle.index.files[path] = { id: cached.id, updatedAt: live.updatedAt, ... }`, and returns cpath. store.vaultSave (6108-6111) keeps vaultNote on the original `path`. The next autosave therefore sees live === cached and calls putContent over the other device's text. listFiles (382-387) returns the cached handle.index, and handleFor never rebuilds a cached handle, so a list alone never shows remote changes. They only arrive when a local write runs saveIndex and merges. gdrive.test COR-5 (174-187) stops after the first conflict write. One nuance: Drive keeps file revision history server-side, so 'permanently' is only true from the app's point of view.

### [truth-3] Team conflict copies collapse per minute and are never surfaced, so 'no member's work is ever silently lost' is false

medium, claim-mismatch, v1 must, size M, partial. `supabase/migrations/0015_review_2026_09_05.sql:539`

**Evidence.** `conflict_path := regexp_replace(p_path, '\.md$', '', 'i') || ' (conflict ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24MI') || ').md';` followed by `on conflict (org_id, path) do update set body = excluded.body`. The code comment admits: 'A repeat clash in the same minute folds onto the same copy.' The archive claims 'so no member's work is ever silently lost' (os-code/docs/progress-archive.md:3833). The RPC returns only the row, with no conflict flag. isConflictCopy (app/src/lib/vault.ts:167) is tested but has no caller anywhere in app/src.

**Impact.** Three members, or two members each autosaving with a stale base, within one minute: the second conflict overwrites the first preserved body. Nobody is told a conflict happened. The copies just appear as extra notes, and each editor keeps its diverged draft.

**Proposed fix.** Make conflict names unique (seconds plus the writer or a short id) and never upsert over an existing copy. Have org_vault_put return conflict_path when it copies aside. The client then shows a toast and a badge (wire isConflictCopy into the tree) and offers to reload the note. Add pgTAP cases for two-way and three-way conflicts.

**Verifier.** This holds: the conflict name is minute-grained, and `on conflict (org_id, path) do update set body = excluded.body` overwrites an earlier copy (0015:537-548). The RPC returns only the row, isConflictCopy has no caller in app/src, and nothing surfaces the conflict. The 'never silently loses' claim appears in the archive (progress-archive.md:3833-3834) and in the 0010 header. What is overstated: with two members the fold usually loses nothing. Each overwritten copy body is superseded by that same member's live draft, which lands on the main path, so the end state holds both latest versions. The real loss needs three writers in one minute. The larger problem is that conflicts are never surfaced, so members keep ping-ponging copies. Severity lowered to medium.

### [truth-4] By default the app's Vault and the agent's vault are different stores on every platform, but the copy says they are one

high, claim-mismatch, v1 must, size L, confirmed. `app/src/state/store.ts:5976`

**Evidence.** vaultRefresh registers the personal vault with `providerId: 'local'` (sealed key-value store) on every platform, and nothing moves a desktop to 'files'. The agent's root is `config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault')` (os-code/src/core/agent/registry.ts:145). The shared-folder provider is desktop-only and opt-in (deviceFolder.ts). No app chat driver in app/src/drivers mentions the vault. The copy says otherwise: VaultScreen 'Plain markdown files you own, that you and your agent both write.'; the onboarding 'You write in them, and so does your agent as it works'; the welcome note 'Anything you write becomes context it can use.'; guideCards.ts:537 'Routines leave their notes here.'; CrewCommandScreen.tsx:1043 'Saved in your vault: {note.path}'; the marketing site src/_data/oscode.js:128 'leaves a dated note in your Vault'.

**Impact.** A new user writes notes on the phone, or in the desktop app's default vault. The agent never sees them. The agent's vaultWrite notes and routine reports never appear in the Vault room unless the person finds 'This folder' on a desktop and moves the vault there. On the phone they never appear. This is the opposite of 'a key feature to move between models'.

**Proposed fix.** On desktop, default the personal vault to 'files' and migrate Local notes on first run. Give the phone a view of the paired computer's vault through a daemon vault route (list, read, and write with the same always-ask), or make the phone's vault the thing the daemon reads. Until then, make the copy depend on the provider.

**Verifier.** store.ts:5971-5977 registers the personal vault with `providerId: 'local'`, and nothing ever defaults or migrates a desktop to 'files'. The only callers of vaultMoveTo are the storage sheet and a refusal test. The engine root is `config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault')` (registry.ts:145), and routines write there too (scheduler.ts:680-683). No file in app/src/drivers mentions the vault. Every quoted string is present: VaultScreen.tsx:589, 732-733, 764-766, 287-295; guideCards.ts:537; CrewCommandScreen.tsx:1043; /home/user/OpenShore.ai-marketing-site/src/_data/oscode.js:122,128 (a sibling repo, not this one). Routine notes can be read in Crew through the daemon's runs/:id/note route (serve.ts:785), but not in the Vault room unless the vault is on 'files'.

### [truth-5] Vault tools are never shown to tiny or small seats, and nothing puts vault content into context

high, gap, v1 must, size L, confirmed. `os-code/src/core/agent/loop.ts:139`

**Evidence.** SMALL_MODEL_TOOL_PRIORITY lists 13 tools (readFile through readTerminal) with no vault tool. limitToolSpecs sorts by that rank, then `.slice(0, max)` (loop.ts:1475-1484). The profiles are tiny `maxToolsShown: 6` and small `maxToolsShown: 10` (os-code/src/harness/profile.ts:72, :83). registry.ts registers all 13 priority tools (11 under egress lockdown) before vaultRead, vaultList and vaultWrite, so no small or tiny seat ever receives them. systemPrompt pushes projectMemoryPrompt but never mentions the vault (loop.ts:510-515).

**Impact.** On the founder's reference box (a 7B, class 'small') and on Harbor 3B, the agent cannot read or write the vault at all. On larger seats it uses the vault only if it happens to call vaultList. The vault does nothing to help any model move faster or smarter, which is the core of the ask (tenet 3: retrieval first).

**Proposed fix.** Make vault retrieval mechanical: before a turn, the harness searches the vault for the task and injects a small, budgeted digest of titles and snippets, for every seat class. Put vaultRead into the small-seat slice when the digest references notes. Measure the effect with and without on `osc eval` before any copy claims it.

**Verifier.** SMALL_MODEL_TOOL_PRIORITY (loop.ts:139-153) has 13 entries and no vault tool. limitToolSpecs sorts by rank, then slices to max (loop.ts:1475-1484). The profiles set tiny to 6 and small to 10 (profile.ts:72, 83). registry.ts registers the 13 priority tools (11 under lockdown) before the vault tools at 86-88, so a small or tiny seat never sees them. The registry would still run a vault call if one arrived, but the model is never told the tools exist. systemPrompt adds projectMemoryPrompt (loop.ts:514-515), and nothing in os-code/src/core/agent injects vault content. The only engine references are the tool registration and vaultRoot.

### [truth-6] Agent vault access is expensive and blind: vaultList has no cap, there is no search tool, and vaultRead cannot follow a bare wikilink

medium, perf, v1 must, size M, confirmed. `os-code/src/core/tools/vault.ts:169`

**Evidence.** vaultList returns `notes.join('\n')` with no capContent, while glob and grep cap at 24,000 characters. Scratch proof: 2,500 notes produce 106,474 characters (about 26k tokens) in a single tool result. Scratch proof: after writing projects/Roadmap, `vaultRead({path:'Roadmap'})` returns 'No vault note at Roadmap.md yet.' The app copy says 'Your agent follows those links to find what it needs.' (VaultScreen onboarding and welcome note).

**Impact.** A real Obsidian-sized vault floods the context window on one call, the opposite of 'optimize context'. The agent cannot follow [[links]] the way the app and Obsidian resolve them.

**Proposed fix.** Cap vaultList and return a folder summary with counts. Add vaultSearch, reusing the RepoIndex keyword or embedding search over the vault root. Resolve bare names in vaultRead with the app's shortest-path rule, and return the note's outgoing links and backlinks.

**Verifier.** vaultList returns `notes.join('\n')` with no capContent (tools/vault.ts:169), while vaultRead does cap (vault.ts:136). I found no central truncation of tool results in loop.ts; compaction only happens after the fact. vaultRead runs normalizeNotePath('Roadmap') -> 'Roadmap.md' and resolves it against the root only, so projects/Roadmap.md is not found. That contradicts 'Your agent follows those links' (VaultScreen.tsx:294-295, 778-779). There is no vaultSearch anywhere in os-code/src.

### [truth-7] The app and the engine normalize note paths differently, despite a comment saying they match

medium, bug, v1 must, size S, confirmed. `os-code/src/core/tools/vault.ts:24`

**Evidence.** The engine comment says 'the same shape the app uses', yet the engine only trims and collapses separators: there is no NFC, no stripping of forbidden characters, and no dropping of dot segments. Scratch proof, typed name / app path / engine result: 'ideas/../plan' app='ideas/plan.md', engine reported 'Saved ideas/../plan.md' but wrote root plan.md; 'note#heading' app='noteheading.md', engine wrote 'note#heading.md'; 'a:b' app='ab.md', engine wrote 'a:b.md'. No parity test exists (compare projectMemory.test, which pins the app and engine copies).

**Impact.** The agent creates notes the app and Obsidian can never wikilink ([[note#heading]] means a heading). A ':' in a name breaks on iCloud and Windows. The approval diff shows one path while a different file is written.

**Proposed fix.** Use one normalizer exported through os-code/protocol for app/src/lib/vault.ts, the engine tool and the Electron osc:vault* IPC. Add a parity test over a table of hostile names.

**Verifier.** Engine normalizeNotePath (tools/vault.ts:24-34) only trims and collapses. The app version (vault.ts:66-83) applies NFC, strips `[<>:"|?*#^[\]]` and drops `.` and `..`. A scratch run confirmed the app side: 'a:b.md'->'ab.md', 'note#heading.md'->'noteheading.md', 'ideas/../plan'->'ideas/plan.md'. The impact is worse than stated. On the 'files' provider, tapping an agent-written 'a:b.md' in the tree calls vaultOpen, which normalizes it to 'ab.md'. That path is not listed, so the app opens a fresh empty note. An agent-written note with any of these characters cannot be opened in the app at all. One sub-claim is overstated: the '..' case writes root plan.md, which is lexically the same file as 'ideas/../plan.md', so the approval summary is not naming a different file. It is just unnormalized.

### [truth-8] Backlinks are quadratic and run on the main thread on every note open; the first open reads every note one at a time

medium, perf, v1 must, size M, confirmed. `app/src/screens/VaultScreen.tsx:185`

**Evidence.** Each note open calls `vaultReadAll().then(notes => setBacklinks(backlinksTo(vaultNote.path, notes)))`. backlinksTo calls resolveWikilink (a find plus a filter over all paths) for every link in every note. Measured for one backlinksTo call with 8 links per note: 300 notes 114 ms, 1,000 notes 974 ms, 3,000 notes 10.1 s on this server CPU. A cold vaultReadAll (store.ts:6163-6175) is N serial provider reads (Drive HTTP, PostgREST).

**Impact.** A few-thousand-note Obsidian vault freezes the UI for seconds on every note tap, worse on a phone. A cold Drive or team vault issues hundreds of serial requests.

**Proposed fix.** Keep an incremental link index (basename to paths, outgoing links per note), update it on save, compute it off the main thread, parallelize cold reads with a limit, and persist the index. Add a 5k-note performance test.

**Verifier.** backlinksTo (vault.ts:106-133) calls resolveWikilink for every link in every note, and each call is an O(N) find plus a filter. It runs on every note open (VaultScreen.tsx:184-186). A scratch measurement here with 8 links per note: 300 notes took 101 ms, 1,000 notes took 1,237 ms (the reviewer measured 974 ms). vaultReadAll (store.ts:6163-6175) reads files one at a time with await in a for loop when the cache is cold.

### [truth-9] Vault search is tested ('review 6: a way to find a note') but not wired into the UI

medium, claim-mismatch, v1 must, size S, confirmed. `app/src/lib/vault.ts:184`

**Evidence.** searchNotes and isConflictCopy have no importer outside vault.ts (grep over app/src). VaultScreen imports only backlinksTo, noteFolder, noteTitle, normalizeNotePath, treeAt and wikilinkContext. app/test/vault.test.ts:180 labels searchNotes 'review 6: a way to find a note', so the review blocker reads as closed.

**Impact.** A person cannot find a note except by walking folders. The tests suggest otherwise.

**Proposed fix.** Add a search field to the tree view, backed by searchNotes over the cached bodies, and a conflict badge driven by isConflictCopy. Add a component or store test that proves the UI calls both.

**Verifier.** A grep over app/src finds no importer of searchNotes or isConflictCopy outside vault.ts. The only filter in VaultScreen is the [[ link-chip filter (VaultScreen.tsx:325-327), not note search. app/test/vault.test.ts:180 labels the suite 'searchNotes (review 6: a way to find a note)'. No other screen reads vaultFiles.

### [truth-10] The Wayfinding 'Memory' switch controls nothing, and its copy says project notes live in the vault

low, claim-mismatch, v1 should, size S, confirmed. `app/src/lib/currents.ts:42`

**Evidence.** The switch's copy reads 'The agent keeps project notes in your vault and reads them back into every session there.' wayfindingOn is called only by SettingsScreen.tsx:989, and os-code has no reference to 'wayfinding'. loop.ts:514-515 injects projectMemoryPrompt whenever a memory segment exists. The memory notes live in the repo ('OpenShore Project &lt;name> MDs', projectMemory.ts:7-9), not the vault. guideCards.ts:659 repeats 'Memory keeps what it has learned in your Vault'. PROGRESS says the switches are 'honest labels over what exists today' and names only Browser as gating nothing.

**Impact.** Turning Memory off changes nothing, and the copy describes a vault behavior that does not exist.

**Proposed fix.** Pass settings.wayfinding.memory through BootstrapOptions, use it to gate projectMemoryPrompt and the future vault digest, correct the copy, and add a test that off reaches the engine.

**Verifier.** wayfindingOn is read only at SettingsScreen.tsx:989, settings.wayfinding does not reach the drivers or electron, and os-code has no 'wayfinding' reference, so Memory off changes nothing. The copy 'keeps project notes in your vault' (currents.ts:42) is stale: DECISIONS 2026-09-04 moved project memory into the repo, 'revising an earlier session choice to keep it in the personal Vault'. It is only partly mitigated by the Vault room's read-only 'Coding projects' viewer (VaultScreen.tsx:600-621). I lowered severity to low because the viewer means the copy is not wholly false.

### [truth-11] Desktop export writes into IndexedDB while reporting files Obsidian can open; export also wipes the folder Obsidian uses

medium, bug, v1 must, size S, confirmed. `app/src/lib/vaultExport.ts:34`

**Evidence.** `if (platform() === 'web') return undefined;` but platform() returns 'electron' on desktop (platform.ts:13), and the app has no @capacitor-community/electron. @capacitor/filesystem therefore loads FilesystemWeb (node_modules/@capacitor/filesystem/dist/esm/web.js: `this.DB_NAME = 'Disc'`, `indexedDB.open`). The toast still says `exported to Files, under OpenShore / Vault. Obsidian opens that folder as a vault.` (VaultScreen.tsx:960). On iOS, every export starts with `Filesystem.rmdir({ path: 'Vault', recursive: true })`, with no warning.

**Impact.** On desktop, nothing reaches the disk even though the success toast shows. On iPhone, anyone who followed the toast and edited in Obsidian loses those edits and Obsidian's .obsidian/ config on the next export.

**Proposed fix.** Export on desktop through an Electron IPC to a folder the person picks, or hide Export when 'files' is the current provider. On iOS, export to a dated folder or sync by diff rather than wipe, and never delete .obsidian/. Add a platform test.

**Verifier.** vaultExport.ts:34 gates only on 'web'. platform() returns 'electron' on desktop (platform.ts:13-15), and nothing in app/src or electron registers a native Filesystem, so @capacitor/filesystem falls back to its web implementation (IndexedDB 'Disc', web.js:27, 94). The Export button is in the storage sheet with no platform gate (VaultScreen.tsx:945-966), and the toast claims Files/Obsidian. Every non-web export starts with a recursive rmdir of Documents/Vault. I could not verify from code whether Obsidian iOS can open another app's Documents folder at all. If it cannot, the toast is false on iOS too and the .obsidian wipe is moot.

### [truth-12] 'Point Obsidian at the same files and it just opens' is false for the default provider and the team vault; Obsidian frontmatter renders wrong

medium, claim-mismatch, v1 must, size S, confirmed. `app/src/screens/VaultScreen.tsx:857`

**Evidence.** The storage sheet says 'Your notes are files... Point Obsidian at the same files and it just opens.' whatever the current provider. The Local provider stores `oscode.gitos.file.<resourceId>.<path> -> { text, updatedAt }` as sealed JSON (local.ts:8-10). The onboarding says 'Notes are .md files kept on this device'; the marketing site says 'The Vault is a markdown knowledge base that Obsidian opens as is.' (src/_data/oscode.js:122). VaultMarkdown uses only remarkGfm, so a YAML properties block renders as a rule plus a setext heading. wikilinksToMarkdown rewrites [[..]] even inside code fences.

**Impact.** The default vault cannot be opened in Obsidian at all. Real Obsidian notes brought in through This folder, iCloud or Drive render their properties as a big heading.

**Proposed fix.** Make the copy depend on the provider (Local: 'export to open in Obsidian'). Default desktop to the folder provider. Add remark-frontmatter with a properties strip, and skip code spans and fences in the wikilink rewrite.

**Verifier.** The storage sheet copy (VaultScreen.tsx:856-858) does not depend on the provider. Local stores sealed JSON under oscode.gitos.file.* keys (local.ts:7-10). DECISIONS:106-107 says Vault ships as Vault 'BECAUSE compat is true', which the default provider breaks. VaultMarkdown uses only remarkGfm and rehypeHighlight (VaultMarkdown.tsx:30-31), so YAML frontmatter renders as a thematic break plus a setext heading. wikilinksToMarkdown runs its regex over the whole text, including code fences (vault.ts:146-157).

### [truth-13] Local provider index update is an unserialized read-modify-write, so concurrent saves drop a note from the list

medium, data-loss, v1 must, size S, confirmed. `app/src/lib/gitos/local.ts:50`

**Evidence.** write() calls readIndex(), then `storeSetJson(indexKey, { files })`. platform.ts:94 says 'Reads are not serialized'. Scratch proof: `Promise.all([write('a.md'), write('b.md')])` lists only ['b.md'] while both file keys exist, leaving a.md orphaned. Real triggers: VaultMarkdown's dashed-link tap runs `flushSave(); void vaultCreate(p)` in parallel (VaultScreen.tsx:463-467), and replayVaultPending runs inside vaultSave alongside the next debounced save.

**Impact.** A note silently disappears from the tree and from backlinks. Its bytes remain in the store but are unreachable.

**Proposed fix.** Chain writes per resource in local.ts, or rebuild the index from a key scan on mismatch. Add a concurrency test like the scratch.

**Verifier.** local.ts:45-53 does an unserialized readIndex then storeSetJson. platform.ts serializes writes per key only, not reads. A scratch test with an async store confirmed it: Promise.all of write a.md and write b.md leaves the index as ['b.md'] while the a.md key still exists. The real sealed store is async (crypto), so the interleaving can happen. The triggers are narrow but real: a dashed-link tap runs flushSave plus vaultCreate (VaultScreen.tsx:463-467), and replay can overlap a debounced save.

### [truth-14] Moving the vault between providers is untested, skips notes that are not downloaded yet, and replays stale drafts onto the new provider

medium, test-gap, v1 must, size M, partial. `app/src/state/store.ts:6231`

**Evidence.** `const note = await source.read(VAULT_RESOURCE_ID, f.path); if (note) notes.push(...)`. For an evicted file the iCloud plugin resolves `found: false, downloading: true` (OscodeIcloudPlugin.swift:159), so the note is skipped. The vault is then repointed with the toast 'Your vault lives on ${p.label} now.' VaultPending is keyed by resourceId, which is always 'vault.personal' whatever the provider (store.ts:3033, :3043). No test file calls vaultMoveTo.

**Impact.** Moving from iCloud leaves notes that are not downloaded behind with no warning. They look lost in the new location. An offline draft stashed against the old provider can overwrite newer content on the new one.

**Proposed fix.** Before repointing, verify that every listed file was copied. Refuse the move, or wait and retry, when any read returns undefined. Show a copied/skipped report. Key the stash by providerId plus resource. Add store tests for evicted source files, a mid-move failure, a newer target copy, and stash isolation.

**Verifier.** The evidence 'No test file calls vaultMoveTo' is wrong: app/test/store.test.ts:638-652 calls it, though only for the refusal path. The successful move is untested. The rest holds. vaultMoveTo skips any read that returns undefined (store.ts:6229-6232). The iCloud plugin waits only 3 s and then resolves `found: false, downloading: true` (OscodeIcloudPlugin.swift:140-159), and icloud.ts read maps that to undefined. The move then repoints and shows a success toast. VaultPending keys are `${resourceId}::${path}`, with resourceId always 'vault.personal' (store.ts:3033, 3043), so a stash replays onto the new provider.

### [truth-15] The 'This folder' vault shared with the agent and Obsidian has no change detection and no atomic writes

medium, data-loss, v1 must, size M, confirmed. `app/electron/main.ts:967`

**Evidence.** osc:vaultWrite calls `writeFileSync(abs, text)` unconditionally, and the engine's vaultWrite does the same (tools/vault.ts:107). deviceFolder.ts says 'Concurrency is last-write-wins at the file level'. The open editor reloads only when vaultNote.path changes (VaultScreen.tsx:191), and a foreground refresh reloads only the list. There is no fs-watch (progress-archive.md:3802). The seam contract says 'Writes are atomic per path... never a torn write' (providers.ts:58-59). The osc:vault* IPC handlers have no tests (deviceFolder.test mocks the bridge).

**Impact.** If a note is open in the app while the agent (after approval) or Obsidian writes it, the next keystroke overwrites that change silently. A reader can see a half-written file.

**Proposed fix.** On write, compare against the mtime the draft loaded from and raise a conflict on mismatch. Watch the vault directory and push changes to the renderer. Write through a temp file and rename. Add IPC tests with a temp directory.

**Verifier.** osc:vaultWrite writes unconditionally with writeFileSync (electron/main.ts:962-968), and the engine does the same (tools/vault.ts:107). The seam contract says 'Writes are atomic per path... never a torn write' (providers.ts:57-59). deviceFolder.ts admits last-write-wins, the archive admits there is no fs-watch (progress-archive.md:3801-3802), and the draft reloads only on a path change. The osc:vault* handlers appear only in main.ts and preload.cjs, with no tests.

### [truth-16] A repository's config can move the agent's vault root and widen silent .md reads outside the vault

low, security, v1 should, size S, partial. `os-code/src/core/agent/registry.ts:145`

**Evidence.** `const vaultRoot = config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault');` The comment says 'Config can point it anywhere'. bootstrap.ts:116 calls `loadConfig(options.cwd)`, which merges the project's os-code.config.json. load.ts:79-86 drops only `daemon` from project config (DAE-9), not `vault`. vaultRead and vaultList are read risk, and DEFAULT_PERMISSIONS has `read: 'allow'`. Electron (main.ts:922) and the scheduler (scheduler.ts:682) read only the global config.

**Impact.** A cloned repo with {"vault":{"dir":"/home/me"}} lets the agent list and read every non-hidden .md file under home without a prompt. Even a harmless project override splits the agent's vault from the app's 'This folder' and from routine notes.

**Proposed fix.** Treat vault.dir as machine config only, like daemon: drop it from project config with a warning. Add a load.ts test.

**Verifier.** Accurate as far as it goes. load.ts:79-89 strips only `daemon` from project config, bootstrap.ts:116 loads project config, and registry.ts:145 honors vault.dir. The consistency harm (the agent's vault splitting from the app's 'This folder' and from routine notes) is real. As a security finding it is overstated, because the same project config can already set permissions.defaults.shell/write to 'allow', rules, providers[].baseUrl and verify.command (schema.ts:144-165, 301-315). Project config is fully trusted today, and vault.dir (.md reads only) is a minor addition to a much larger existing surface. Lowered to low.

### [truth-17] Lease read-only mode only disables the edit toggle; lease contention on real providers is untested

low, gap, v1 should, size S, confirmed. `app/src/screens/VaultScreen.tsx:374`

**Evidence.** readOnly gates only the Edit button (`disabled={readOnly}`). 'New note', 'Add a welcome note', Options 'Delete this note' (:524) and a dashed-link create (VaultMarkdown onOpenNote isNew leads to vaultCreate) all still write. vaultSave never checks the lease. The iCloud and Drive acquireLease are read-then-write, not atomic (icloud.ts:57-71, gdrive.ts:475-485). The FD-3 test uses a mock provider, and there is no icloud test file.

**Impact.** A device shown as 'read-only here so your edits do not collide' can still create and delete notes on the other device's vault.

**Proposed fix.** Gate every write in the store on the lease state. Add iCloud and Drive lease tests (a stale holder, two acquirers).

**Verifier.** readOnly is used only for the Edit toggle and the hint (VaultScreen.tsx:101, 374-375, 398, 405). New note (setNewOpen), Add a welcome note, Delete (Options sheet :501-522) and dashed-link vaultCreate are not gated, and vaultSave never checks the lease. The iCloud (icloud.ts:51-68) and Drive (gdrive.ts:475-485) acquireLease are read-then-write. There is no iCloud provider test file.

### [truth-18] Org-vault server semantics have no tests, and the SQL tests never run in CI

medium, test-gap, v1 must, size M, confirmed. `supabase/tests/rls.test.sql:96`

**Evidence.** The only vault cases are a traversal refusal (:96-98), a member write (:101-102), and a non-member refusal (:220-222). Nothing covers the org_vault_put conflict copy, a same-minute fold, the tombstone, the 1 MB cap, or list and tombstone convergence. The file runs only by hand (`supabase test db`, supabase/README.md:83). .github/workflows/ci.yml runs `deno test supabase/functions/_shared` and nothing else under supabase.

**Impact.** The one guarantee the team tier rests on, last write wins plus a conflict copy, has never been executed by a test. truth-1 and truth-3 went unnoticed.

**Proposed fix.** Add pgTAP cases for base mismatch, equal bodies, three writers, delete then put, and the size cap. Add a CI job that runs supabase start and supabase test db.

**Verifier.** The only vault cases in supabase/tests/rls.test.sql are the traversal refusal (96-98), a member write (101-102) and a non-member refusal (220-222). Nothing covers conflict copies, the fold, tombstones or the size cap. supabase/README.md:83 says `supabase test db` is run by hand. Under supabase, ci.yml runs only `deno test supabase/functions/_shared` (ci.yml:102), and no workflow runs pgTAP.

### [truth-19] Gaps against the Obsidian baseline and 'fully customizable': no rename or move, no tags or properties, no attachments, no vault settings

medium, gap, v1 should, size L, confirmed. `app/src/screens/VaultScreen.tsx:524`

**Evidence.** The note Options sheet offers only 'Delete this note', with no rename or move, so links cannot be updated. Embeds render as '`embed not supported yet`' (vault.ts:149). Every listing filters to `/\.md$/i` (electron/main.ts:942, tools/vault.ts:147), so images and attachments are invisible. There are no tags, frontmatter properties, outgoing-links panel, unlinked mentions, graph, daily notes or templates. The only vault setting anywhere is 'Where it lives', plus the engine's vault.dir.

**Impact.** Anyone coming from Obsidian loses rename-with-link-update and search on day one. Nothing is configurable: no new-note folder, agent-note folder, daily-note format, template folder, or which folders the agent may read.

**Proposed fix.** v1: search, and rename or move that rewrites [[links]] across the vault. Show frontmatter properties and #tags. Render images read-only. Add an outgoing-links card. Add a Vault settings sheet (default folders for new and agent notes, daily note and template folders, agent read scope, autosave delay). Later: graph, embeds, templates.

**Verifier.** No rename, move, frontmatter, tags, templates or daily notes exist in vault.ts, VaultScreen.tsx, VaultMarkdown.tsx or the store. The Options sheet has only Delete and Cancel. Embeds become '`embed not supported yet`' (vault.ts:149). Every listing filters to .md (electron/main.ts:941, tools/vault.ts:147). The only vault setting is the provider sheet, plus the engine's vault.dir.

### [truth-20] Crew routine note headings are garbled, and two runs in the same minute overwrite one note

low, bug, v1 should, size S, confirmed. `os-code/src/routines/scheduler.ts:595`

**Evidence.** `# ${active.routine.name}: ${stamp.replace(' ', ' at ').replace('-', ':')}`. Running this in node gives '2026:09-26 at 06-00', not '2026-09-26 at 06:00'. The path is stamped only to the minute and written with writeFileSync (:589-612), so two runs that start in the same minute share one file. routines.test.ts:275-280 asserts the body, not the heading.

**Impact.** Every routine report in the vault opens with a malformed date. A queued Run now can overwrite the previous report.

**Proposed fix.** Format the heading explicitly and add seconds or a run-id suffix to the file name. Assert the heading in routines.test.

**Verifier.** scheduler.ts:595 builds 'YYYY-MM-DD HH-MM', then `.replace(' ', ' at ').replace('-', ':')` replaces the first '-' (in the date), which gives '2026:09-26 at 06-00'. The file name is minute-grained and written with writeFileSync (589-612). Routines run one at a time, so a run that ends in under a minute followed by a queued Run now started in the same minute overwrites the earlier note. routines.test.ts:275-280 checks the body and file count, not the heading.

### [truth-21] Vault docs are stale or unverifiable: missing commits, an 'open' org tier, 'on a branch', 'Drive stays hidden', 'this iPhone' on desktop

low, docs, v1 should, size S, partial. `CLAUDE.md:17`

**Evidence.** CLAUDE.md, parked-ideas.md and DECISIONS cite commits b8e1658, ac74f77, 3b28146 and 243e43e. `git cat-file -t` reports 'Not a valid object name' for all four; history is squashed into d295756. parked-ideas.md:17 says 'Vault's ORGANIZATION tier still needs a real multi-writer backend'. The providers.ts:8-12 header says 'v1 ships one live provider... marked not ready until their OAuth wiring lands'. docs/design/vault-page-redesign.md says 'It is on a branch, not main', yet main contains vault-onboard. AUDIT-P0-ACTION-ITEMS.md D3 says 'Drive stays hidden and the vault storage sheet shows Local (and This folder on desktop) only', but VaultScreen.tsx:861 shows every row that is not arriving. On Linux, iCloud's row toasts 'Sign in to iCloud on this iPhone to use it.' and an unconfigured Drive row toasts 'Connect your Google account to use this.' with no way to connect.

**Impact.** Readers and future sessions trust claims the code does not back, and the storage sheet misleads on desktop.

**Proposed fix.** Sweep these docs. Hide Drive when !isGdriveConfigured() and iCloud off iOS, or give them device-true pending copy.

**Verifier.** The 'missing commits / history squashed into d295756' evidence is wrong. `git rev-parse --is-shallow-repository` returns true and the history is 81 commits deep, so d295756 is just the shallow boundary and the cited commits are simply outside this clone. That part cannot be verified here and is not a defect. The rest holds. parked-ideas.md:17-18 still says the org tier needs a backend. providers.ts:8-12 says 'v1 ships one live provider'. docs/design/vault-page-redesign.md:7 says 'on a branch, not main', yet vault-onboard is in theme.css and VaultScreen. AUDIT D3 (AUDIT-P0-ACTION-ITEMS.md:179-180) says Drive stays hidden, but the sheet renders every non-arriving row (VaultScreen.tsx:861), so a desktop sees 'Sign in to iCloud on this iPhone' and, with no OAuth client configured, a Drive row that only toasts.

### [truth-22] Vault device verification is incomplete, and some of it is no longer tracked in What remains

medium, test-gap, v1 must, size S, confirmed. `os-code/PROGRESS.md:711`

**Evidence.** Unchecked in What remains: the iCloud plugin's evicted-note behavior across two devices ('on two devices Remove Download a note and create the same name'), 'Founder config before Drive/dark ship: Google OAuth client ids', Crew routines ('confirm the note lands in ~/OSCode/Vault/Crew/Morning review/'), and the Hermes current ('the Vault reads its home through the paired computer'). The 'This folder' provider was 'Not device-verified... founder confirms on Pop!_OS' (parked-ideas.md, progress-archive.md:3802) and has dropped out of What remains. No item covers the iCloud vault's cross-device lease or a Local to iCloud or Drive move on a device.

**Impact.** Several providers labelled BUILT have never run on a real device. The desktop folder path, which the whole agent-and-app shared-vault story depends on, is not tracked at all.

**Proposed fix.** Add one 'Vault v1 on device' checklist to What remains: This folder with an agent write, iCloud on two devices (lease, evicted notes, move), Drive with the real OAuth clients (conflict, refresh), a team vault with two members (conflict copy), and export to Obsidian on iOS.

**Verifier.** These items are unchecked: the iCloud evicted-note check on two devices (PROGRESS.md:711-716), Google OAuth client ids (801-802), and the routine note landing at ~/OSCode/Vault/Crew (649). The 'This folder' provider was never device-verified (progress-archive.md:3800-3801, parked-ideas.md:374-375) and does not appear in What remains. No item covers the iCloud lease, a Local-to-cloud move on a device, a two-member team vault, or iOS export.

### [truth-23] Original brief vs what shipped (checklist)

medium, gap, v1 must, size XL, confirmed. `os-code/docs/parked-ideas.md:381`

**Evidence.** Decision points. DP1 Obsidian compatibility, including .obsidian/: PARTIAL. The grammar and paths are met (vault.ts:19), but the default Local store is sealed JSON (local.ts:8-10), frontmatter, embeds and attachments are unsupported, and export wipes .obsidian/. DP2 phone-only location: MET (Local default, iCloud and Drive probed at runtime). DP3 org backend: MET (Supabase, 0010). DP4 org permission model: PARTIAL, membership only; any member writes everywhere, with no admin-only or read-only areas (0010 header). DP5 automatic vs directed: PARTIAL; directed and approved writes are enforced (alwaysAsk), but nothing prompts the agent to use the vault and small seats never see it (truth-5). DP6 name: MET. Core requirements. R1 personal vault on by default as the agent's own target alongside your notes: PARTIAL; it is auto-registered (store.ts:5971), but the agent writes a different store (truth-4). R2 org vault alongside personal: MET, with conflict defects (truth-1, truth-3). R3 native browse, edit and backlinks: MET, but search is unwired (truth-9) and rename is missing. R4 agent reads vault as context and writes: PARTIAL; engine sessions on mid and large seats only, no retrieval, nothing in app drivers. R5 reuse enc:v1 for sensitive note content: PARTIAL; only Local is sealed under the device DEK, iCloud, Drive, folder and team are plaintext, and vaultWrite has no redactSecrets and stays registered under egress lockdown (registry.ts:84-88). Non-goals (live co-editing, plugins, transcript store): respected. DoD 'a genuine multi-writer sync story, not a best-effort synced folder': PARTIAL; the team tier is defeated by truth-1 and truth-3, and personal cloud sync is self-described as 'best-effort coordination for v1' (icloud.ts:7-9).

**Impact.** The brief's Definition of Done is met in structure but not in behavior. The agent-vault loop and multi-writer safety are what the founder's ask depends on, and both are partial.

**Proposed fix.** Close the partial items in this order. (1) Data safety: truth-1, 2, 3, 13, 14, 15. (2) One vault for app and agent: truth-4, 7, 16. (3) Vault as a context layer for every seat, measured by osc eval: truth-5, 6, 8. (4) The Obsidian v1 surface: truth-9, 11, 12, 19. (5) Tests, docs and the device checklist: truth-18, 21, 22. Record the org permission model and the enc:v1 stance for notes in DECISIONS.

**Verifier.** The brief (parked-ideas.md:380-490) contains all the cited decision points, requirements and the Definition of Done. The per-item verdicts match what I verified above: truth-1, 2, 4, 5 and 9 confirmed, truth-3 partial but still unsurfaced. Two refinements. DP4: the 0010 header records membership-only as the permission model. R5: DECISIONS:100-102 scopes enc:v1 per-repo keys to repos on untrusted storage, and plaintext vault notes are the deliberate price of Obsidian compatibility. Both are choices to record in DECISIONS rather than defects, as the fix already says. Vault tools stay registered under egress lockdown (registry.ts:84-88) with no redaction in vaultWrite.

### [missed-1/drive] Google Drive: saveIndex's merge advances the conflict base of notes other than the one being written, so a stale open draft overwrites a remote edit with no conflict copy

medium, data-loss, v1 must, size S, verifier-found. `app/src/lib/gitos/gdrive.ts:66`

**Evidence.** saveIndex (gdrive.ts:285-297) runs `handle.index = mergeIndex(handle.index, remote)` on every write, remove and cache-miss read. mergeIndex adopts the remote entry whenever `meta.updatedAt > mine.updatedAt` (gdrive.ts:64-67). writeFile's only conflict guard is `live.updatedAt !== cached.updatedAt` (gdrive.ts:421). Device B edits a.md and updates index.json. Device A, with a.md open, then writes any other note (for example replayVaultPending on foreground, store.ts:5993) or deletes one, which merges B's newer updatedAt for a.md into the cache. A's next autosave of a.md then passes the guard and putContent replaces B's edit.

**Impact.** This is the same class of loss as truth-1 and truth-2, reached without any earlier conflict: the other device's edit is silently replaced.

**Proposed fix.** Keep the base the draft loaded from with the draft (on vaultNote or in the provider, keyed by path, set only by read), not in the shared index cache. Compare Drive's live modifiedTime against that base on write.

### [missed-2] Engine comments still place project memory 'under Projects/&lt;project>/ in the vault' after the 2026-09-04 move into the repo

low, docs, v1 should, size S, verifier-found. `os-code/src/core/agent/bootstrap.ts:48`

**Evidence.** bootstrap.ts:48 says 'Used to place the project's memory notes under Projects/&lt;project>/ in the vault.' tools/index.ts:64 and registry.ts:90 repeat 'Projects/&lt;project>/'. projectMemory.ts:7-9 and DECISIONS 2026-09-04 say the notes live in the repo folder 'OpenShore Project &lt;name> MDs/', explicitly revising the earlier Vault placement. The same stale model is behind the Wayfinding copy in truth-10.

**Impact.** Future sessions reading these comments will think project memory is vault content and design vault retrieval or Memory gating on a false premise.

**Proposed fix.** Correct the three comments to name the repo memory folder, in the same sweep as truth-21.
