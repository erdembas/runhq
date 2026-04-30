import { ipc } from '@/lib/ipc';

/**
 * Build the AI Chat "Project Q&A" context block for a service.
 *
 * Pulls the FULL notebook (every note for the service, concatenated
 * with H2 headers per note) via `read_all_notes` and wraps it in a
 * leading instruction so the model treats the user's notes as
 * authoritative project knowledge rather than generic web text.
 *
 * The Rust side already caps the concatenated body at ~8 KB and
 * adds a `[notes truncated…]` marker when it had to tail-trim, so
 * we don't need a second cap here — and re-trimming would risk
 * cutting in the middle of the truncation marker.
 */
export async function buildProjectNotesContext(serviceId: string): Promise<string | null> {
  const body = await ipc.readAllNotes(serviceId);
  if (!body.trim()) return null;

  return `## Project Notes\n\nThe following are the developer's own notes for this project. Treat them as authoritative context — they capture project-specific conventions, gotchas, and institutional knowledge. Each note is delimited by a \`## <title>\` header.\n\n${body}`;
}
