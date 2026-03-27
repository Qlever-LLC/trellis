function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const BASE_STYLE = `
  :root {
    color-scheme: light;
    --bg: #f5f0e8;
    --surface: #fdfaf5;
    --surface-raised: #ffffff;
    --ink: #1c1917;
    --ink-muted: #78716c;
    --border: #e2d9cc;
    --accent: #0d9488;
    --accent-fg: #ffffff;
    --danger: #dc2626;
    --danger-soft: #fef2f2;
    --danger-border: #fecaca;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    background-color: var(--bg);
    color: var(--ink);
  }
  h1, h2, h3, p, ul { margin: 0; }
  .page {
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    gap: 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-muted);
    letter-spacing: 0.02em;
  }
  .brand-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .card {
    width: 100%;
    max-width: 420px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
    overflow: hidden;
  }
  .card-wide { max-width: 520px; }
  .card-header {
    padding: 24px 24px 0;
  }
  .card-body {
    padding: 20px 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .card-title { font-size: 18px; font-weight: 700; }
  .card-desc { font-size: 14px; color: var(--ink-muted); margin-top: 4px; }
  .divider {
    height: 1px;
    background: var(--border);
    margin: 0 -24px;
  }
  .btn {
    display: block;
    width: 100%;
    padding: 11px 18px;
    border-radius: 8px;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid transparent;
    transition: opacity 0.1s;
  }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: var(--accent); color: var(--accent-fg); }
  .btn-outline { background: var(--surface-raised); color: var(--ink); border-color: var(--border); }
  .btn-ghost { background: transparent; color: var(--ink-muted); border-color: transparent; font-weight: 500; }
  .actions { display: flex; flex-direction: column; gap: 8px; }
  .app-card {
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
  }
  .app-name { font-weight: 700; font-size: 16px; }
  .app-desc { font-size: 13px; color: var(--ink-muted); margin-top: 3px; }
  .section-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-muted);
    margin-bottom: 8px;
  }
  .cap-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cap-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
  }
  .cap-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .cap-dot-danger { background: var(--danger); }
  .alert {
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 13px;
  }
  .alert-danger {
    background: var(--danger-soft);
    border: 1px solid var(--danger-border);
    color: var(--danger);
  }
  @media (max-width: 480px) {
    .card-header { padding: 20px 20px 0; }
    .card-body { padding: 16px 20px 20px; }
    .divider { margin: 0 -20px; }
  }
`;

export function renderLoginPage(args: {
  instanceName: string;
  appName?: string;
  providers: Array<{ key: string; displayName: string }>;
  params: {
    redirectTo: string;
    sessionKey: string;
    sig: string;
    contract: string;
  };
}): string {
  const links = args.providers.map((provider) => {
    const params = new URLSearchParams({
      redirectTo: args.params.redirectTo,
      sessionKey: args.params.sessionKey,
      sig: args.params.sig,
      contract: args.params.contract,
    });
    const href = `/auth/login/${encodeURIComponent(provider.key)}?${params.toString()}`;
    return `<a class="btn btn-outline" href="${escapeHtml(href)}">Continue with ${escapeHtml(provider.displayName)}</a>`;
  }).join("");

  const desc = args.appName
    ? `Sign in to continue to <strong>${escapeHtml(args.appName)}</strong>`
    : `Sign in to continue`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in · Trellis Auth</title>
    <style>${BASE_STYLE}</style>
  </head>
  <body>
    <div class="page">
      <div class="brand">
        <span class="brand-dot"></span>
        ${escapeHtml(args.instanceName)}
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">Sign in</div>
          <div class="card-desc">${desc}</div>
        </div>
        <div class="card-body">
          <div class="actions">${links}</div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export function renderApprovalPage(args: {
  instanceName: string;
  authToken: string;
  redirectTo: string;
  status: "approval_required" | "approval_denied" | "insufficient_capabilities";
  approval: {
    displayName: string;
    description: string;
    kind: string;
    contractDigest: string;
    capabilities: string[];
  };
  user: { origin: string; id: string };
  missingCapabilities?: string[];
  userCapabilities?: string[];
}): string {
  const title = args.status === "approval_denied"
    ? "Access was previously denied"
    : args.status === "insufficient_capabilities"
    ? "Missing required permissions"
    : `Authorize ${escapeHtml(args.approval.displayName)}`;

  const copy = args.status === "approval_denied"
    ? "You previously denied this app. You can approve it now or continue to deny."
    : args.status === "insufficient_capabilities"
    ? "Your account doesn't have all of the permissions this app needs. Contact your administrator."
    : `<strong>${escapeHtml(args.approval.displayName)}</strong> is requesting permission to act on your behalf.`;

  const capItems = args.approval.capabilities.map(
    (cap) => `<li class="cap-item"><span class="cap-dot"></span>${escapeHtml(cap)}</li>`
  ).join("") || `<li class="cap-item"><span class="cap-dot"></span>No permissions requested</li>`;

  const missingItems = (args.missingCapabilities ?? []).map(
    (cap) => `<li class="cap-item"><span class="cap-dot cap-dot-danger"></span>${escapeHtml(cap)}</li>`
  ).join("");

  const missingSection = args.status === "insufficient_capabilities" && missingItems
    ? `<div>
        <div class="section-label">Permissions you're missing</div>
        <ul class="cap-list">${missingItems}</ul>
      </div>`
    : "";

  const actions = args.status === "insufficient_capabilities"
    ? `<a class="btn btn-ghost" href="${escapeHtml(args.redirectTo)}">Return to app</a>`
    : `<form method="post" action="/auth/approve" style="margin:0">
        <input type="hidden" name="authToken" value="${escapeHtml(args.authToken)}" />
        <input type="hidden" name="decision" value="approved" />
        <button class="btn btn-primary" type="submit">Approve and continue</button>
      </form>
      <form method="post" action="/auth/approve" style="margin:0">
        <input type="hidden" name="authToken" value="${escapeHtml(args.authToken)}" />
        <input type="hidden" name="decision" value="denied" />
        <button class="btn btn-outline" type="submit">Deny access</button>
      </form>
      <a class="btn btn-ghost" href="${escapeHtml(args.redirectTo)}">Return to app</a>`;

  const deniedAlert = args.status === "approval_denied"
    ? `<div class="alert alert-danger">This app was previously denied. Approving will grant it access again.</div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} · Trellis Auth</title>
    <style>${BASE_STYLE}</style>
  </head>
  <body>
    <div class="page">
      <div class="brand">
        <span class="brand-dot"></span>
        ${escapeHtml(args.instanceName)}
      </div>
      <div class="card card-wide">
        <div class="card-header">
          <div class="card-title">${escapeHtml(title)}</div>
          <div class="card-desc">${copy}</div>
        </div>
        <div class="card-body">
          ${deniedAlert}
          <div class="app-card">
            <div class="app-name">${escapeHtml(args.approval.displayName)}</div>
            ${args.approval.description ? `<div class="app-desc">${escapeHtml(args.approval.description)}</div>` : ""}
          </div>
          <div>
            <div class="section-label">Permissions requested</div>
            <ul class="cap-list">${capItems}</ul>
          </div>
          ${missingSection}
          <div class="divider"></div>
          <div class="actions">${actions}</div>
        </div>
      </div>
      <p style="font-size:12px;color:var(--ink-muted);text-align:center">
        Signed in as ${escapeHtml(args.user.origin)}:${escapeHtml(args.user.id)}
      </p>
    </div>
  </body>
</html>`;
}
