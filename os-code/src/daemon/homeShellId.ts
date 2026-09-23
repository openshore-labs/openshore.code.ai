// The reserved scope for the plain shell: a terminal in the home folder that
// belongs to no coding session, so the Terminal room can open a shell before
// any repository is. Session ids are random UUIDs, so this can never collide
// with a real session. Pure (no Node built-ins) so the app can import it
// through 'os-code/protocol'.
export const HOME_SHELL_ID = 'home-shell';
