// Tenet 9: anything a person must paste is a copy block, never a sentence in a
// toast. The engine now puts a command on its own paragraph after the message;
// this splits it out so the screen renders a card with a Copy control. The
// older inline form ("Install it first: curl ...") is still recognized, so an
// engine that predates the change never regresses to a toast.
const COMMAND_HEADS =
  /^(curl|ollama|sudo|brew|npm|npx|pnpm|sh|bash|winget|apt|apt-get|osc|tailscale)\b/;

export interface CommandDetail {
  message: string;
  command?: string;
}

function tidy(message: string): string {
  const m = message.trim().replace(/[:\s]+$/, '');
  return /[.!?]$/.test(m) ? m : `${m}.`;
}

export function splitCommandDetail(detail: string): CommandDetail {
  const text = detail.trim();
  // The structured form: the last paragraph is the command.
  const cut = text.lastIndexOf('\n\n');
  if (cut !== -1) {
    const tail = text.slice(cut + 2).trim();
    if (COMMAND_HEADS.test(tail) && !tail.includes('\n')) {
      return { message: text.slice(0, cut).trim(), command: tail };
    }
  }
  // The older inline form: "... first: curl -fsSL ... | sh".
  const inline = /^(.*?)(?::\s+)((?:curl|sudo|brew|winget)\b[^\n]*)$/.exec(text);
  if (inline && inline[1] && inline[2]) {
    return { message: tidy(inline[1]), command: inline[2].trim() };
  }
  return { message: text };
}
