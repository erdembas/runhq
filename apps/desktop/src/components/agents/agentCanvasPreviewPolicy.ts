const POLICY_ATTRIBUTE = 'data-runhq-canvas-policy';

/** Narrow the host's bootstrap allowlist to the one static renderer for this app lifetime. */
export function agentCanvasFramePolicy(endpoint: string): string {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/canvas$/.test(
      url.pathname,
    ) ||
    url.href !== endpoint
  ) {
    throw new Error('Invalid canvas preview endpoint');
  }
  return `frame-src ${url.href}`;
}

export function installAgentCanvasFramePolicy(
  document: typeof window.document,
  endpoint: string,
): void {
  const policy = agentCanvasFramePolicy(endpoint);
  const existing = document.head.querySelector<InstanceType<typeof window.HTMLMetaElement>>(
    `meta[${POLICY_ATTRIBUTE}]`,
  );
  if (existing) {
    if (
      existing.content !== policy ||
      existing.httpEquiv.toLowerCase() !== 'content-security-policy'
    ) {
      throw new Error('Canvas preview origin changed. Reload the app to preview this canvas.');
    }
    return;
  }
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = policy;
  meta.setAttribute(POLICY_ATTRIBUTE, '');
  // Meta policies apply synchronously when inserted and intersect the app's existing policy.
  // Keep this policy for the document lifetime. Canvas is the only desktop iframe, and the
  // renderer endpoint is stable for the process lifetime. This also blocks frame navigation
  // into the privileged tauri origin or any other loopback service before a request is sent.
  document.head.appendChild(meta);
}
