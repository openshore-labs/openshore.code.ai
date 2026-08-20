// The chat screen: greeting when empty, streaming transcript when live,
// approvals as sheets, and the composer always within thumb's reach.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { sourceLabel, type ConversationSource } from '../state/types.js';
import { MessageList } from '../components/MessageList.js';
import { Composer } from '../components/Composer.js';
import { ApprovalSheet } from '../components/ApprovalSheet.js';
import { SourcePicker } from '../components/SourcePicker.js';
import { ProfileStatus } from '../components/ProfileStatus.js';
import { isPhone } from '../lib/platform.js';

export function ChatScreen({ compact }: { compact: boolean }) {
  const {
    activeId,
    conversations,
    send,
    abort,
    answerApproval,
    newConversation,
    startGuide,
    harborDownload,
    cancelHarbor,
    setDrawer,
  } = useApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingText, setPendingText] = useState<string | undefined>();

  const conv = activeId ? conversations[activeId] : undefined;
  const thread = conv?.thread;
  const approval = thread?.pendingApprovals[0];

  const startWith = async (source: ConversationSource) => {
    setPickerOpen(false);
    const id = await newConversation(source);
    if (pendingText) {
      const text = pendingText;
      setPendingText(undefined);
      useApp.getState().sendWhenAttached(id, text);
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
        <div className="topbar-title">
          {conv ? conv.title : 'OS Code'}
          <div className="topbar-sub">
            {conv
              ? thread?.model
                ? `${thread.model.name} · ${thread.model.kind}${thread.dollars > 0 ? ` · $${thread.dollars.toFixed(2)}` : ''}${thread.contextPercent ? ` · ctx ${thread.contextPercent}%` : ''}`
                : sourceLabel(conv.source)
              : 'Your machine. Your models. Your keys.'}
          </div>
        </div>
        <ProfileStatus />
      </header>

      {conv && thread && thread.items.length > 0 ? (
        <MessageList thread={thread} />
      ) : (
        <div className="greeting">
          <h1>What are we building?</h1>
          <p>
            Chat and build with your own stack of local models. Cloud stays one deliberate tap away,
            on your own account.
          </p>
          <div className="suggestion-row">
            <button className="suggestion" onClick={() => void startGuide()}>
              Ask Harbor
            </button>
            <button className="suggestion" onClick={() => setPickerOpen(true)}>
              Pick a model
            </button>
            {isPhone() ? (
              <button className="suggestion" onClick={() => useApp.getState().setView('pair')}>
                Connect my desktop
              </button>
            ) : null}
          </div>
          {harborDownload ? (
            <div style={{ maxWidth: 400, width: '100%', marginTop: 14 }}>
              {harborDownload.failed ? (
                <div className="hint" style={{ color: 'var(--danger)' }}>
                  {harborDownload.label} Tap Ask Harbor to retry.
                </div>
              ) : (
                <>
                  <div className="progress-track">
                    <div
                      className={`progress-fill${harborDownload.indeterminate ? ' indeterminate' : ''}`}
                      style={
                        harborDownload.indeterminate
                          ? undefined
                          : { width: `${harborDownload.percent}%` }
                      }
                    />
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>
                    Getting Harbor. {harborDownload.label}.
                  </div>
                  <button
                    className="btn quiet"
                    style={{ width: '100%', marginTop: 8 }}
                    onClick={() => cancelHarbor()}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      )}

      <Composer
        busy={Boolean(thread?.busy)}
        source={conv?.source}
        onSend={(text) => {
          if (!conv) {
            setPendingText(text);
            setPickerOpen(true);
            return;
          }
          send(text);
        }}
        onStop={abort}
        onPickSource={() => setPickerOpen(true)}
      />

      {approval ? (
        <ApprovalSheet
          request={approval}
          onAnswer={(approve, always) => answerApproval(approval.id, approve, always)}
        />
      ) : null}

      {pickerOpen ? (
        <SourcePicker
          onPick={(source) => void startWith(source)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
