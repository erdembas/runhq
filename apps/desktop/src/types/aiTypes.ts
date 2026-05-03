// ---- AI providers --------------------------------------------------------

export type AiProviderKind = 'openai';

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  base_url: string;
  api_key: string;
  model: string;
  default: boolean;
  /** BCP-47-ish language code (`en`, `tr`, `auto`, …) the model should
   *  respond in. `null`/`undefined`/`auto` means "let the model
   *  decide". See `AI_LANGUAGE_OPTIONS` for the curated list. */
  response_language?: string | null;
  /** Per-provider override for AI-generated commit messages. Kept
   *  separate from {@link response_language} because the audiences
   *  diverge: chat replies are read by the user (their native tongue
   *  is fine), but commits enter the project history where the
   *  team convention often demands English regardless of the
   *  developer's UI preference.
   *
   *  Resolution:
   *    - `null`/`undefined`/empty/`inherit` → fall back to
   *      `response_language`
   *    - `auto` → opt out of any language directive on commits
   *      (the model decides; usually mirrors diff-comment language)
   *    - any other code → forced directive on commit surface only
   */
  commit_language?: string | null;
  /** Hard ceiling on streamed output tokens for this provider, in
   *  tokens. `null`/`undefined` means "no client-side cap" — RunHQ
   *  sends no `max_tokens` and lets the server apply its own
   *  model-aware default. Useful for users on long-context models
   *  (Gemini 1M, Claude 200K) who want big diff/history analyses,
   *  *and* for users on tiny local servers who want to clamp output
   *  to fit their model's window. */
  max_output_tokens?: number | null;
  /** Optional per-provider context window (input + output) in tokens.
   *  Drives the chat composer's TokenMeter — when set, the meter
   *  renders a `12.4k / 128k` gauge with traffic-light coloring as
   *  the user approaches the cap. `null`/`undefined` means we just
   *  show the raw count without a denominator. */
  context_window?: number | null;
  created_at_ms: number;
}

export interface AiProviderInput {
  id?: string | null;
  name: string;
  kind?: AiProviderKind;
  base_url: string;
  api_key: string;
  model: string;
  default: boolean;
  response_language?: string | null;
  commit_language?: string | null;
  max_output_tokens?: number | null;
  context_window?: number | null;
}

export interface AiTestResult {
  ok: boolean;
  latency_ms: number;
  model?: string | null;
  message?: string | null;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatOptions {
  temperature?: number | null;
  max_tokens?: number | null;
}

export interface ChatResponse {
  content: string;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface GenerateCommitResult {
  message: string;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  provider_id: string;
  provider_name: string;
}

/// One chunk of a streaming AI response.
///
/// Mirrors `runhq_core::ai::StreamChunk` (serde tag = "type"). Discriminate
/// on `type` and the rest of the fields are narrowed by the compiler.
export type StreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  /// Sent when the splitter sees `</think>` without ever seeing the
  /// matching `<think>` opener — proxy-stripped reasoning streams.
  /// The reducer concats `text` onto `reasoning` and resets `text`.
  | { type: 'reclassify_as_reasoning' }
  | {
      type: 'done';
      content: string;
      reasoning?: string | null;
      model?: string | null;
      prompt_tokens?: number | null;
      completion_tokens?: number | null;
      /// Why the model stopped generating, as reported by the
      /// provider. `"length"` means the answer was truncated by
      /// `max_tokens` / context cap and the UI should surface a
      /// "Response was cut off" banner with a Continue affordance.
      /// Other observed values: `"stop"`, `"content_filter"`,
      /// `null` (provider didn't report).
      finish_reason?: string | null;
    }
  | { type: 'error'; message: string };

/**
 * Where a chat conversation came from. Drives the icon shown in the
 * History drawer and the surface-specific suggestions in the composer.
 *
 * - `free`: user typed into the chat panel directly (no surface).
 * - `why`: ServiceCard "Why?" button on the dashboard.
 * - `log`: right-click on a log line in LogPanel.
 * - `diff`: "Explain" button on a diff hunk in DiffPane.
 * - `commit`: "Generate commit message" in CommitPanel.
 * - `standup`: "Polish for standup" in ActivityTimeline.
 * - `dashboard_report`: "Analyze workspace" button on the dashboard.
 * - `advisory`: "Ask AI" on the advisories panel.
 */
export type ConversationOrigin =
  | 'free'
  | 'why'
  | 'log'
  | 'diff'
  | 'commit'
  | 'standup'
  | 'dashboard_report'
  | 'advisory'
  | 'license';

export type ConversationMessageRole = 'user' | 'assistant';

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  /** Frontend-supplied stable id (the chat panel's `Turn.id`).
   *  Lets a "Continue" or "cancel after partial" loop upsert into
   *  the same row instead of fragmenting one turn into many bubbles
   *  on reload. May be null for legacy rows or messages persisted
   *  before this column existed. */
  client_id?: string | null;
  seq: number;
  role: ConversationMessageRole;
  content: string;
  reasoning?: string | null;
  provider_id?: string | null;
  provider_name?: string | null;
  model_name?: string | null;
  finish_reason?: string | null;
  partial: boolean;
  error?: string | null;
  created_at_ms: number;
}

export interface Conversation {
  id: string;
  title: string;
  origin: string;
  context_json?: string | null;
  pinned: boolean;
  /** User-curated star. Pin = always-on-top; favorite = "I want to
   *  find this again later". A conversation can be favorited without
   *  being pinned. */
  favorite: boolean;
  archived: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  messages: ConversationMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  origin: string;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  message_count: number;
  last_preview?: string | null;
}
