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
// intended).
//
// That same native "scroll to keep the composer visible" is also what was
// dragging the greeting: on this device it is a REAL page scroll (the header
// and status bar shifted up in the same screenshot the greeting did), and
// position: fixed does not automatically survive that on iOS the way it
// should, it drifts along with everything else unless compensated for.
// visualViewport.offsetTop is exactly how far that scroll has moved the
// visual viewport down within the layout viewport, so translating the
// greeting back by the same amount, every single time this fires, cancels it.
// This runs unconditionally on every event, with no "is the keyboard open"
// threshold or settle wait involved at all, so unlike the four earlier
// attempts at freezing a value once some detected condition became true,
// there is no trigger here that can silently fail to fire.
function useKeyboardInset(greetingRef: RefObject<HTMLDivElement>): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
    const rootEl = document.documentElement;
    let baseHeight = vv.height; // tallest visual viewport seen: the keyboard-down height
    const apply = () => {
      if (vv.height > baseHeight) baseHeight = vv.height; // auto-calibrate the baseline

      // Layout-space bottom coverage. Lifts the composer on a device whose
      // layout viewport does NOT shrink for the keyboard; ~0 on a device that
      // does (there the shell already ends above the keyboard on its own).
      const inset = Math.max(0, rootEl.clientHeight - vv.height - vv.offsetTop);
      rootEl.style.setProperty('--kb-inset', `${inset}px`);
      rootEl.classList.toggle('kb-open', vv.height < baseHeight - 80);

      // Read greetingRef.current fresh, not captured: the greeting div
      // unmounts and remounts (replaced by MessageList and back) across the
      // life of this one long-lived effect, and this stays correct across
      // every one of those cycles since it always reflects whichever
      // instance is live right now. A stale, once-captured node would only
      // ever compensate the FIRST greeting, silently doing nothing for any
      // later one.
      if (greetingRef.current) {
        greetingRef.current.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
      }
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      rootEl.classList.remove('kb-open');
      // Not clearing the greeting's transform here: whatever instance is
      // live at teardown unmounts along with the rest of ChatScreen, so
      // there is no residual style left behind to clean up.
    };
  }, [greetingRef]);
}

// .greeting is position: fixed (see theme.css), so its top offset is measured
// from the actual viewport, not from anywhere in the document, and needs to
// clear the header itself. The header's rendered height is not a constant we
// can hardcode: it varies with env(safe-area-inset-top), which differs by
// notch/Dynamic-Island depth across devices and can even change at runtime
// (a Live Activity or phone-call status bar can grow it). Measuring it is a
// plain, unconditional "how tall is this element right now" question, nothing
// to do with detecting keyboard state, so unlike useKeyboardInset's history
// there is no failure-prone trigger involved.
function useHeaderHeight(headerRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty('--header-height', `${el.offsetHeight}px`);
    };
    apply();
    const obs = new ResizeObserver(apply);
    obs.observe(el);
    return () => obs.disconnect();
  }, [headerRef]);
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
  const headerRef = useRef<HTMLElement>(null);
  const greetingRef = useRef<HTMLDivElement>(null);
  useHeaderHeight(headerRef);
  useKeyboardInset(greetingRef);

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
      <header className="topbar" ref={headerRef}>
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

      <div className="chat-body">
        {conv && thread && thread.items.length > 0 ? (
          <MessageList
            thread={thread}
            onSwitchToLocal={() => {
              setSheetStage('local');
              setSheetOpen(true);
            }}
          />
        ) : (
          <div className="greeting" ref={greetingRef}>
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
      </div>

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
