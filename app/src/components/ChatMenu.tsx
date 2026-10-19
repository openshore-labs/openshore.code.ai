// A chat's right-click menu (founder, 2026-10-19: "I should be able to right
// click a recent chat and get the option to delete it, and whatever other
// standard options"). One menu for every list of chats, the sidebar's recents
// and the Chats room: Open, Rename, and Delete, which asks first since a chat
// cannot be brought back. It opens at the pointer (or under the row from the
// keyboard's menu key), takes the arrow keys, closes on Escape, a click away,
// or a pick, and animates out like every surface (useExitPresence).
//
// useChatActions owns the menu and the two sheets it leads to, so a list
// renders `node` once and calls `openMenu` from a row's onContextMenu.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../state/store.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { hapticTick } from '../lib/haptics.js';
import { Sheet } from './Sheet.js';

/** The exit's length: --dur-3, which the menu's closing animation runs on. */
const MENU_EXIT_MS = 220;
/** Room kept between the menu and the window's edge. */
const EDGE = 8;

export interface ChatMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/** Where a menu opens: the pointer, or under the row for the keyboard. */
export function menuPoint(e: ReactMouseEvent<HTMLElement>): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + 12, y: r.bottom };
}

/** Keep a menu of this size whole inside the window. */
export function clampMenu(
  at: { x: number; y: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(EDGE, Math.min(at.x, view.width - size.width - EDGE));
  const below = at.y + size.height + EDGE <= view.height;
  const top = below ? at.y : Math.max(EDGE, at.y - size.height);
  return { left, top };
}

export function ChatContextMenu({
  at,
  items,
  label,
  onClose,
}: {
  at: { x: number; y: number } | undefined;
  items: ChatMenuItem[];
  label: string;
  onClose: () => void;
}) {
  const { mounted, closing } = useExitPresence(Boolean(at), MENU_EXIT_MS);
  const last = useRef(at);
  if (at) last.current = at;
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | undefined>();

  useLayoutEffect(() => {
    if (!at || !menu.current) return;
    const r = menu.current.getBoundingClientRect();
    setPlace(
      clampMenu(
        at,
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    menu.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const close = () => onClose();
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [at, onClose]);

  if (!mounted || typeof document === 'undefined') return null;
  const point = at ?? last.current ?? { x: 0, y: 0 };
  const pos = place ?? { left: point.x, top: point.y };

  const move = (step: number) => {
    const rows = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(i + step + rows.length) % rows.length]?.focus();
  };

  return createPortal(
    <>
      <div
        className={`chat-menu-scrim${closing ? ' closing' : ''}`}
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menu}
        className={`chat-menu${closing ? ' closing' : ''}`}
        role="menu"
        aria-label={label}
        style={{ left: pos.left, top: pos.top }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            move(-1);
          } else if (e.key === 'Tab') {
            onClose();
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`chat-menu-row press-fb${item.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

/** A chat list's actions: the menu, the rename sheet and the delete confirm.
 *  `onDelete` replaces the plain delete, for a list whose row leaves first. */
export function useChatActions(opts: { onDelete?: (id: string) => void } = {}): {
  openMenu: (e: ReactMouseEvent<HTMLElement>, id: string) => void;
  rename: (id: string) => void;
  confirmDelete: (id: string) => void;
  node: ReactNode;
} {
  const { conversations, openConversation, deleteConversation, renameConversation, showToast } =
    useApp();
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | undefined>();
  const [renameId, setRenameId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | undefined>();
  const onDelete = opts.onDelete;

  const rename = useCallback(
    (id: string) => {
      const conv = conversations[id];
      if (!conv) return;
      hapticTick();
      setDraft(conv.title === 'New chat' ? '' : conv.title);
      setRenameId(id);
    },
    [conversations],
  );
  const confirmDelete = useCallback((id: string) => setConfirmId(id), []);
  const openMenu = useCallback((e: ReactMouseEvent<HTMLElement>, id: string) => {
    e.preventDefault();
    setMenu({ id, at: menuPoint(e) });
  }, []);
  const closeMenu = useCallback(() => setMenu(undefined), []);

  const menuId = menu?.id;
  const items: ChatMenuItem[] = menuId
    ? [
        { label: 'Open', onSelect: () => openConversation(menuId) },
        { label: 'Rename', onSelect: () => rename(menuId) },
        { label: 'Delete', danger: true, onSelect: () => confirmDelete(menuId) },
      ]
    : [];

  const renameConv = renameId ? conversations[renameId] : undefined;
  const confirmConv = confirmId ? conversations[confirmId] : undefined;

  const node = (
    <>
      <ChatContextMenu
        at={menu?.at}
        items={items}
        label={menuId ? `${conversations[menuId]?.title ?? 'Chat'}, actions` : 'Chat actions'}
        onClose={closeMenu}
      />

      <Sheet open={Boolean(confirmConv)} onClose={() => setConfirmId(undefined)} variant="confirm">
        {confirmConv ? (
          <>
            <h3>Delete this chat?</h3>
            <p>{confirmConv.title}. This cannot be undone.</p>
            <div className="confirm-row">
              <button className="btn ghost" onClick={() => setConfirmId(undefined)}>
                Keep it
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  const id = confirmConv.id;
                  setConfirmId(undefined);
                  if (onDelete) onDelete(id);
                  else {
                    deleteConversation(id);
                    showToast('Chat deleted.');
                  }
                }}
              >
                Delete
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      <Sheet open={Boolean(renameConv)} onClose={() => setRenameId(undefined)} variant="confirm">
        {renameConv ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void renameConversation(renameConv.id, draft);
              setRenameId(undefined);
            }}
          >
            <h3>Name this chat</h3>
            <div className="field">
              <input
                autoFocus
                aria-label="Chat name"
                value={draft}
                maxLength={80}
                placeholder="A short name"
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <div className="confirm-row">
              <button type="button" className="btn ghost" onClick={() => setRenameId(undefined)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!draft.trim()}>
                Save
              </button>
            </div>
          </form>
        ) : null}
      </Sheet>
    </>
  );

  return { openMenu, rename, confirmDelete, node };
}
