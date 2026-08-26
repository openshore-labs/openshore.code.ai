// The chat screen. Empty state mirrors the Claude app's opening: just the mark
// and a time-of-day greeting, with the model, effort, and everything else
// living in the composer. A live conversation swaps in the transcript and a
// header that names the chat.
import { useEffect, useRef, useState } from 'react';
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
import { buildRotation, ENGLISH_GREETING, type Greeting } from '../lib/greeting.js';
import { hapticTick } from '../lib/haptics.js';
import type { Attachment } from '../lib/attachments.js';

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

  const conv = activeId ? conversations[activeId] : undefined;
  const thread = conv?.thread;
  const approval = thread?.pendingApprovals[0];

  // The splash greeting. English always lands first; tapping the line rotates
  // on through the other languages, in an order freshly shuffled each time we
  // arrive at the empty state.
  const isEmpty = !(conv && thread && thread.items.length > 0);
  const [rotation, setRotation] = useState(() => buildRotation());
  const [rotIdx, setRotIdx] = useState(0);
  // Crossfade layers: the last is the current word rising in; any earlier ones
  // are lifting out and drop themselves on animationend. Each carries a unique
  // id from this monotonic counter so a wrap back to English still remounts.
  const [layers, setLayers] = useState<{ id: number; g: Greeting }[]>(() => [
    { id: 0, g: ENGLISH_GREETING },
  ]);
  const seq = useRef(0);
  // One-time discovery nudge, played on the first empty-state paint of the
  // session and never again.
  const [hint, setHint] = useState(true);
  const wasEmpty = useRef(true);
  useEffect(() => {
    // Reshuffle and land on English again only when we return to the empty
    // state from a conversation, so the first paint keeps its initial rotation
    // (no flash) and every fresh chat starts from English with a new order.
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

  // Keep the empty-state greeting anchored to the center of the screen while the
  // keyboard is up, instead of letting it jump upward. iOS shifts a
  // position:fixed element by the keyboard's scroll offset (and can nudge it as
  // the visual viewport settles); we cancel that by translating the overlay back
  // down by the same offset, so the mark and the line hold dead center until a
  // real transcript replaces them. No-op on desktop and whenever offsetTop is 0.
  const greetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const el = greetRef.current;
    if (!isEmpty || !vv || !el || !window.matchMedia('(pointer: coarse)').matches) return;
    const apply = () => {
      el.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      el.style.transform = '';
    };
  }, [isEmpty]);

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
        <div className="greeting" ref={greetRef}>
          <BrandMark size={48} />
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
