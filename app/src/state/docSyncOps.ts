// Sync on all devices for chats and projects, the store's side (founder,
// 2026-10-16; folder plan M5). The vault's runner (vaultSyncOps.ts) runs one
// pass per kind, over lib/docSync.ts's documents. store.ts wires it in with
// its own getters and setters, so this module never reaches into the store.
import {
  chatDoc,
  chatFromDoc,
  chatSyncs,
  docCopyPath,
  docCopyText,
  isDocPath,
  localDocs,
  projectDoc,
  projectFromDoc,
  projectSyncs,
  remoteDocs,
  type DocKind,
  type DocTransport,
} from '../lib/docSync.js';
import type { SyncResult } from '../lib/gitos/sync.js';
import type { Conversation, Project } from './types.js';
import { createVaultSync, type VaultSync } from './vaultSyncOps.js';

export interface DocSyncDeps {
  /** The computer's store and a stable key for it, or undefined when this
   *  device does not sync (Keep on one computer, nothing docked). */
  transport(): { transport: DocTransport; key: string } | undefined;
  /** Words for this device in a copy's name, e.g. "from this iPhone". */
  from(): string;
  chats: {
    all(): Conversation[];
    /** Put a chat in (or take it out, undefined), keeping the order by when
     *  it last changed. */
    put(id: string, chat: Conversation | undefined): void;
  };
  projects: {
    all(): Project[];
    put(id: string, project: Project | undefined): void;
  };
  onResult(kind: DocKind, result: SyncResult): void;
}

export interface DocSyncs {
  run(): Promise<void>;
  forget(key: string): Promise<void>;
}

export function createDocSyncs(deps: DocSyncDeps): DocSyncs {
  const make = (kind: DocKind, local: () => ReturnType<typeof localDocs>): VaultSync =>
    createVaultSync({
      local: () =>
        deps.transport() ? { provider: local(), resourceId: `sync.${kind}` } : undefined,
      remote: () => {
        const t = deps.transport();
        return t
          ? { baseUrl: t.key, side: { provider: remoteDocs(t.transport, kind), resourceId: kind } }
          : undefined;
      },
      from: deps.from,
      onResult: (r) => deps.onResult(kind, r),
      pass: {
        isItem: isDocPath,
        configs: false,
        conflictPath: (p, taken) => docCopyPath(p, taken),
        copyText: (text, copy) => docCopyText(kind, text, copy, deps.from()),
      },
    });

  const chats = make('chats', () =>
    localDocs({
      list: () =>
        deps.chats
          .all()
          .filter(chatSyncs)
          .map((c) => ({
            id: c.id,
            text: chatDoc(c),
            updatedAt: c.updatedAt,
            busy: c.thread.busy,
          })),
      apply: (id, text) => {
        if (text === undefined) {
          deps.chats.put(id, undefined);
          return undefined;
        }
        const existing = deps.chats.all().find((c) => c.id === id);
        const chat = chatFromDoc(text, id, existing);
        if (!chat) return undefined;
        deps.chats.put(id, chat);
        return chatDoc(chat);
      },
    }),
  );

  const projects = make('projects', () =>
    localDocs({
      list: () =>
        deps.projects
          .all()
          .filter(projectSyncs)
          .map((p) => ({ id: p.id, text: projectDoc(p), updatedAt: p.createdAt })),
      apply: (id, text) => {
        if (text === undefined) {
          deps.projects.put(id, undefined);
          return undefined;
        }
        const existing = deps.projects.all().find((p) => p.id === id);
        const project = projectFromDoc(text, id, existing);
        if (!project) return undefined;
        deps.projects.put(id, project);
        return projectDoc(project);
      },
    }),
  );

  return {
    async run() {
      // Projects first, so a chat that comes down finds its project here.
      await projects.run();
      await chats.run();
    },
    async forget(key) {
      await projects.forget(key, 'sync.projects');
      await chats.forget(key, 'sync.chats');
    },
  };
}
