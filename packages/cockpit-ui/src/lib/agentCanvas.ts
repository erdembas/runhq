import type { AgentItem } from '@runhq/cockpit-types';

export type AgentCanvasKind = 'html' | 'svg' | 'markdown';

export interface AgentCanvasArtifact {
  id: string;
  itemId: string;
  kind: AgentCanvasKind;
  title: string;
  source: string;
}

const languages: Record<string, AgentCanvasKind> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  markdown: 'markdown',
  md: 'markdown',
};

function artifactTitle(kind: AgentCanvasKind, source: string, info: string, index: number) {
  const explicit = info.match(/\btitle=["']([^"']+)["']/)?.[1];
  const filename = info.match(/\b(?:file(?:name)?)=["']?([^\s"']+)/)?.[1];
  const heading = kind === 'markdown' ? source.match(/^#{1,3}\s+(.+)$/m)?.[1] : undefined;
  const title = source.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i)?.[1];
  return (explicit || filename || heading || title || `${kind.toUpperCase()} canvas ${index + 1}`)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

/** Only complete fenced assistant output becomes an artifact; streamed partial code stays in chat. */
export function extractAgentCanvasArtifacts(items: readonly AgentItem[]): AgentCanvasArtifact[] {
  const artifacts: AgentCanvasArtifact[] = [];
  for (const item of items) {
    if (item.kind !== 'assistant') continue;
    const lines = item.text.replace(/\r\n/g, '\n').split('\n');
    let fence: {
      marker: string;
      length: number;
      info: string;
      start: number;
      index: number;
    } | null = null;
    let blockIndex = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (!fence) {
        const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/);
        if (!opening || (opening[1]![0] === '`' && opening[2]!.includes('`'))) continue;
        fence = {
          marker: opening[1]![0]!,
          length: opening[1]!.length,
          info: opening[2]!.trim(),
          start: index + 1,
          index: blockIndex++,
        };
        continue;
      }
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)?.[1];
      if (!closing || closing[0] !== fence.marker || closing.length < fence.length) continue;
      const source = lines.slice(fence.start, index).join('\n');
      const language = fence.info.split(/\s/)[0]?.toLowerCase() ?? '';
      const kind =
        (Object.hasOwn(languages, language) ? languages[language] : undefined) ??
        (language === ''
          ? /^\s*<svg[\s>]/i.test(source)
            ? 'svg'
            : /^\s*(?:<!doctype\s+html\b|<html[\s>])/i.test(source)
              ? 'html'
              : undefined
          : undefined);
      if (kind && source.trim()) {
        artifacts.push({
          id: `${item.id}:${fence.index}`,
          itemId: item.id,
          kind,
          title: artifactTitle(kind, source, fence.info, artifacts.length),
          source,
        });
      }
      fence = null;
    }
  }
  return artifacts;
}

/** Encoding the tuple avoids collisions between session IDs and artifact IDs. */
export function agentCanvasStorageKey(sessionId: string, artifactId: string) {
  return `runhq:agent-canvas:v1:${JSON.stringify([sessionId, artifactId])}`;
}

export function readAgentCanvasEdit(raw: string | null, originalSource: string): string | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const edit = value as Record<string, unknown>;
    // A provider can revise a completed item. Never apply an old edit to new source silently.
    return edit.original === originalSource && typeof edit.source === 'string' ? edit.source : null;
  } catch {
    return null;
  }
}

export const AGENT_CANVAS_SANDBOX = 'allow-scripts';

// Combined with an opaque-origin iframe sandbox: inline interactivity is permitted,
// external dependencies, network APIs, child frames, forms and privileged host access are not.
// Sandbox blocks top navigation and popups; it cannot prevent script-driven self-navigation.
export const AGENT_CANVAS_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildAgentCanvasDocument(
  kind: Exclude<AgentCanvasKind, 'markdown'>,
  source: string,
) {
  // SVG is rendered as an image, so embedded SVG scripts and foreign HTML cannot execute.
  const body =
    kind === 'svg'
      ? `<style>html,body{margin:0;min-height:100%;background:#fff}body{display:grid;place-items:center;min-height:100vh}img{max-width:100%;max-height:100vh}</style><img alt="SVG canvas" src="${escapeAttribute(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`)}">`
      : source;
  // The policy is parsed before any artifact markup. Later policies can only further restrict it.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(AGENT_CANVAS_CSP)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light}body{margin:0;font-family:system-ui,sans-serif}</style></head><body>${body}</body></html>`;
}

export function agentCanvasDownloadName(artifact: Pick<AgentCanvasArtifact, 'title' | 'kind'>) {
  const stem =
    artifact.title
      .replace(/\.(html?|svg|md|markdown)$/i, '')
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'canvas';
  return `${stem}.${artifact.kind === 'markdown' ? 'md' : artifact.kind}`;
}
