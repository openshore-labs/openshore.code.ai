// Projects: the buckets that hold your work, in the shape of the Claude app's
// project list. One flat list sorted by recency, each row a small tile, the
// name, and a quiet line under it (what the project is for, else how many
// chats it holds, then when it last moved). On the phone, a round search
// button and the accent "New project" pill float at the foot of the room, as
// in the Claude iPhone app, and search turns the dock into one field. On the
// desktop (900 and wider), as in the Claude desktop app, New project is the
// bar's action and search is the Chats room's pill on top of the list, so
// neither sits a window's height under the list it serves (D11, maintainer
// 2026-10-07). New project opens a sheet with the name and what the project
// is for (its standing instructions). Tap a row to open the project's own
// room (chats, instructions, repos, and, for a company account, who on the
// team may read, write, or edit it); its name flies up into the room's title.
// The active project, where new chats are saved, carries the same inset
// accent edge as the active chat.
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../state/store.js';
import type { Project } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { Icon } from '../components/Icon.js';
import { RoomGlyph } from '../components/Sidebar.js';
import { PlusGlyph } from '../components/SheetGlyphs.js';
import { captureTitleHero } from '../lib/heroTitle.js';
import { useCompact } from '../hooks/useCompact.js';
import { SearchPill, relativeTime } from './ChatsScreen.js';

/** The quiet line under a project's name: what it is for when it says, else
 *  how many chats it holds, then when it last moved. Two halves, so a long
 *  "what" truncates and the "when" always shows. */
export function projectLine(
  p: Project,
  lastAt: string,
  chats: number,
): { what: string; when: string } {
  const about = p.instructions?.trim().split('\n')[0]?.trim();
  return {
    what:
      about ||
      (p.shared
        ? 'Shared with your team'
        : chats
          ? `${chats} ${chats === 1 ? 'chat' : 'chats'}`
          : 'No chats yet'),
    when: relativeTime(lastAt),
  };
}

export function ProjectsScreen() {
  const { settings, conversations, order, createProject, updateProject, openProject, showToast } =
    useApp();

  const projects = useMemo(() => settings.projects ?? [], [settings.projects]);
  const activeId = settings.activeProjectId ?? projects[0]?.id;

  // When each project last moved (its newest chat, else the day it was made),
  // and how many chats it holds.
  const { at: lastAt, count } = useMemo(() => {
    const at: Record<string, string> = {};
    const count: Record<string, number> = {};
    for (const p of projects) at[p.id] = p.createdAt;
    for (const id of order) {
      const c = conversations[id];
      const pid = c?.projectId;
      if (!pid || at[pid] === undefined) continue;
      count[pid] = (count[pid] ?? 0) + 1;
      if (c.updatedAt > at[pid]) at[pid] = c.updatedAt;
    }
    return { at, count };
  }, [projects, order, conversations]);

  const compact = useCompact();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  // A search typed on the desktop stays open in the dock if the window
  // narrows, so the list never reads as filtered by nothing.
  const docked = searching || query !== '';

  const rows = useMemo(() => {
    const sorted = [...projects].sort((a, b) =>
      (lastAt[b.id] ?? '').localeCompare(lastAt[a.id] ?? ''),
    );
    if (!q) return sorted;
    return sorted.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.instructions ?? '').toLowerCase().includes(q),
    );
  }, [projects, lastAt, q]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAbout, setNewAbout] = useState('');

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const id = await createProject(name);
    const about = newAbout.trim();
    if (about) await updateProject(id, { instructions: about });
    setCreating(false);
    setNewName('');
    setNewAbout('');
    showToast(`${name} is your active project.`);
    openProject(id);
  };

  const open = (p: Project, row?: HTMLElement | null) => {
    // Hand the tapped name to the detail room, so it flies up into the
    // room's large title (a shared-element move).
    captureTitleHero(row?.querySelector('.project-row-name') ?? null);
    openProject(p.id);
  };

  // Enter in the top pill opens the top match the way a tap on its row does,
  // so its name flies from the first row too.
  const openTopMatch = () => {
    const top = rows[0];
    if (top) open(top, listRef.current?.querySelector<HTMLElement>('.project-row'));
  };

  const openSearch = () => {
    setSearching(true);
    // Focus inside the tap, so the phone raises the keyboard.
    searchRef.current?.focus();
  };
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
    searchRef.current?.blur();
  };

  return (
    <div className="screen projects-screen">
      <BackBar
        title="Projects"
        action={
          compact ? undefined : (
            <button
              type="button"
              className="btn primary sm projects-bar-new"
              onClick={() => setCreating(true)}
            >
              <PlusGlyph size={16} />
              New project
            </button>
          )
        }
      />
      <div className="screen-inner projects">
        {!compact && projects.length ? (
          <SearchPill
            value={query}
            onChange={setQuery}
            label="Search projects"
            onEnter={rows[0] ? openTopMatch : undefined}
          />
        ) : null}
        {projects.length === 0 ? (
          <div className="projects-empty">
            <p className="projects-empty-title">No projects yet</p>
            <p className="projects-empty-sub">
              A project keeps related chats together. Its instructions go into every chat in it.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="projects-empty-sub projects-no-match">No project matches that.</p>
        ) : (
          <div className="project-list" ref={listRef}>
            {rows.map((p, i) => (
              <button
                type="button"
                key={p.id}
                className={`project-row press-fb press-fb--row${p.id === activeId ? ' active' : ''}`}
                style={{ '--i': Math.min(i, 8) } as CSSProperties}
                onClick={(e) => open(p, e.currentTarget)}
              >
                <span className="project-row-tile" aria-hidden="true">
                  <RoomGlyph name="projects" size={18} />
                </span>
                <span className="project-row-text">
                  <span className="project-row-name">{p.name}</span>
                  <span className="project-row-sub">
                    {p.id === activeId ? <span className="visually-hidden">Active. </span> : null}
                    <ProjectLine
                      line={projectLine(p, lastAt[p.id] ?? p.createdAt, count[p.id] ?? 0)}
                    />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {compact ? (
        <div className={`projects-dock${docked ? ' searching' : ''}`}>
          <div className="projects-dock-idle" aria-hidden={docked}>
            {projects.length ? (
              <button
                type="button"
                className="projects-dock-round press-fb"
                aria-label="Search projects"
                tabIndex={docked ? -1 : 0}
                onClick={openSearch}
              >
                <SearchIcon />
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="projects-dock-new press-fb"
              tabIndex={docked ? -1 : 0}
              onClick={() => setCreating(true)}
            >
              <PlusGlyph size={18} />
              New project
            </button>
          </div>
          <div className="projects-dock-search" aria-hidden={!docked}>
            <label className="projects-dock-field">
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="Search projects"
                aria-label="Search projects"
                tabIndex={docked ? 0 : -1}
                enterKeyHint="search"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeSearch();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="projects-dock-round press-fb"
              aria-label="Close search"
              tabIndex={docked ? 0 : -1}
              onClick={closeSearch}
            >
              <Icon size={16}>
                <path d="M6 6l12 12M18 6 6 18" />
              </Icon>
            </button>
          </div>
        </div>
      ) : null}

      <Sheet open={creating} onClose={() => setCreating(false)}>
        <SheetHead title="New project" onClose={() => setCreating(false)} />
        <form
          className="project-new"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="field">
            <label htmlFor="project-new-name">What are you working on?</label>
            <input
              id="project-new-name"
              autoFocus
              maxLength={80}
              placeholder="Name your project"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="project-new-about">What are you trying to achieve?</label>
            <textarea
              id="project-new-about"
              rows={3}
              placeholder="Describe your project, goals, subject, and so on. It rides into every chat here."
              value={newAbout}
              onChange={(e) => setNewAbout(e.target.value)}
            />
          </div>
          <div className="sheet-actions">
            <button type="submit" className="btn primary" disabled={!newName.trim()}>
              Create project
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}

function ProjectLine({ line }: { line: { what: string; when: string } }) {
  return (
    <>
      <span className="project-row-what">{line.what}</span>
      {line.when ? <span className="project-row-when">{` · ${line.when}`}</span> : null}
    </>
  );
}

function SearchIcon() {
  return (
    <Icon size={18}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}
