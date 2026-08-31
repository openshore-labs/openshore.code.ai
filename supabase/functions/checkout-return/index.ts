// The page Stripe sends the buyer to after a successful checkout. Its only job
// is to bounce back into OS Code over the oscode:// deep link so the app can
// re-read the entitlement and unlock, with an always-reachable manual fallback
// so a payer is never stranded on a blank page. It reads no secrets and writes
// nothing (the webhook is the sole entitlement writer); it is safe to serve
// without a JWT. Kept out of stripe-checkout on purpose: that function mints
// sessions and speaks JSON, this one serves HTML, and money-critical code should
// not drift between the two concerns.
//
// CTO ruling (fork 0.4): host the return page here, reuse the oscode:// scheme,
// and always offer a fallback link that works even with zero deep-link support.

// Where to send a buyer who cannot follow the deep link (no desktop protocol
// handler registered, an old build). Overridable, defaults to the product page.
const FALLBACK_URL =
  Deno.env.get('CHECKOUT_FALLBACK_URL') ?? 'https://openshore.ai/os-code/?checkout=success';

function page(): string {
  // The deep link the app registers (iOS and, once wired, desktop). Fired
  // immediately, then offered as a button after a short beat so a browser that
  // blocks the auto-redirect still has a one-tap way through.
  const deepLink = 'oscode://checkout-success';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment complete</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f6f4ef; color: #1c1b19;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) { body { background: #14130f; color: #ece9e2; } }
  .card { max-width: 26rem; padding: 2rem 1.5rem; text-align: center; }
  h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
  p { margin: 0 0 1.25rem; opacity: 0.85; }
  a.btn {
    display: inline-block; padding: 0.8rem 1.4rem; border-radius: 0.7rem;
    background: #1c1b19; color: #f6f4ef; text-decoration: none; font-weight: 600;
  }
  @media (prefers-color-scheme: dark) { a.btn { background: #ece9e2; color: #14130f; } }
  a.plain { display: inline-block; margin-top: 1rem; color: inherit; opacity: 0.7; font-size: 0.9rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>Payment complete</h1>
    <p>You are all set. Head back to OS Code and Personal will be unlocked.</p>
    <a class="btn" id="open" href="${deepLink}">Return to OS Code</a>
    <div><a class="plain" href="${FALLBACK_URL}">Or continue in your browser</a></div>
  </div>
  <script>
    // Fire the deep link right away; the button is the manual retry.
    try { window.location.href = ${JSON.stringify(deepLink)}; } catch (e) {}
  </script>
</body>
</html>`;
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'access-control-allow-origin': '*' } });
  }
  return new Response(page(), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
});
