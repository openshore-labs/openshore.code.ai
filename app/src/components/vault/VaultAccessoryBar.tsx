// The phone's accessory bar above the keyboard (Vault M6, 6.7; CTO K14, CX
// X15). One row that sits on the keyboard: four tools while no link is open
// (Insert link, Insert tag, Make this line a task, Hide keyboard), and the
// link suggestions as chips while one is (the screen passes a
// `VaultLinkSuggest` with `layout="chips"` as `suggest`; the tools step aside
// whenever it has rows).
//
// Motion rule 4: the bar is fixed to the bottom and lifted by a transform of
// the shell's `--kb-inset` (useKeyboardInset), never by a layout property, so
// it needs no layout pass and adds nothing to the composer's one documented
// padding rule. It rides useExitPresence, so it leaves the way it came.
//
// Every tool keeps focus in the note (`onMouseDown` preventDefault) and acts
// in onClick, where App's capture tick already answers the finger; no tool
// ticks on its own (UI-7).
import type { ReactNode, RefObject } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import type { TextRange } from 'os-code/protocol';
import { useExitPresence } from '../../hooks/useExitPresence.js';
import { Icon } from '../Icon.js';
import { durationMs } from '../../lib/motion.js';
import { VAULT_ACCESSORY } from '../../lib/vaultCopy.js';
import { insertAtCaret } from './VaultLinkSuggest.js';

/** An edit a tool makes: `insert` over `range`, then the caret at `caret`. */
export interface AccessoryEdit {
  range: TextRange;
  insert: string;
  caret: number;
}

/** Insert link: `[[]]` with the caret inside, or the selection wrapped. */
export function linkEdit(text: string, start: number, end: number): AccessoryEdit {
  const selected = text.slice(start, end);
  if (selected && !/[\n[\]|]/.test(selected)) {
    const insert = `[[${selected}]]`;
    return { range: { start, end }, insert, caret: start + insert.length };
  }
  return { range: { start: end, end }, insert: '[[]]', caret: end + 2 };
}

/** Insert tag: `#` at the caret, after a space when a word runs up to it. */
export function tagEdit(text: string, caret: number): AccessoryEdit {
  const prev = caret > 0 ? text[caret - 1]! : '';
  const insert = prev && !/\s/.test(prev) ? ' #' : '#';
  return { range: { start: caret, end: caret }, insert, caret: caret + insert.length };
}

const TASK_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[.\](?:\s|$)/;
const BULLET_LINE = /^(\s*)[-*+]\s+/;

/** Make this line a task: `- [ ] ` after the indent, or `[ ] ` after a bullet
 *  already there. Null when the line is a task already. The caret keeps its
 *  place in the words. */
export function taskEdit(text: string, caret: number): AccessoryEdit | null {
  const start = caret === 0 ? 0 : text.lastIndexOf('\n', caret - 1) + 1;
  const nl = text.indexOf('\n', start);
  const line = text.slice(start, nl === -1 ? text.length : nl);
  if (TASK_LINE.test(line)) return null;
  const bullet = line.match(BULLET_LINE);
  const at = start + (bullet ? bullet[0].length : (line.match(/^\s*/)?.[0].length ?? 0));
  const insert = bullet ? '[ ] ' : '- [ ] ';
  return {
    range: { start: at, end: at },
    insert,
    caret: caret >= at ? caret + insert.length : at + insert.length,
  };
}

function apply(
  el: HTMLTextAreaElement | null,
  edit: AccessoryEdit | null,
  onCaret?: (value: string, caret: number) => void,
): void {
  if (!el || !edit) return;
  insertAtCaret(el, edit.range, edit.insert);
  el.setSelectionRange?.(edit.caret, edit.caret);
  onCaret?.(el.value, edit.caret);
}

export interface VaultAccessoryBarProps {
  /** Shown while the note is being edited on a phone. */
  shown: boolean;
  editor: RefObject<HTMLTextAreaElement | null>;
  /** The link suggestions as chips, when a `[[` is open. */
  suggest?: ReactNode;
  /** The caret moved by a tool: the screen recomputes its link context. */
  onCaret?: (value: string, caret: number) => void;
}

export function VaultAccessoryBar({ shown, editor, suggest, onCaret }: VaultAccessoryBarProps) {
  const { mounted, closing } = useExitPresence(shown, durationMs('--dur-4', 280));
  if (!mounted) return null;
  const keep = (e: { preventDefault(): void }) => e.preventDefault();
  const sel = () => {
    const el = editor.current;
    return el
      ? { el, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length }
      : undefined;
  };
  return (
    <>
      <div className="vault-accessory-spacer" aria-hidden="true" />
      <div
        className={`vault-accessory${closing ? ' closing' : ''}`}
        role="toolbar"
        aria-label={VAULT_ACCESSORY.label}
      >
        {suggest}
        <div className="vault-accessory-tools">
          <button
            type="button"
            className="vault-accessory-btn press-fb"
            aria-label={VAULT_ACCESSORY.link}
            title={VAULT_ACCESSORY.link}
            onMouseDown={keep}
            onClick={() => {
              const s = sel();
              if (s) apply(s.el, linkEdit(s.el.value, s.start, s.end), onCaret);
            }}
          >
            <span className="vault-accessory-glyph" aria-hidden="true">
              [[ ]]
            </span>
          </button>
          <button
            type="button"
            className="vault-accessory-btn press-fb"
            aria-label={VAULT_ACCESSORY.tag}
            title={VAULT_ACCESSORY.tag}
            onMouseDown={keep}
            onClick={() => {
              const s = sel();
              if (s) apply(s.el, tagEdit(s.el.value, s.end), onCaret);
            }}
          >
            <span className="vault-accessory-glyph" aria-hidden="true">
              #
            </span>
          </button>
          <button
            type="button"
            className="vault-accessory-btn press-fb"
            aria-label={VAULT_ACCESSORY.task}
            title={VAULT_ACCESSORY.task}
            onMouseDown={keep}
            onClick={() => {
              const s = sel();
              if (s) apply(s.el, taskEdit(s.el.value, s.end), onCaret);
            }}
          >
            <Icon size={20}>
              <rect x="4" y="4" width="16" height="16" rx="4" />
              <path d="M8.5 12.5l2.4 2.4 4.6-5.3" />
            </Icon>
          </button>
          <button
            type="button"
            className="vault-accessory-btn vault-accessory-hide press-fb"
            aria-label={VAULT_ACCESSORY.hide}
            title={VAULT_ACCESSORY.hide}
            onMouseDown={keep}
            onClick={() => {
              const el = editor.current;
              void Keyboard.hide().catch(() => el?.blur());
            }}
          >
            <Icon size={20}>
              <rect x="3" y="4" width="18" height="11" rx="2.5" />
              <path d="M7 8h.01M11 8h.01M15 8h.01M8 11.5h8M9 18.5l3 2.5 3-2.5" />
            </Icon>
          </button>
        </div>
      </div>
    </>
  );
}
