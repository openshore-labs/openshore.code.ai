// The chat screen. Empty state mirrors the Claude app's opening: just the mark
// and a time-of-day greeting, with the model, effort, and everything else
// living in the composer. A live conversation swaps in the transcript and a
// header that names the chat.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useApp } from '../state/store.js';
import { sourceLabel, sourceSupportsVision, type ConversationSource } from '../state/types.js';
import { MessageList } from '../components/MessageList.js';
import { Composer } from '../components/Composer.js';
import { ApprovalSheet } from '../components/ApprovalSheet.js';
import { ModelSheet } from '../components/ModelSheet.js';
import { ModeSheet } from '../components/ModeSheet.js';
import { ProfileStatus } from '../components/ProfileStatus.js';
import { BrandMark } from '../components/BrandMark.js';
import { MenuIcon } from '../components/MenuIcon.js';
import { buildRotation, type Greeting } from '../lib/greeting.js';
import { hapticTick } from '../lib/haptics.js';
import type { Attachment } from '../lib/attachments.js';

// True once the boot splash has lifted off the screen. The composer waits for
// this before it focuses, so the keyboard pulls up gracefully as the greeting is
// revealed, never underneath the splash. Starts true when there is no splash
// (the desktop shell, or any later return to the empty state within a session),
// so nothing ever waits needlessly.
function useBooted(): boolean {
  const [booted, setBooted] = useState(() => !document.getElementById('boot-splash'));
  useEffect(() => {
    if (booted) return;
    const gone = () => {
      if (document.getElementById('boot-splash')) return false;
      setBooted(true);
      return true;
    };
    if (gone()) return;
    const obs = new MutationObserver(() => gone());
    obs.observe(document.body, { childList: true });
    return () => obs.disconnect();
  }, [booted]);
  return booted;
}

// How much of the screen the on-screen keyboard covers is not something CSS can
// see on its own: the layout viewport (100%, driving our flex column) does not
// shrink for the keyboard the way the visual viewport does, so without this the
// browser auto-scrolls the page to keep the focused field visible and overshoots,
// leaving a dead gap between the composer and the keyboard. Track it via
// visualViewport instead, as a live CSS variable on the root, --kb-inset: the
// composer reads it so it always hugs the keyboard (or the safe area when there
// is none) with no gap.
//
// The greeting is two states, not a continuous reaction: while the keyboard is
// rising, it stays flex: 1 (see .greeting's touch rule in theme.css) so it can
// only ever shrink to whatever room is actually left, hugging the composer
// directly, never overflowing the screen. The instant the keyboard has
// genuinely opened and its rise animation has had a moment to settle, this
// measures the greeting's OWN current (already-correct, already-fitting)
// rendered height and freezes it there via --greeting-frozen-height, paired
// with the .greeting-frozen class this hook's return value drives: flex: none
// locks the box at that exact size, so it can never move again for the rest of
// this empty state, keyboard dismissed or not. The composer keeps tracking the
// live keyboard height regardless, so only the greeting stays put. `resetKey`
// clears the freeze; ChatScreen bumps it each time a fresh empty state arrives
// so the next one can settle fresh.
//
// A height that is fixed WITHOUT this measure-then-freeze step is what caused
// the whole page to scroll off-screen on a shorter phone in an earlier attempt:
// a rigid guess doesn't know whether the keyboard actually leaves that much
// room, and when it doesn't, WKWebView's native "scroll the focused field into
// view" kicks in and drags everything, header included, off the top of the
// screen. Freezing a height that was already laid out correctly (via flex: 1)
// guarantees it always fits, on every device.
function useKeyboardInset(greetingRef: RefObject<HTMLDivElement>, resetKey: number): boolean {
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    setFrozen(false);
    const vv = window.visualViewport;
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
    const root = document.documentElement.style;
    const KEYBOARD_THRESHOLD = 80; // px; comfortably above safe-area/rounding noise
    const SETTLE_MS = 350; // wait for the keyboard's rise animation to quiet down
    let didFreeze = false;
    // Scheduled ONCE, on the first crossing, and never rescheduled: a keyboard
    // rise can keep emitting visualViewport resize events past a short debounce
    // window, and a debounce that resets on every event risks never getting a
    // quiet gap to fire in, silently leaving the greeting stuck unfrozen (which
    // reads as "it drops when the keyboard closes", since it then keeps
    // tracking the composer forever instead of locking in place).
    let scheduled = false;
    const freeze = () => {
      if (didFreeze || !greetingRef.current) return;
      didFreeze = true;
      const height = greetingRef.current.getBoundingClientRect().height;
      root.setProperty('--greeting-frozen-height', `${height}px`);
      setFrozen(true);
    };
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      root.setProperty('--kb-inset', `${inset}px`);
      if (!didFreeze && !scheduled && inset > KEYBOARD_THRESHOLD) {
        scheduled = true;
        setTimeout(freeze, SETTLE_MS);
      }
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [resetKey, greetingRef]);
  return frozen;
}

export function ChatScreen({ compact }: { compact: boolean }) {
  const {
    activeId,
    conversations,
    send,
    abort,
    answerApproval,
    newConversation,
    switchModel,
    setDrawer,
    setView,
  } = useApp();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Which sub-sheet the model sheet opens on: 'root' from the composer pill,
  // 'local' from the out-of-usage "Switch to a local model" tap.
  const [sheetStage, setSheetStage] = useState<'root' | 'local'>('root');
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  // The brain a new chat will use, chosen from the composer. Defaults to the
  // stack, which is what "My Stack" selects.
  const [selectedSource, setSelectedSource] = useState<ConversationSource>({ kind: 'stack' });
  const booted = useBooted();
  // Bumped each time a fresh empty state arrives, so the greeting's frozen
  // height (see useKeyboardInset) resets and can settle again for it.
  const [kbGen, setKbGen] = useState(0);
  const greetingRef = useRef<HTMLDivElement>(null);
  const greetingFrozen = useKeyboardInset(greetingRef, kbGen);

  const conv = activeId ? conversations[activeId] : undefined;
  const thread = conv?.thread;
  const approval = thread?.pendingApprovals[0];

  // The splash greeting. A fresh time-and-day-aware landing line lands first;
  // tapping the line rotates on through the world languages, in an order freshly
  // shuffled each time we arrive at the empty state.
  const isEmpty = !(conv && thread && thread.items.length > 0);
  const [rotation, setRotation] = useState(() => buildRotation());
  const [rotIdx, setRotIdx] = useState(0);
  // Crossfade layers: the last is the current word rising in; any earlier ones
  // are lifting out and drop themselves on animationend. Each carries a unique
  // id from this monotonic counter so a wrap back to the landing still remounts.
  const [layers, setLayers] = useState<{ id: number; g: Greeting }[]>(() => [
    { id: 0, g: rotation[0] },
  ]);
  const seq = useRef(0);
  // One-time discovery nudge, played on the first empty-state paint of the
  // session and never again.
  const [hint, setHint] = useState(true);
  const wasEmpty = useRef(true);
  useEffect(() => {
    // Reshuffle and re-pick a fresh landing line only when we return to the
    // empty state from a conversation, so the first paint keeps its initial
    // rotation (no flash) and every fresh chat gets a new greeting and order.
    if (isEmpty && !wasEmpty.current) {
      const rot = buildRotation();
      setRotation(rot);
      setRotIdx(0);
      seq.current += 1;
      setLayers([{ id: seq.current, g: rot[0] }]);
      setKbGen((g) => g + 1);
    }
    wasEmpty.current = isEmpty;
  }, [isEmpty]);
  const greeting = rotation[rotIdx];

  const rotate = () => {
    hapticTick();
    const next = (rotIdx + 1) % rotation.length;
    seq.current += 1;
    setRotIdx(next);
    setLayers((ls) => [...ls, { id: seq.current, g: rotation[next] }]);
  };

  // The composer pill shows the live chat's brain when one is open, otherwise
  // the pending selection for the next new chat.
  const composerSource = conv ? conv.source : selectedSource;

  const startWith = async (
    source: ConversationSource,
    text?: string,
    attachments?: Attachment[],
  ) => {
    const id = await newConversation(source);
    if (text || (attachments && attachments.length)) {
      useApp.getState().sendWhenAttached(id, text ?? '', attachments);
    }
  };

  return (
    <div className="shell-main">
      <header className="topbar">
        {compact ? (
          <button className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label="Menu">
            <MenuIcon />
          </button>
        ) : null}
        {conv ? (
          <div className="topbar-title">
            {conv.title}
            <div className="topbar-sub">
              {thread?.model
                ? `${thread.model.name} · ${thread.model.kind}${thread.contextPercent ? ` · ctx ${thread.contextPercent}%` : ''}`
                : sourceLabel(conv.source)}
            </div>
          </div>
        ) : (
          <div className="topbar-spacer" />
        )}
        {/* Terminal entry, desktop-backed chats only: a real PTY on the desktop,
            reached over the daemon from the phone and over IPC in the desktop
            app. Non-desktop chats have no terminal, so it stays hidden. */}
        {conv && conv.source.kind === 'desktop' ? (
          <button
            className="icon-btn press-fb"
            onClick={() => setView('terminal')}
            aria-label="Open terminal"
            title="Terminal"
          >
            {'>_'}
          </button>
        ) : null}
        <ProfileStatus />
      </header>

      {conv && thread && thread.items.length > 0 ? (
        <MessageList
          thread={thread}
          onSwitchToLocal={() => {
            setSheetStage('local');
            setSheetOpen(true);
          }}
        />
      ) : (
        <div className={`greeting${greetingFrozen ? ' greeting-frozen' : ''}`} ref={greetingRef}>
          <BrandMark size={40} />
          <h1
            className="greeting-line press-fb"
            dir="auto"
            lang={greeting.code}
            role="button"
            tabIndex={0}
            aria-label={greeting.english}
            onClick={rotate}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                rotate();
              }
            }}
          >
            <span
              className={`greeting-swap-stack${hint ? ' greeting-hint' : ''}`}
              onAnimationEnd={(e) => {
                if (e.animationName === 'greet-hint') setHint(false);
              }}
            >
              {layers.map((layer, i) => {
                const current = i === layers.length - 1;
                return (
                  <span
                    key={layer.id}
                    className={current ? 'greeting-swap' : 'greeting-swap greeting-swap-out'}
                    onAnimationEnd={
                      current
                        ? undefined
                        : (e) => {
                            if (e.animationName === 'greet-swap-out')
                              setLayers((ls) => ls.filter((l) => l.id !== layer.id));
                          }
                    }
                  >
                    {layer.g.native}
                  </span>
                );
              })}
            </span>
          </h1>
        </div>
      )}

      <Composer
        busy={Boolean(thread?.busy)}
        source={composerSource}
        visionSupported={sourceSupportsVision(composerSource)}
        autoFocus={isEmpty && booted}
        onOpenModelSheet={() => {
          setSheetStage('root');
          setSheetOpen(true);
        }}
        onOpenModeSheet={() => setModeSheetOpen(true)}
        onSend={(text, attachments) => {
          if (!conv) {
            void startWith(selectedSource, text, attachments);
            return;
          }
          send(text, attachments);
        }}
        onStop={abort}
      />

      {approval ? (
        <ApprovalSheet
          request={approval}
          onAnswer={(approve, always) => answerApproval(approval.id, approve, always)}
        />
      ) : null}

      {sheetOpen ? (
        <ModelSheet
          initialStage={sheetStage}
          onPick={(source) => {
            setSelectedSource(source);
            setSheetOpen(false);
            // With a chat open, switch its model in place and carry the thread
            // (Claude-style). With none open, this just sets the brain the next
            // send will use.
            if (conv) void switchModel(source);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}

      {modeSheetOpen ? <ModeSheet onClose={() => setModeSheetOpen(false)} /> : null}
    </div>
  );
}
