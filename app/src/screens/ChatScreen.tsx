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
// see on its own: on a device whose LAYOUT viewport does not shrink for the
// keyboard the way the visual viewport does, the browser auto-scrolls the page
// to keep the focused field visible and overshoots, leaving a dead gap between
// the composer and the keyboard. Track it via visualViewport instead, as a live
// CSS variable on the root, --kb-inset: the composer reads it (see
// .composer-wrap in theme.css) so it always hugs the keyboard with no gap,
// regardless of which resize mode the device uses.
//
// The greeting has to detect "the keyboard is up" a different way than a raw
// --kb-inset threshold: on a device that DOES shrink the layout viewport for
// the keyboard (window.innerHeight drops right along with visualViewport,
// unlike the device assumed above), --kb-inset never exceeds a fixed pixel
// threshold, so a threshold on that alone can silently never fire, leaving the
// greeting stuck in its flexible, composer-tracking state forever. The signal
// that IS reliable on every device is the visual viewport's own height
// dropping below its keyboard-down baseline (auto-calibrated as the tallest
// height seen so far, --kb-open toggled on document root once it drops more
// than OPEN_THRESHOLD below that baseline).
//
// Two earlier attempts tried to wait for the keyboard's rise animation to
// finish (a resettable debounce, then a one-shot delay) before freezing the
// greeting's height, on the theory that freezing mid-animation would capture a
// transient height. Both still shipped a greeting that kept tracking the
// composer, because the OPEN signal itself (the old --kb-inset threshold)
// never crossed on the founder's device, so neither timer ever got the chance
// to run. Detecting open via visual-viewport height instead of layout-space
// inset fixes the actual gap; settling via a short run of stable
// requestAnimationFrame samples (rather than a fixed delay) then captures the
// truly-final height without guessing a duration.
//
// Once open and settled, this captures the greeting's CURRENT on-screen box
// (offsetTop relative to its offset parent, .shell-main, plus its rendered
// height) into --greeting-frozen-top / --greeting-frozen-height, and the
// .greeting-frozen class (driven by this hook's return value) switches the
// greeting to position: absolute at exactly that spot (see theme.css). Once
// out of the flex flow like that, nothing the composer does afterward, keyboard
// dismissed or not, can move it again for the rest of this empty state.
// `resetKey` clears the freeze; ChatScreen bumps it each time a fresh empty
// state arrives so the next one can settle fresh.
//
// A rigid, guessed height (no measure-then-freeze step at all) is what caused
// the whole page to scroll off-screen on a shorter phone in an earlier
// attempt: a fixed height doesn't know whether the keyboard actually leaves
// that much room, and when it doesn't, WKWebView's native "scroll the focused
// field into view" kicks in and drags everything, header included, off the
// top of the screen. Freezing a height that was already laid out correctly
// (via flex: 1, while still in-flow) guarantees it always fits, on every
// device.
function useKeyboardInset(greetingRef: RefObject<HTMLDivElement>, resetKey: number): boolean {
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    setFrozen(false);
    const vv = window.visualViewport;
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
    const rootEl = document.documentElement;
    const OPEN_THRESHOLD = 80; // px the visual viewport must lose to count as keyboard-up
    const STABLE_FRAMES = 3; // consecutive unchanged frames before trusting the height
    let baseHeight = vv.height; // tallest visual viewport seen: the keyboard-down height
    let didFreeze = false;
    let settleRaf = 0;
    let lastHeight = -1;
    let stableCount = 0;

    // Polls with requestAnimationFrame until the visual viewport height holds
    // steady for a few consecutive frames, then captures the greeting's resting
    // box. rAF always fires and naturally stops once motion ends, so (unlike a
    // fixed-delay timer) it cannot be scheduled for the wrong duration or fail
    // to run at all.
    const settleThenFreeze = () => {
      if (Math.abs(vv.height - lastHeight) < 1) {
        stableCount += 1;
      } else {
        stableCount = 0;
        lastHeight = vv.height;
      }
      if (stableCount >= STABLE_FRAMES && greetingRef.current) {
        didFreeze = true;
        const el = greetingRef.current;
        rootEl.style.setProperty('--greeting-frozen-top', `${el.offsetTop}px`);
        rootEl.style.setProperty(
          '--greeting-frozen-height',
          `${el.getBoundingClientRect().height}px`,
        );
        setFrozen(true);
        return;
      }
      settleRaf = requestAnimationFrame(settleThenFreeze);
    };

    const apply = () => {
      if (vv.height > baseHeight) baseHeight = vv.height; // auto-calibrate the baseline

      // Layout-space bottom coverage. Lifts the composer on a device whose
      // layout viewport does NOT shrink for the keyboard; ~0 on a device that
      // does (there the shell already ends above the keyboard on its own).
      const inset = Math.max(0, rootEl.clientHeight - vv.height - vv.offsetTop);
      rootEl.style.setProperty('--kb-inset', `${inset}px`);

      const open = vv.height < baseHeight - OPEN_THRESHOLD;
      rootEl.classList.toggle('kb-open', open);

      if (open && !didFreeze && !settleRaf) settleRaf = requestAnimationFrame(settleThenFreeze);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      if (settleRaf) cancelAnimationFrame(settleRaf);
      rootEl.classList.remove('kb-open');
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
