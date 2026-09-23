// The door from Harbor Lite's first chat to the setup page. A new person opens
// straight into the guide's chat (founder, 2026-09-23), so the ways to go
// further (their computer, a repository, their own key, a bigger model) are
// one tap from the greeting instead of a wall in front of it. It sits under
// the seeded hello for the life of the chat, and rides press-fb like every
// tappable.
export function GuideSetupLink({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="guide-setup press-fb" onClick={onOpen}>
      <div className="grow">
        <strong>Set up OpenShore</strong>
        <span>Connect your computer, a repository, or your own key.</span>
      </div>
      <span className="chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
