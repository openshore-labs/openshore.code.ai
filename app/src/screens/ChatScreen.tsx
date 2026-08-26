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
// .composer-wrap in theme.css) so it always hugs the keyboard with no gap.
// Confirmed correct on device (composer-to-keyboard spacing reads as
// intended); left untouched.
//
// The greeting's freeze does NOT use --kb-inset or any other visual-viewport
// math, on purpose, after three attempts that each tried a different way of
// deciding "the keyboard is open" from viewport measurements (a fixed
// --kb-inset threshold; that same threshold with a settle debounce; that
// threshold with a settle debounce driven by requestAnimationFrame instead of
// a timer). All three shipped a greeting that kept tracking the composer,
// meaning the open-detection itself was silently never firing on the
// founder's device, not the settle timing. Rather than guess a fourth model of
// how this device reports viewport changes, the freeze now watches the one
// thing that is unconditionally true regardless of which resize model a
// device or WebView uses: the composer's own on-screen position, read
// directly via getBoundingClientRect(). Polling that every frame ties the
// freeze to the real, observed effect (the composer visibly rising) instead
// of an inferred cause (some viewport property crossing a threshold).
//
// Once the composer has risen past a threshold and held still for a few
// consecutive frames, this captures the greeting's CURRENT on-screen box
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
    let baseHeight = vv.height; // tallest visual viewport seen: the keyboard-down height

    // --kb-inset / kb-open: confirmed correct on device (composer-to-keyboard
    // spacing reads as intended). Left exactly as it was.
    const apply = () => {
      if (vv.height > baseHeight) baseHeight = vv.height; // auto-calibrate the baseline

      // Layout-space bottom coverage. Lifts the composer on a device whose
      // layout viewport does NOT shrink for the keyboard; ~0 on a device that
      // does (there the shell already ends above the keyboard on its own).
      const inset = Math.max(0, rootEl.clientHeight - vv.height - vv.offsetTop);
      rootEl.style.setProperty('--kb-inset', `${inset}px`);
      rootEl.classList.toggle('kb-open', vv.height < baseHeight - OPEN_THRESHOLD);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);

    // Freezing the greeting used to trigger off this same visual-viewport
    // math (a threshold on vv.height, then a settle wait). Across three
    // attempts, on the founder's device that trigger silently never fired at
    // all: no crash, no visible sign, the greeting just stayed in its normal
    // flex-tracking state forever, which reads on screen as "it follows the
    // composer down." Rather than guess a fourth time at how THIS device
    // reports viewport changes, drop viewport math from the freeze path
    // entirely and watch the one thing that is unconditionally true no matter
    // which resizing model a given device or WebView uses: the composer
    // itself visibly moves up when the keyboard opens. Polling its actual
    // getBoundingClientRect() every frame ties the freeze directly to the
    // real, observed effect on screen instead of an inferred cause.
    const RISE_THRESHOLD = 40; // px the composer must rise above its resting spot
    const STABLE_FRAMES = 4; // consecutive unchanged frames before trusting the position
    let restingTop = -1; // composer's lowest (keyboard-down) top seen so far
    let lastTop = -1;
    let stableCount = 0;
    let watchRaf = 0;

    const watchComposer = () => {
      const composerEl = document.querySelector<HTMLElement>('.composer-wrap');
      if (!composerEl || !greetingRef.current) {
        watchRaf = requestAnimationFrame(watchComposer);
        return;
      }
      const top = composerEl.getBoundingClientRect().top;
      if (restingTop < 0 || top > restingTop) restingTop = top; // track the resting position
      const risen = restingTop - top > RISE_THRESHOLD;
      if (!risen) {
        stableCount = 0;
        watchRaf = requestAnimationFrame(watchComposer);
        return;
      }
      if (Math.abs(top - lastTop) < 1) stableCount += 1;
      else {
        stableCount = 0;
        lastTop = top;
      }
      if (stableCount < STABLE_FRAMES) {
        watchRaf = requestAnimationFrame(watchComposer);
        return;
      }
      const el = greetingRef.current;
      rootEl.style.setProperty('--greeting-frozen-top', `${el.offsetTop}px`);
      rootEl.style.setProperty(
        '--greeting-frozen-height',
        `${el.getBoundingClientRect().height}px`,
      );
      setFrozen(true);
      // watchRaf left unscheduled: done for this empty state until resetKey clears it.
    };
    watchRaf = requestAnimationFrame(watchComposer);

    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      if (watchRaf) cancelAnimationFrame(watchRaf);
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
