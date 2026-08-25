// The chat screen. Empty state mirrors the Claude app's opening: just the mark
// and a time-of-day greeting, with the model, effort, and everything else
// living in the composer. A live conversation swaps in the transcript and a
// header that names the chat.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { sourceLabel, sourceSupportsVision, type ConversationSource } from '../state/types.js';
import { MessageList } from '../components/MessageList.js';
import { Composer } from '../components/Composer.js';
import { ApprovalSheet } from '../components/ApprovalSheet.js';
import { ModelSheet } from '../components/ModelSheet.js';
import { ProfileStatus } from '../components/ProfileStatus.js';
import { BrandMark } from '../components/BrandMark.js';
import { timeGreeting } from '../lib/greeting.js';
import type { Attachment } from '../lib/attachments.js';

export function ChatScreen({ compact }: { compact: boolean }) {
  const { activeId, conversations, send, abort, answerApproval, newConversation, setDrawer } =
    useApp();
  const [sheetOpen, setSheetOpen] = useState(false);
  // The brain a new chat will use, chosen from the composer. Defaults to the
  // stack, which is what "My Stack" selects.
  const [selectedSource, setSelectedSource] = useState<ConversationSource>({ kind: 'stack' });

  const conv = activeId ? conversations[activeId] : undefined;
  const thread = conv?.thread;
  const approval = thread?.pendingApprovals[0];

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
          <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Menu">
            {'☰'}
          </button>
        ) : null}
        {conv ? (
          <div className="topbar-title">
            {conv.title}
            <div className="topbar-sub">
              {thread?.model
                ? `${thread.model.name} · ${thread.model.kind}${thread.dollars > 0 ? ` · $${thread.dollars.toFixed(2)}` : ''}${thread.contextPercent ? ` · ctx ${thread.contextPercent}%` : ''}`
                : sourceLabel(conv.source)}
            </div>
          </div>
        ) : (
          <div className="topbar-spacer" />
        )}
        <ProfileStatus />
      </header>

      {conv && thread && thread.items.length > 0 ? (
        <MessageList thread={thread} />
      ) : (
        <div className="greeting">
          <span className="brand-lockup">
            <BrandMark size={44} />
            <span className="wordmark" style={{ fontSize: 30 }}>
              Open<span className="accent">Shore</span>
            </span>
          </span>
          <h1>{timeGreeting()}. What are we building?</h1>
        </div>
      )}

      <Composer
        busy={Boolean(thread?.busy)}
        source={composerSource}
        visionSupported={sourceSupportsVision(composerSource)}
        onOpenModelSheet={() => setSheetOpen(true)}
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
          onPick={(source) => {
            setSelectedSource(source);
            setSheetOpen(false);
            // Switching the brain while a chat is open starts a fresh chat with
            // it, since each conversation is bound to one driver.
            if (conv) void startWith(source);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
