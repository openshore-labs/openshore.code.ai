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
import { buildRotation } from '../lib/greeting.js';
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
  const wasEmpty = useRef(true);
  useEffect(() => {
    // Reshuffle and land on English again only when we return to the empty
    // state from a conversation, so the first paint keeps its initial rotation
    // (no flash) and every fresh chat starts from English with a new order.
    if (isEmpty && !wasEmpty.current) {
      setRotation(buildRotation());
      setRotIdx(0);
    }
    wasEmpty.current = isEmpty;
  }, [isEmpty]);
  const greeting = rotation[rotIdx];
  const rotate = () => setRotIdx((i) => (i + 1) % rotation.length);

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
        <div className="greeting">
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
            <span key={rotIdx} className="greeting-swap">
              {greeting.native}
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
