// osc pair: put OS Code on your phone. A first-run wizard that detects
// Tailscale, walks the install warmly when it is missing, checks the SSH
// door, warns about desktop sleep, and hands the phone everything it needs,
// QR included. OS Code orchestrates; it embeds neither Tailscale nor SSH.
import qrcode from 'qrcode-terminal';
import { banner, t, GLYPHS } from '../brand/theme.js';
import { buildPairPlan } from '../connect/pair.js';
import { header, okLine, out, warnLine } from './util.js';

export async function pairCommand(): Promise<void> {
  out(banner('osc pair'));
  out();
  out(
    t.text(
      'Five short steps and your phone drives this machine from anywhere, over your own private network.',
    ),
  );

  const plan = buildPairPlan();

  plan.steps.forEach((step, i) => {
    header(`${i + 1}. ${step.title}`);
    if (step.done) okLine(step.detail);
    else {
      out(`  ${t.text(step.detail)}`);
      if (step.command) out(`  ${t.local(step.command)}`);
    }
  });

  if (plan.sshTarget) {
    header('Scan with the phone (or type it into Termius)');
    out(t.text(`  ssh ${plan.sshTarget}`));
    out();
    qrcode.generate(`ssh://${plan.sshTarget}`, { small: true }, (code) => {
      out(
        code
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
      );
    });
    out(
      t.muted(
        `  Once connected: ${t.local('osc attach')} resumes your latest session, live, mid-stream.`,
      ),
    );
  } else {
    warnLine('The connection details appear here as soon as Tailscale is up on this machine.');
  }

  header('Good to know');
  out(
    `  ${GLYPHS.bullet} ${t.text('The daemon owns the run. If the phone drops signal in a tunnel, nothing is lost; reattach and the transcript catches up.')}`,
  );
  out(
    `  ${GLYPHS.bullet} ${t.text('Phone sessions are stricter than desk sessions: shell commands always ask, cloud spend always asks.')}`,
  );
  out(
    `  ${GLYPHS.bullet} ${t.text('The daemon token lives at ~/.os-code/daemon.token, mode 600, and never travels anywhere.')}`,
  );
}
