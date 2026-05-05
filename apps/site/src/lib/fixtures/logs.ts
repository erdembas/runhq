import type { LogLineFixture } from '@runhq/cockpit-ui';

/** Hero terminal mock — `acme-api` boot sequence with a satisfying
 *  "ready in 412ms" tail line. The composition is intentionally
 *  short (8 lines) so it fits in the hero stage without scroll. */
export const MOCK_LOG_HERO: LogLineFixture[] = [
  {
    kind: 'prompt',
    ts: '12:04',
    segments: [{ tone: 'dim', text: 'cargo run' }],
  },
  {
    kind: 'system',
    ts: '12:04',
    segments: [
      { text: '   Compiling ' },
      { tone: 'accent', text: 'acme-api' },
      { tone: 'dim', text: ' v0.4.2' },
    ],
  },
  {
    kind: 'system',
    ts: '12:04',
    segments: [
      { text: '    Finished ' },
      { tone: 'success', text: 'dev' },
      { tone: 'dim', text: ' [unoptimized] target(s) in 4.91s' },
    ],
  },
  {
    kind: 'stdout',
    ts: '12:04',
    segments: [
      { tone: 'success', text: '✓' },
      { text: ' database pool ready · ' },
      { tone: 'dim', text: '5 connections' },
    ],
  },
  {
    kind: 'stdout',
    ts: '12:04',
    segments: [
      { tone: 'success', text: '✓' },
      { text: ' migrations · ' },
      { tone: 'dim', text: '0 pending' },
    ],
  },
  {
    kind: 'stdout',
    ts: '12:04',
    segments: [{ tone: 'accent', text: '→' }, { text: ' http server listening on :8080' }],
  },
  {
    kind: 'system',
    ts: '12:04',
    segments: [
      { tone: 'success', text: 'ready' },
      { tone: 'dim', text: ' in 412ms' },
    ],
  },
];

/** "Triage" terminal mock — port collision crash. Drives the
 *  `Run` / `Triage` loop tab. */
export const MOCK_LOG_CRASH: LogLineFixture[] = [
  { kind: 'prompt', ts: '11:42', segments: [{ tone: 'dim', text: 'cargo run' }] },
  {
    kind: 'stdout',
    ts: '11:42',
    segments: [{ tone: 'accent', text: '→' }, { text: ' http server listening on :8080' }],
  },
  {
    kind: 'stderr',
    ts: '11:42',
    segments: [
      { tone: 'error', text: 'error' },
      { text: ': address already in use ' },
      { tone: 'dim', text: '(os error 48)' },
    ],
  },
  {
    kind: 'system',
    ts: '11:42',
    segments: [
      { tone: 'warn', text: 'RunHQ' },
      { text: ' detected another process on :8080 · ' },
      { tone: 'accent', text: 'pid 7421 (next-dev)' },
    ],
  },
  {
    kind: 'system',
    ts: '11:42',
    segments: [
      { tone: 'dim', text: '↳ click ' },
      { tone: 'accent', text: 'Kill :8080' },
      { tone: 'dim', text: ' to free the port and restart' },
    ],
  },
];
