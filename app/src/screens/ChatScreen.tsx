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
import { ModeSheet } from '../components/ModeSheet.js';
import { RepoPickerSheet } from '../components/RepoPickerSheet.js';
import { ProfileStatus } from '../components/ProfileStatus.js';
import { BrandMark } from '../components/BrandMark.js';
import { timeGreeting } from '../lib/greeting.js';
import { resolveChatRepoIds } from '../lib/availableRepos.js';
import type { Attachment } from '../lib/attachments.js';

export function ChatScreen({ compact }: { compact: boolean }) {
  const {
    activeId,
    conversations,
    settings,
    send,
    abort,
    answerApproval,
    newConversation,
    switchModel,
    setConversationRepos,
    openProjectDetail,
    setActiveProject,
    startNewChat,
    setDrawer,
  } = useApp();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [repoSheetOpen, setRepoSheetOpen] = useState(false);
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

  // Repositories for a saved, filed chat. It inherits the project's repos until
  // it sets its own; the chip in the header opens the picker to diverge or
  // reset. Quick chats and unfiled chats have no project to ride, so no chip.
  const project = conv?.projectId
    ? settings.projects?.find((p) => p.id === conv.projectId)
    : undefined;
  const chatRepoIds = resolveChatRepoIds(conv?.repoIds, project?.repoIds);
  const showRepoChip = Boolean(conv && !conv.ephemeral && project);
  const inheriting = conv?.repoIds === undefined;

  const toggleChatRepo = (id: string) => {
    if (!conv) return;
    const base = conv.repoIds ?? chatRepoIds;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    setConversationRepos(conv.id, next);
  };

  // The project this chat sits in, for the Claude-style header: an open chat
  // shows its own project; the greeting (no chat yet) shows the project the next
  // saved chat will land in. A quick chat belongs to no project, so no chip.
  const projects = settings.projects ?? [];
  const activeProjectId = settings.activeProjectId ?? projects[0]?.id;
  const headerProject = conv
    ? conv.ephemeral || !conv.projectId
      ? undefined
      : projects.find((p) => p.id === conv.projectId)
    : projects.find((p) => p.id === activeProjectId);
  const goProject = () => {
    if (headerProject) openProjectDetail(headerProject.id);
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
        {/* Left control on the phone: a back button when this chat lives in a
            project (it goes to the project, Claude-style), otherwise the menu. */}
        {compact ? (
          headerProject ? (
            <button className="icon-btn" onClick={goProject} aria-label="Back to project">
              {'‹'}
            </button>
          ) : (
            <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Menu">
              {'☰'}
            </button>
          )
        ) : null}
        {compact && headerProject ? (
          <>
            <button
              className="project-chip-top"
              onClick={goProject}
              aria-label={`Open ${headerProject.name}`}
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 18.5 19h-14A1.5 1.5 0 0 1 3 17.5Z" />
              </svg>
              <span>{headerProject.name}</span>
            </button>
            <div className="topbar-spacer" />
          </>
        ) : conv ? (
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
        {showRepoChip ? (
          <button
            className="repo-chip"
            onClick={() => setRepoSheetOpen(true)}
            aria-label="Chat repositories"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="7" cy="6" r="2.2" />
              <circle cx="7" cy="18" r="2.2" />
              <circle cx="17" cy="8" r="2.2" />
              <path d="M7 8.2v7.6" />
              <path d="M17 10.2v1.1a3.6 3.6 0 0 1-3.6 3.6H9.2" />
            </svg>
            <span>{chatRepoIds.length}</span>
            {inheriting ? null : <span className="repo-chip-own" aria-hidden="true" />}
          </button>
        ) : null}
        {compact && headerProject ? (
          <button
            className="icon-btn"
            onClick={() => {
              setActiveProject(headerProject.id);
              startNewChat();
            }}
            aria-label="New chat in this project"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.3-4.1A7.5 7.5 0 1 1 20 11.5Z" />
              <path d="M12 8.6v5.8M9.1 11.5h5.8" />
            </svg>
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
          <h1>{timeGreeting()}. What are we building?</h1>
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

      {repoSheetOpen && conv ? (
        <RepoPickerSheet
          title="Chat repositories"
          subtitle={
            inheriting
              ? 'This chat is following the project. Pick repos to give it its own set.'
              : 'This chat runs on its own repositories.'
          }
          selected={chatRepoIds}
          onToggle={toggleChatRepo}
          onUseProject={() => setConversationRepos(conv.id, undefined)}
          inheriting={inheriting}
          onClose={() => setRepoSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
