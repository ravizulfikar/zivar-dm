// The start-up splash: what it looks like and when it is shown. Pure (no Electron), so it is unit-tested.

/** Title of the splash page; tests can tell it from the real window by it. */
export const SPLASH_TITLE = 'ZIVAR Download Manager — starting';

/** The splash stays at least this long so the animation can be seen. */
export const SPLASH_MIN_MS = 1900;

/**
 * Shown on a normal start. Never when the app starts hidden into the tray (start at login), and not when
 * something drives the app for a test, unless ZIVAR_SPLASH=1 asks for it. ZIVAR_SPLASH=0 turns it off;
 * otherwise the "Show the splash screen" setting decides.
 */
export function shouldShowSplash(env, { hidden = false, automated = false, enabled = true } = {}) {
  if (env.ZIVAR_SPLASH === '0' || hidden) return false;
  if (env.ZIVAR_SPLASH === '1') return true;
  return enabled && !automated;
}

/** ZIVAR_SPLASH_MIN_MS lengthens (or shortens) the minimum time; tests use it to have time to look. */
export function splashMinMs(env) {
  const raw = env.ZIVAR_SPLASH_MIN_MS;
  const number = raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : SPLASH_MIN_MS;
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/**
 * One self-contained page: no scripts, no files, no network. The Z draws itself with one stroke, its arrowhead
 * follows, then a small packet keeps flowing down the diagonal and lands on the arrowhead with a ripple, like a
 * download arriving. The title, version and website rise in, and a bar slides while the app loads. When the app is
 * ready the main process adds the class "leave" to <body> for a short fade-out. People who prefer reduced motion
 * get the finished picture.
 */
export function splashHtml({ version, tagline, starting, website = 'zivar.my.id' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<title>${SPLASH_TITLE}</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none; cursor: default; }
  body { font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  .card {
    position: absolute; inset: 20px; border-radius: 26px; overflow: hidden;
    background: linear-gradient(150deg, #101a36 0%, #0b1226 55%, #0c1a30 100%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    animation: enter 0.45s ease-out both;
  }
  .glow {
    position: absolute; left: 50%; top: 34%; width: 400px; height: 400px; margin: -200px 0 0 -200px;
    background: radial-gradient(circle, rgba(25, 198, 180, 0.30), rgba(75, 80, 230, 0.12) 45%, rgba(75, 80, 230, 0) 68%);
    animation: breathe 4.2s ease-in-out infinite;
  }
  .logo { position: relative; width: 112px; height: 112px; filter: drop-shadow(0 10px 22px rgba(59, 111, 224, 0.45)); animation: logo-in 0.55s cubic-bezier(0.2, 0.9, 0.3, 1) both, float 3.6s ease-in-out 1.8s infinite; }
  .z { stroke-dasharray: 1; stroke-dashoffset: 1; opacity: 0; animation: draw 0.85s 0.4s cubic-bezier(0.65, 0, 0.35, 1) forwards; }
  .stem { stroke-dasharray: 1; stroke-dashoffset: 1; opacity: 0; animation: draw 0.35s 1.2s cubic-bezier(0.65, 0, 0.35, 1) forwards; }
  .ring { transform-box: fill-box; transform-origin: center; opacity: 0; fill: none; stroke: #ffffff; stroke-width: 12; animation: ripple 1.6s 1.7s ease-out infinite; }
  .packet { fill: #3b6fe0; }
  h1 { margin: 20px 0 0; font-size: 22px; font-weight: 650; letter-spacing: 0.03em; color: #eef3ff; animation: rise 0.6s 0.7s ease-out both; }
  .tag { margin: 6px 0 0; font-size: 11.5px; letter-spacing: 0.06em; color: #8fa3cc; animation: rise 0.6s 0.85s ease-out both; }
  .meta { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 11.5px; color: #8fa3cc; animation: rise 0.6s 1s ease-out both; }
  .chip { padding: 2px 10px; border-radius: 999px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #19c6b4, #4b50e6); }
  .site { color: #5fe0d0; letter-spacing: 0.02em; }
  .sep { opacity: 0.5; }
  .bar { width: 190px; height: 3px; margin-top: 18px; border-radius: 3px; overflow: hidden; background: rgba(255, 255, 255, 0.09); animation: rise 0.5s 1.1s ease-out both; }
  .bar i { display: block; width: 42%; height: 100%; border-radius: 3px; background: linear-gradient(90deg, rgba(25, 198, 180, 0), #19c6b4 45%, #7b8dff); animation: slide 1.35s ease-in-out infinite; }
  .state { margin-top: 8px; font-size: 11px; color: #6a7da6; animation: rise 0.5s 1.2s ease-out both; }
  .state::after { content: ''; animation: dots 1.4s steps(1, end) infinite; }
  body.leave .card { animation: leave 0.26s ease-in forwards; }

  @keyframes enter { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
  @keyframes leave { to { opacity: 0; transform: scale(0.965); } }
  @keyframes breathe { 0%, 100% { opacity: 0.65; transform: scale(1); } 50% { opacity: 1; transform: scale(1.09); } }
  @keyframes logo-in { from { opacity: 0; transform: scale(0.72) translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  @keyframes draw { 0% { stroke-dashoffset: 1; opacity: 0; } 3% { opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 1; } }
  @keyframes ripple { 0% { transform: scale(0.6); opacity: 0; } 12% { opacity: 0.9; } 70%, 100% { transform: scale(2.4); opacity: 0; } }
  @keyframes rise { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
  @keyframes slide { from { transform: translateX(-110%); } to { transform: translateX(260%); } }
  @keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
    .packet { display: none; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="glow"></div>
    <svg class="logo" viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="bg" x1="64" y1="0" x2="448" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#19c6b4" /><stop offset="1" stop-color="#3b3fd8" /></linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#bg)" />
      <g fill="none" stroke="#fff" stroke-width="48" stroke-linecap="round" stroke-linejoin="round">
        <path class="z" pathLength="1" d="M140 136H372L148 366H372" />
        <path class="stem" pathLength="1" d="M148 246V366" />
      </g>
      <circle class="ring" cx="148" cy="366" r="26" />
      <circle class="packet" cx="372" cy="136" r="15" opacity="0">
        <animateMotion path="M0 0L-224 230" dur="1.6s" begin="1.7s" repeatCount="indefinite" keyTimes="0;0.72;1" keyPoints="0;1;1" calcMode="linear" />
        <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.08;0.66;0.72;1" dur="1.6s" begin="1.7s" repeatCount="indefinite" />
      </circle>
    </svg>
    <h1>ZIVAR Download Manager</h1>
    <div class="tag">${escapeHtml(tagline)}</div>
    <div class="meta"><span class="chip">v${escapeHtml(version)}</span><span class="sep">·</span><span class="site">${escapeHtml(website)}</span></div>
    <div class="bar"><i></i></div>
    <div class="state">${escapeHtml(starting)}</div>
  </div>
</body>
</html>
`;
}
