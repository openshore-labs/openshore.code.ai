# New chat buttons: a proposal (Creative Studio, 2026-10-12)

Founder brief: more New chat buttons. One that overlays the left panel at the
bottom right when it opens, and others in convenient places so a new chat is
never more than a tap or two away.

Status (2026-10-12): the founder took it whole ("I agree with creative. Build").
Built: the drawer's floating button, the desktop sidebar's compose icon, the
shortcut and `/new`, and the tray and Dock item. The Chats empty state already
ended in Start a chat. Held: the Projects row swipe and the iOS Home Screen
quick action.

A plain chat now works like claude.ai (no repositories). A New chat button
therefore starts a plain chat, except inside a project, where it starts a
project chat.

## Today's cost

An open chat takes one tap (the compose icon in the bar). From anywhere else it
is three on the phone (menu, Chats, compose). A project chat is four (menu,
Projects, the project, New chat). The panel holds rooms only (Sidebar.tsx and
DECISIONS), so a floating button there is an action, not a room, and needs the
founder's yes.

## Do first

`startNewChat()` leaves the chat bound to the active project at the first send.
Make it plain: still filed for Recents if the founder wants that, but no repos.
Only `startProjectChat` makes a project chat.

## 1. The drawer's floating New chat (the ask)

- A child of the drawer, so it travels with the door. Right edge at the
  gutter, 12px above the top hairline of the sidebar foot, so it never covers
  Settings or the sign-in card. The foot's height is measured and published as
  a variable; the last recent row gets matching clearance.
- 52px circle, accent fill, `--elev-2`, the same compose glyph as the chat bar
  and Chats (one glyph always means New chat), labelled "New chat".
- Arrives with the drawer on the door clock (`--ease-glide`, `--dur-7`),
  stepped one beat after the last row; leaves with the door. Press physics from
  `press-fb`. No extra haptic: the global iOS click tick already fires.
- Tap: a plain chat, the drawer closes, the composer takes focus once the door
  has finished. On an empty new chat it only closes and focuses, so empty chats
  never stack. Always plain; the drawer is global.
- Desktop, where the sidebar is persistent: a compose icon at the right of the
  sidebar head with the shortcut in its tooltip. A bottom-right circle is wrong
  for a mouse.

## 2. Other places, ranked

1. **Keyboard shortcut.** Cmd/Ctrl+N in the desktop app, Cmd+Shift+O on the web
   (the browser owns Cmd+N). Plain chat, or a project chat when a project room
   is open. `/new` joins `/clear` in the composer menu. Zero navigation.
2. **Outside the app.** A New chat item in the tray menu and the macOS Dock
   menu now; an iOS Home Screen quick action later (needs a small plugin).
   From cold this saves three or more taps.
3. **Project row quick action.** Swipe right on a Projects row for a project
   chat. Saves two taps; discoverability is low, so it is a bonus.
4. **Chats empty state.** End the empty list in one "Start a chat" button.
   Fixes a dead end more than it saves taps.
5. **Chat bar on an empty chat: leave hidden.** There is nothing to leave.

The bar compose, the Chats bar and the project dock stay as they are.

## 3. Not recommended

A New chat row in the nav (turns an action into a room); a second floating
button in the chat or Chats (one primary per screen; collides with the jump
chip, composer and keyboard); a swipe from the right edge or pull-down (the
left edge is the drawer's); long-press to pick plain or project (a hidden mode;
where you are decides it); a wordmark tap; a button in the Recents header
beside the floating one.

## 4. Build order and guards

1. Plain `startNewChat` (store tests, the D7 chat directions test).
2. The drawer button and the foot-height variable (shell UI guards,
   polish-standards press and motion rules, `sidebarPlus` arrival test, and one
   new test: it wears `press-fb`, uses the compose glyph, is absent from the
   nav, uses no raw curves).
3. The desktop sidebar icon, the shortcut and `/new`.
4. Tray and Dock item (`electron/lifecycle.ts`).
5. Chats empty-state button.
6. Project row swipe, then the iOS quick action.

Chats is a v1 room, so no tier gate changes.
