// The chat screen. Empty state mirrors the Claude app's opening: just the mark
// and a time-of-day greeting, with the model, effort, and everything else
// living in the composer. A live conversation swaps in the transcript and a
// header that names the chat.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { INIT_PROMPT } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { sourceSupportsVision, type ConversationSource } from '../state/types.js';
import { MessageList } from '../components/MessageList.js';
import { Composer, SLASH_COMMANDS, type SlashCommand } from '../components/Composer.js';
import { ApprovalSheet } from '../components/ApprovalSheet.js';
import { ModelSheet } from '../components/ModelSheet.js';
import { ModeSheet } from '../components/ModeSheet.js';
import { ProfileStatus } from '../components/ProfileStatus.js';
import { BrandMark } from '../components/BrandMark.js';
import { MenuIcon } from '../components/MenuIcon.js';
import { ROOM_NAMES } from '../components/BackBar.js';
import { RepoPicker } from '../components/RepoPicker.js';
import { TodoCard } from '../components/TodoCard.js';
import { MiniFirstMoves } from '../components/MiniFirstMoves.js';
import { Sheet } from '../components/Sheet.js';
import { HARBOR_MINI_MODEL_ID } from '../lib/harborMini.js';
import { buildRotation, type Greeting } from '../lib/greeting.js';
import { hapticTick } from '../lib/haptics.js';
import { isDesktop } from '../lib/platform.js';
import { DEFAULT_PERMISSION_MODE } from '../lib/permissionMode.js';
import { useOnline } from '../hooks/useOnline.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import type { Attachment } from '../lib/attachments.js';

/** The transcript's shape while a reopened desktop chat replays its journal:
 *  soft bars in the rhythm of the last known transcript (user turn, answer,
 *  tool), sized from the item count saved at the last persist, so the shape
 *  matches what is about to land and the screen never flashes the
 *  empty-state greeting on the way to a full history. */
function ResumeSkeleton({ count }: { count?: number }) {
  // Every four items is roughly one exchange; between one and four of them.
  const groups = Math.max(1, Math.min(4, Math.ceil((count ?? 4) / 4)));
  return (
    <div className="thread" aria-busy="true" aria-label="Loading the conversation">
      <div className="thread-inner">
        {Array.from({ length: groups }, (_, g) => (
          <div
            key={g}
            className="skel-group"
            style={{ animationDelay: `calc(${g} * var(--dur-2))` }}
          >
            <div className="skel skel-user" style={{ width: `${34 + ((g * 17) % 30)}%` }} />
            <div className="skel skel-line" />
            <div className="skel skel-line short" />
            {g % 2 === 0 ? <div className="skel skel-tool" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

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
    answerAllApprovals,
    newConversation,
    switchModel,
    setDrawer,
    setView,
    goBack,
    viewTrail,
    viewProjectId,
    sourceReady,
    showToast,
    retryLast,
    approvePlan,
    revisePlan,
    startNewChat,
    compactActive,
    renameConversation,
    activeIsAgent,
    resumingId,
    settings,
    unqueue,
    addNote,
    setConversationRepos,
  } = useApp();
  // The repositories a new chat will start with, picked in the header before
  // the first message (the Claude Code way): the active project's, until the
  // person changes them here. A live chat keeps its own list on the
  // conversation instead.
  const activeProjectId = settings.activeProjectId ?? settings.projects?.[0]?.id;
  const activeProject = settings.projects?.find((p) => p.id === activeProjectId);
  const [pendingRepoIds, setPendingRepoIds] = useState<string[]>(
    () => activeProject?.repoIds ?? [],
  );
  useEffect(() => {
    setPendingRepoIds(activeProject?.repoIds ?? []);
    // Only a project change reseeds; edits in the picker stand otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Which sub-sheet the model sheet opens on: 'root' from the composer pill,
  // 'local' from the out-of-usage "Switch to a local model" tap.
  const [sheetStage, setSheetStage] = useState<'root' | 'local'>('root');
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  // Bumped to pull focus into the composer (a plan's "Change something").
  const [focusSignal, setFocusSignal] = useState(0);
  const online = useOnline();
  const { mounted: offlineMounted, closing: offlineClosing } = useExitPresence(!online);
  // The brain a new chat will use, chosen from the composer. On the desktop app
  // it defaults to the engine on this machine (the model the founder set up
  // through Ollama or a cloud key), so a first message just works; the phone
  // defaults to the stack, which is what "My Stack" selects.
  const [selectedSource, setSelectedSource] = useState<ConversationSource>(() =>
    isDesktop() ? { kind: 'desktop' } : { kind: 'stack' },
  );
  // A first message typed before any brain can answer (no model downloaded, no
  // computer paired, no cloud key) is held here while the model sheet opens as a
  // chooser, then sent the instant a working brain is picked. This is what keeps
  // a first send from dead-ending on a fake reply or a raw load error.
  const [pending, setPending] = useState<{ text: string; attachments?: Attachment[] } | undefined>(
    undefined,
  );
  const booted = useBooted();
  const headerRef = useRef<HTMLElement>(null);
  useHeaderHeight(headerRef);

  const conv = activeId ? conversations[activeId] : undefined;
  const thread = conv?.thread;
  // The room this chat was opened from, when it is a sub-page (the Chats list,
  // or a project's detail room). Names the way-back button in the header; a
  // project uses its own name, so the button reads "‹ Uki Audio", not "‹ Project".
  const backView = viewTrail[viewTrail.length - 1];
  const backTo = !backView
    ? undefined
    : backView === 'project'
      ? (settings.projects?.find((p) => p.id === viewProjectId)?.name ?? ROOM_NAMES.project)
      : ROOM_NAMES[backView];
  const approval = thread?.pendingApprovals[0];
  const agent = Boolean(conv && conv.source.kind === 'desktop' && activeIsAgent());
  const mode = settings.permissionMode ?? DEFAULT_PERMISSION_MODE;
  const resuming = Boolean(conv && resumingId === conv.id && thread && thread.items.length === 0);
  const history = thread
    ? thread.items.filter((i) => i.kind === 'user').map((i) => (i.kind === 'user' ? i.text : ''))
    : [];

  const openRename = () => {
    if (!conv) return;
    setRenameDraft(conv.title === 'New chat' ? '' : conv.title);
    setRenameOpen(true);
  };

  const onCommand = (command: SlashCommand, arg: string) => {
    switch (command) {
      case 'help': {
        const cmds = SLASH_COMMANDS.filter((c) => agent || !c.agentOnly)
          .map((c) => `/${c.name}${c.arg ? ` <${c.arg}>` : ''}: ${c.hint.toLowerCase()}`)
          .join('\n');
        const text = `${cmds}\n@ mentions a repo file. # saves a line to the project's instructions. Esc stops a run or clears the field. Up recalls an earlier message. Shift+Tab cycles the permission mode. A message typed while the agent works is queued.`;
        if (conv) addNote(text);
        else showToast('Open a chat, then /help lists what the composer can do.');
        return;
      }
      case 'clear':
        startNewChat();
        return;
      case 'compact':
        void compactActive(arg || undefined);
        return;
      case 'model':
        setSheetStage('root');
        setSheetOpen(true);
        return;
      case 'cost': {
        if (!thread) {
          showToast('Nothing spent yet.');
          return;
        }
        const turn = thread.lastTurn
          ? ` Last turn: ${thread.lastTurn.promptTokens.toLocaleString()} in, ${thread.lastTurn.completionTokens.toLocaleString()} out.`
          : '';
        showToast(
          `$${thread.dollars.toFixed(2)} this chat. Context ${thread.contextPercent}% full.${turn}`,
        );
        return;
      }
      case 'mode':
        setModeSheetOpen(true);
        return;
      case 'init':
        if (!conv) {
          showToast('Open a desktop repo first.');
          return;
        }
        send(INIT_PROMPT);
        return;
      case 'rename':
        if (!conv) {
          showToast('Open a chat to name it.');
          return;
        }
        if (arg) void renameConversation(conv.id, arg);
        else openRename();
        return;
    }
  };

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

  // A second Easter egg on the same line: holding it down reveals the
  // language's English name in a small bubble, so the tap-through rotation
  // stays guessable without a label sitting there year-round. longPressFired
  // tracks whether the hold actually fired, so the pointerup's click doesn't
  // also rotate to the next language.
  const [langBubbleVisible, setLangBubbleVisible] = useState(false);
  const longPressFired = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const bubbleHideTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
      if (bubbleHideTimer.current !== null) window.clearTimeout(bubbleHideTimer.current);
    };
  }, []);
  const startLangPress = () => {
    longPressFired.current = false;
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      hapticTick();
      setLangBubbleVisible(true);
      if (bubbleHideTimer.current !== null) window.clearTimeout(bubbleHideTimer.current);
      bubbleHideTimer.current = window.setTimeout(() => setLangBubbleVisible(false), 1400);
    }, 450);
  };
  const endLangPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
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
    const id = await newConversation(source, { repoIds: pendingRepoIds });
    if (text || (attachments && attachments.length)) {
      useApp.getState().sendWhenAttached(id, text ?? '', attachments);
    }
  };

  return (
    <div className="shell-main">
      <header className="topbar" ref={headerRef}>
        {/* A chat opened from the Chats list is a sub-page of it, so the left
            slot is a way back to Chats (the iOS grammar), the same as the other
            rooms. A root chat (from the panel, or a fresh one) keeps the drawer
            menu. On the desktop the sidebar is beside the chat, so a root's slot
            stays empty. */}
        {backTo ? (
          <button
            className="icon-btn back-btn press-fb"
            onClick={() => {
              hapticTick();
              goBack();
            }}
            aria-label={`Back to ${backTo}`}
            title={`Back to ${backTo}`}
          >
            <span className="back-chevron" aria-hidden="true" />
            {!compact ? <span className="back-label">{backTo}</span> : null}
          </button>
        ) : compact ? (
          <button
            className="icon-btn menu-btn press-fb"
            onClick={() => {
              hapticTick();
              setDrawer(true);
            }}
            aria-label="Menu"
          >
            <MenuIcon />
          </button>
        ) : null}
        {conv ? (
          <div className="topbar-title">
            <button
              type="button"
              className="topbar-name press-fb"
              onClick={openRename}
              title="Rename this chat"
            >
              {conv.title}
            </button>
            <div className="topbar-sub">
              {/* The repo picker sits where the model name used to be (the
                  model still lives in the composer pill). A live session's
                  branch and dirty dot ride on the summary. */}
              <RepoPicker
                selected={conv.repoIds ?? []}
                onChange={(ids) => void setConversationRepos(conv.id, ids)}
                branch={thread?.repo?.branch}
                dirty={thread?.repo?.dirty}
                onOpenRepos={() => setView('repos')}
              />
              {thread && thread.dollars > 0 ? ` · $${thread.dollars.toFixed(2)}` : ''}
              {thread && thread.contextPercent > 0 ? (
                <span
                  className={`ctx-bar${thread.contextPercent >= 75 ? ' warm' : ''}${thread.contextPercent >= 90 ? ' hot' : ''}`}
                  title={`Context ${thread.contextPercent}% full`}
                  aria-label={`Context ${thread.contextPercent} percent full`}
                >
                  <i style={{ transform: `scaleX(${Math.min(1, thread.contextPercent / 100)})` }} />
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="topbar-spacer topbar-spacer-repos">
            <RepoPicker
              selected={pendingRepoIds}
              onChange={setPendingRepoIds}
              onOpenRepos={() => setView('repos')}
            />
          </div>
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

      {offlineMounted ? (
        <div className={`offline-banner${offlineClosing ? ' closing' : ''}`} role="status">
          Offline. Local models still answer; the desktop and cloud wait for a connection.
        </div>
      ) : null}

      <div className="chat-body">
        {conv && thread && thread.items.length > 0 ? (
          <MessageList
            thread={thread}
            onSwitchToLocal={() => {
              setSheetStage('local');
              setSheetOpen(true);
            }}
            onRetry={retryLast}
            onUnqueue={unqueue}
            onApprovePlan={approvePlan}
            onRevisePlan={() => {
              revisePlan();
              setFocusSignal((n) => n + 1);
            }}
          />
        ) : resuming ? (
          <ResumeSkeleton count={conv?.lastItemCount} />
        ) : (
          <div className="greeting">
            <BrandMark size={40} />
            <h1
              className="greeting-line press-fb"
              dir="auto"
              lang={greeting.code}
              role="button"
              tabIndex={0}
              aria-label={greeting.english}
              onClick={() => {
                if (longPressFired.current) {
                  longPressFired.current = false;
                  return;
                }
                rotate();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  rotate();
                }
              }}
              onPointerDown={startLangPress}
              onPointerUp={endLangPress}
              onPointerLeave={endLangPress}
              onPointerCancel={endLangPress}
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
              <span
                className={`greeting-lang-bubble${langBubbleVisible ? ' greeting-lang-bubble-visible' : ''}`}
                aria-hidden={!langBubbleVisible}
              >
                {greeting.lang}
              </span>
            </h1>
          </div>
        )}

        {/* First Moves: on a fresh Harbor Mini chat (just the seeded greeting, not
            yet busy), offer tappable openers so a new person is never staring at
            a blank box. They vanish the moment a first message is sent. */}
        {conv &&
        thread &&
        !thread.busy &&
        conv.source.kind === 'device' &&
        conv.source.modelId === HARBOR_MINI_MODEL_ID &&
        thread.items.length === 1 &&
        thread.items[0].kind === 'assistant' ? (
          <MiniFirstMoves onPick={(text) => send(text)} />
        ) : null}

        {thread && thread.todos.length > 0 && thread.items.length > 0 ? (
          <TodoCard todos={thread.todos} />
        ) : null}

        <Composer
          busy={Boolean(thread?.busy)}
          source={composerSource}
          visionSupported={sourceSupportsVision(composerSource)}
          autoFocus={isEmpty && booted}
          focusSignal={focusSignal}
          agent={agent}
          history={history}
          onCommand={onCommand}
          onOpenModelSheet={() => {
            setSheetStage('root');
            setSheetOpen(true);
          }}
          onOpenModeSheet={() => setModeSheetOpen(true)}
          onSend={(text, attachments) => {
            if (!conv) {
              // Never start a chat on a brain that cannot answer yet. Hold the
              // message and open the model sheet as a chooser (download a model,
              // connect your computer, or add a cloud key); the pick sends it.
              if (!sourceReady(selectedSource)) {
                setPending({ text, attachments });
                setSheetStage('root');
                setSheetOpen(true);
                showToast('Pick where your first answer comes from, then this sends.');
                return;
              }
              void startWith(selectedSource, text, attachments);
              return;
            }
            send(text, attachments);
          }}
          onStop={abort}
        />
      </div>

      {approval && thread ? (
        <ApprovalSheet
          request={approval}
          index={0}
          total={thread.pendingApprovals.length}
          agent={agent}
          mode={mode}
          onAnswer={(approve, always, inProject) =>
            answerApproval(approval.id, approve, always, { inProject })
          }
          onAnswerAll={answerAllApprovals}
          onOpenMode={() => setModeSheetOpen(true)}
        />
      ) : null}

      <Sheet open={renameOpen} onClose={() => setRenameOpen(false)} variant="confirm">
        <h3>Name this chat</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (conv && renameDraft.trim()) {
              hapticTick();
              void renameConversation(conv.id, renameDraft);
            }
            setRenameOpen(false);
          }}
        >
          <div className="field">
            <input
              autoFocus
              value={renameDraft}
              maxLength={80}
              placeholder="A short name"
              onChange={(e) => setRenameDraft(e.target.value)}
            />
          </div>
          <div className="confirm-row">
            <button type="button" className="btn ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!renameDraft.trim()}>
              Save
            </button>
          </div>
        </form>
      </Sheet>

      {sheetOpen ? (
        <ModelSheet
          initialStage={sheetStage}
          onPick={(source) => {
            setSelectedSource(source);
            setSheetOpen(false);
            // With a chat open, switch its model in place and carry the thread
            // (Claude-style). With none open, this just sets the brain the next
            // send will use.
            if (conv) {
              void switchModel(source);
              return;
            }
            // A held first message: send it now that a working brain is chosen.
            // If the pick still cannot answer (rare), keep holding, never
            // dead-end into a broken chat.
            if (pending) {
              if (sourceReady(source)) {
                const p = pending;
                setPending(undefined);
                void startWith(source, p.text, p.attachments);
              } else {
                showToast('That one is not ready yet. Finish setting it up, then send.');
              }
            }
          }}
          onClose={() => {
            setSheetOpen(false);
            // Leaving the chooser (dismiss, or a jump to a setup screen) drops
            // the held message so a later pick never sends stale text.
            setPending(undefined);
          }}
        />
      ) : null}

      {modeSheetOpen ? <ModeSheet onClose={() => setModeSheetOpen(false)} /> : null}
    </div>
  );
}
