import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { agentSupportsImages } from '@runhq/cockpit-ui';
import type { AgentCapacityPreferences, agentOccupiedSlots } from './agentCapacity';

/**
 * Routing a task to one of several interchangeable accounts.
 *
 * Three signals are kept apart on purpose, because they answer different questions and none of them
 * can stand in for another:
 *
 * - **Capability fit** is declared and deterministic. An adapter either accepts images, steering or
 *   a built-in plan mode or it does not, so a step that needs one can only go to an account that
 *   has it. Nothing here is discovered at run time.
 * - **Load** is measured. RunHQ already counts execution slots per connection, so an account with a
 *   free slot is preferred over one that is at its configured limit.
 * - **Quota** is an event, never a forecast. These CLIs do not publish a remaining allowance, so the
 *   only reliable signal is a limit failure the provider actually returned. That starts a cool-down
 *   which is RunHQ's own backoff, and it is never presented as a reported reset or as a remaining
 *   allowance.
 *
 * Routing happens once, when a task starts. An account stays with its session for the session's
 * life, because provider-native resume belongs to the account that opened the conversation; taking
 * over after a limit means starting a new session through the A6 handoff, not switching identity
 * underneath a running conversation.
 */

export interface AgentAccountPool {
  id: string;
  name: string;
  /** Connection ids, in the order the user prefers them when no signal separates two accounts. */
  accounts: string[];
}

export const MAX_POOL_ACCOUNTS = 16;
/** RunHQ's own backoff after a reported limit. Not a reported reset and not a quota estimate. */
export const ACCOUNT_COOLDOWN_MS = 30 * 60_000;

const text = (value: unknown, field: string, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(i18n.t('A pool needs {field}', { field: field }));
  return value as string;
};

export function parseAccountPool(value: unknown): AgentAccountPool {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  if (!accounts.length) throw new Error(i18n.t('A pool needs at least one account'));
  if (accounts.length > MAX_POOL_ACCOUNTS)
    throw new Error(
      i18n.t('A pool holds up to {MAX_POOL_ACCOUNTS} accounts', {
        MAX_POOL_ACCOUNTS: MAX_POOL_ACCOUNTS,
      }),
    );
  const ids: string[] = [];
  for (const account of accounts) {
    if (typeof account !== 'string' || !account.trim() || account.length > 100)
      throw new Error(i18n.t('Invalid account in this pool'));
    // A duplicate would let one account win a tie twice and misreport how wide the pool is.
    if (!ids.includes(account)) ids.push(account);
  }
  return {
    id: text(raw.id, i18n.t('an id')),
    name: text(raw.name, i18n.t('a name')),
    accounts: ids,
  };
}

export interface AgentAccountCooldown {
  /** When the provider reported the limit. */
  since: number;
  /** When RunHQ will route here again. Its own backoff, never a reported reset. */
  until: number;
  /** The provider's own words, so the user can check the claim. */
  reason: string;
}
export type AgentAccountCooldowns = Record<string, AgentAccountCooldown>;

export function parseAccountCooldowns(value: unknown): AgentAccountCooldowns {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const cooldowns: AgentAccountCooldowns = {};
  for (const [id, raw] of Object.entries(source)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.since !== 'number' || typeof entry.until !== 'number') continue;
    if (!Number.isFinite(entry.since) || !Number.isFinite(entry.until)) continue;
    cooldowns[id] = {
      since: entry.since,
      until: entry.until,
      reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 400) : '',
    };
  }
  return cooldowns;
}

// Deliberately narrow. A cool-down withholds an account from routing, so it starts only on wording
// that names a rate or usage limit — never on an authentication, network or model error, and never
// on RunHQ's own messages about slots or queues.
const LIMIT_PATTERNS = [
  /\brate[ _-]?limit/i,
  /\busage limit\b/i,
  /\bquota\b/i,
  /\btoo many requests\b/i,
  /\b429\b/,
  /\blimit reached\b/i,
  /\blimit exceeded\b/i,
  /\bout of (?:credits?|tokens?)\b/i,
  /\binsufficient (?:quota|credits?)\b/i,
];

/**
 * The provider's limit failure, in its own words, or null when the failure was something else.
 * Only a message the provider returned may start a cool-down; RunHQ never infers one from token
 * counts, elapsed time or its own capacity rules.
 */
export function providerLimitReason(error: string | null | undefined): string | null {
  if (typeof error !== 'string') return null;
  const message = error.trim();
  if (!message) return null;
  return LIMIT_PATTERNS.some((pattern) => pattern.test(message)) ? message.slice(0, 400) : null;
}

export function startCooldown(
  cooldowns: AgentAccountCooldowns,
  accountId: string,
  reason: string,
  now: number,
): AgentAccountCooldowns {
  return {
    ...cooldowns,
    [accountId]: { since: now, until: now + ACCOUNT_COOLDOWN_MS, reason: reason.slice(0, 400) },
  };
}

export function activeCooldown(
  cooldowns: AgentAccountCooldowns,
  accountId: string,
  now: number,
): AgentAccountCooldown | null {
  const cooldown = cooldowns[accountId];
  return cooldown && cooldown.until > now ? cooldown : null;
}

/** Drop cool-downs that have run out, so a stored record cannot grow without bound. */
export function pruneCooldowns(cooldowns: AgentAccountCooldowns, now: number) {
  const kept = Object.entries(cooldowns).filter(([, cooldown]) => cooldown.until > now);
  return kept.length === Object.keys(cooldowns).length
    ? cooldowns
    : (Object.fromEntries(kept) as AgentAccountCooldowns);
}

export interface AgentAccountCandidate {
  id: string;
  name: string;
  adapter: string;
  enabled: boolean;
  available: boolean;
}

/** What a task needs before it can run at all. Declared by the task, matched against the adapter. */
export interface AgentAccountNeed {
  images?: boolean;
  plan?: boolean;
  steering?: boolean;
}

/**
 * Plan mode is built into these integrations. An ACP or terminal connection advertises its modes
 * only once it is running, so RunHQ cannot promise one before routing and will not guess.
 */
const DECLARED_PLAN_ADAPTERS = ['codex', 'claude', 'opencode'];

export function accountCapabilityGap(adapter: string, need: AgentAccountNeed): string | null {
  if (need.images && !agentSupportsImages(adapter))
    return i18n.t('does not accept image attachments');
  if (need.plan && !DECLARED_PLAN_ADAPTERS.includes(adapter))
    return i18n.t('has no declared plan mode');
  if (need.steering && adapter !== 'codex') return i18n.t('cannot steer a running turn');
  return null;
}

export type AgentRoutingSignal = 'availability' | 'capability' | 'quota' | 'load';

export interface AgentAccountRejection {
  id: string;
  name: string;
  signal: AgentRoutingSignal;
  reason: string;
}

export interface AgentAccountChoice {
  accountId: string | null;
  /** A sentence that stands on its own, for a schedule outcome or a failure message. */
  reason: string;
  /**
   * The same grounds as a short phrase, for somewhere the account and pool are already named.
   * Empty when nothing was compared.
   */
  grounds: string;
  /** Every account the pool held and what ruled it out, one signal each. */
  rejected: AgentAccountRejection[];
}

/**
 * Say why nothing could run, in the account's own terms. A pool of one is an ordinary connection,
 * so naming the pool there would invent a structure the user never made.
 */
function noAccountReason(pool: AgentAccountPool, rejected: AgentAccountRejection[]) {
  const describe = (entry: AgentAccountRejection) => `${entry.name} ${entry.reason}`;
  if (rejected.length === 1) return describe(rejected[0]!);
  const listed = rejected.slice(0, 3).map(describe).join('; ');
  const rest = rejected.length - 3;
  return i18n.t('No account in {value1} is free: {listed}{value3}', {
    value1: pool.name,
    listed: listed,
    value3: rest > 0 ? i18n.t('; and {rest} more', { rest: rest }) : '',
  });
}

/**
 * Pick the account a task should start on. Signals are applied in the order that decides the most
 * with the least guessing: an account that cannot do the work is out before one that is merely
 * busy, and a reported limit is respected before load is compared at all.
 */
export function chooseAgentAccount(input: {
  pool: AgentAccountPool;
  accounts: AgentAccountCandidate[];
  need?: AgentAccountNeed;
  cooldowns: AgentAccountCooldowns;
  capacity: AgentCapacityPreferences;
  occupied: ReturnType<typeof agentOccupiedSlots>;
  now: number;
}): AgentAccountChoice {
  const need = input.need ?? {};
  const rejected: AgentAccountRejection[] = [];
  const eligible: Array<{ candidate: AgentAccountCandidate; free: number }> = [];
  for (const id of input.pool.accounts) {
    const candidate = input.accounts.find((account) => account.id === id);
    if (!candidate) {
      rejected.push({
        id,
        name: id,
        signal: 'availability',
        reason: i18n.t('is no longer a connection in this workspace'),
      });
      continue;
    }
    const label = { id: candidate.id, name: candidate.name };
    if (!candidate.enabled) {
      rejected.push({ ...label, signal: 'availability', reason: i18n.t('is disabled') });
      continue;
    }
    if (!candidate.available) {
      rejected.push({
        ...label,
        signal: 'availability',
        reason: i18n.t('has no installed executable'),
      });
      continue;
    }
    const gap = accountCapabilityGap(candidate.adapter, need);
    if (gap) {
      rejected.push({ ...label, signal: 'capability', reason: gap });
      continue;
    }
    const cooldown = activeCooldown(input.cooldowns, candidate.id, input.now);
    if (cooldown) {
      rejected.push({
        ...label,
        signal: 'quota',
        reason: i18n.t('reported a limit and is on cool-down'),
      });
      continue;
    }
    const limit = input.capacity.providers[candidate.id] ?? 8;
    const free = limit - (input.occupied.providers[candidate.id] ?? 0);
    if (free <= 0) {
      rejected.push({ ...label, signal: 'load', reason: i18n.t('has no free execution slot') });
      continue;
    }
    eligible.push({ candidate, free });
  }
  if (!eligible.length)
    return {
      accountId: null,
      reason: noAccountReason(input.pool, rejected),
      grounds: '',
      rejected,
    };
  // A global limit is not a property of any one account, so it is reported after the per-account
  // signals: the pool is fine, the workspace as a whole is full.
  if (input.occupied.total >= input.capacity.global)
    return {
      accountId: null,
      reason: i18n.t('Waiting for a global execution slot'),
      grounds: '',
      rejected,
    };
  // Most free slots wins; the pool's own order breaks a tie so the choice is reproducible.
  let best = eligible[0]!;
  for (const entry of eligible) if (entry.free > best.free) best = entry;
  return {
    accountId: best.candidate.id,
    // A single connection was not chosen over anything, so claiming a comparison would be noise.
    reason:
      input.pool.accounts.length > 1
        ? i18n.t('{value1} had the most free slots in {value2}', {
            value1: best.candidate.name,
            value2: input.pool.name,
          })
        : '',
    grounds: input.pool.accounts.length > 1 ? i18n.t('had the most free slots') : '',
    rejected,
  };
}

export interface AgentLimitFailure {
  sessionId: string;
  accountId: string;
  reason: string;
  /** When the session reached this failure, so the same report is not counted twice. */
  at: number;
}

/**
 * The connections whose latest failure was a reported limit. Only a terminal failure counts: a
 * running turn has reported nothing yet, and a session that already failed for another cause is not
 * evidence about quota.
 */
export function reportedLimitFailures(
  sessions: Array<{
    id: string;
    backend: string;
    status: string;
    updated_at: number;
    last_error?: string | null;
  }>,
): AgentLimitFailure[] {
  const failures: AgentLimitFailure[] = [];
  for (const session of sessions) {
    if (session.status !== 'failed') continue;
    const reason = providerLimitReason(session.last_error);
    if (reason)
      failures.push({
        sessionId: session.id,
        accountId: session.backend,
        reason,
        at: session.updated_at,
      });
  }
  return failures;
}

/** A recipe or task targets a pool by id under this prefix; anything else names one connection. */
export const POOL_TARGET_PREFIX = 'pool:';
export const isPoolTarget = (target: string) => target.startsWith(POOL_TARGET_PREFIX);
export const poolTarget = (id: string) => `${POOL_TARGET_PREFIX}${id}`;

/**
 * The pool a target names. A plain connection resolves to a pool of one, so routing applies the
 * same signals and the same wording whether or not the user has grouped accounts.
 */
export function resolveAccountPool(
  target: string,
  pool: (id: string) => AgentAccountPool | null,
  accountName: (id: string) => string,
): AgentAccountPool | null {
  if (!target.trim()) return null;
  if (!isPoolTarget(target)) return { id: target, name: accountName(target), accounts: [target] };
  return pool(target.slice(POOL_TARGET_PREFIX.length));
}

/**
 * The account a handoff should start on after the source account reported a limit.
 *
 * Only that case is answered. A session keeps the account that opened it, so taking over means a
 * new session, and suggesting a different account for an ordinary handoff would override a choice
 * the user is about to make for their own reasons. Returns an empty string to leave the composer's
 * agent unset, exactly as before.
 */
export function handoffAccountAfterLimit(input: {
  sourceAccountId: string;
  pools: AgentAccountPool[];
  accounts: AgentAccountCandidate[];
  cooldowns: AgentAccountCooldowns;
  capacity: AgentCapacityPreferences;
  occupied: ReturnType<typeof agentOccupiedSlots>;
  now: number;
}): string {
  if (!activeCooldown(input.cooldowns, input.sourceAccountId, input.now)) return '';
  const pool = input.pools.find((entry) => entry.accounts.includes(input.sourceAccountId));
  if (!pool) return '';
  return (
    chooseAgentAccount({
      pool,
      accounts: input.accounts,
      cooldowns: input.cooldowns,
      capacity: input.capacity,
      occupied: input.occupied,
      now: input.now,
    }).accountId ?? ''
  );
}

/**
 * The connection a composer should open on for a target that may name a pool.
 *
 * The task composer works in connections: it discovers one account's models and modes, and a pool
 * advertises none of its own. Resolving here keeps the pool a property of the saved recipe while
 * the screen still shows the identity the task will actually run as. An empty string means the
 * person chooses, which is the right answer when no account in the pool can take the work — they
 * are present, unlike a scheduled run.
 */
export function composerAccountForTarget(input: {
  target: string;
  pool: (id: string) => AgentAccountPool | null;
  accounts: AgentAccountCandidate[];
  need?: AgentAccountNeed;
  cooldowns: AgentAccountCooldowns;
  capacity: AgentCapacityPreferences;
  occupied: ReturnType<typeof agentOccupiedSlots>;
  now: number;
}): string {
  if (!isPoolTarget(input.target)) return input.target;
  const pool = input.pool(input.target.slice(POOL_TARGET_PREFIX.length));
  if (!pool) return '';
  return (
    chooseAgentAccount({
      pool,
      accounts: input.accounts,
      need: input.need,
      cooldowns: input.cooldowns,
      capacity: input.capacity,
      occupied: input.occupied,
      now: input.now,
    }).accountId ?? ''
  );
}

/**
 * Why a task started on the account it did, kept beside the task it explains.
 *
 * Only written when RunHQ made the choice — a pool in the composer, a scheduled run, or a handoff
 * after a reported limit. Picking a connection by hand needs no explanation, and inventing one
 * would put RunHQ's words on the user's decision.
 */
export interface AgentRoutingNote {
  accountId: string;
  accountName: string;
  reason: string;
  /** The pool the account came from, when a pool was involved. */
  poolName?: string;
  at: number;
}

export function parseRoutingNote(value: unknown): AgentRoutingNote | null {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!raw) return null;
  const { accountId, accountName, reason, poolName, at } = raw;
  if (typeof accountId !== 'string' || !accountId) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  return {
    accountId,
    accountName: typeof accountName === 'string' && accountName ? accountName : accountId,
    reason: typeof reason === 'string' ? reason.slice(0, 400) : '',
    ...(typeof poolName === 'string' && poolName ? { poolName } : {}),
    at,
  };
}

/** One line a person can check: which account, out of which pool, and on what grounds. */
export function describeRoutingNote(note: AgentRoutingNote): string {
  const from = note.poolName ? i18n.t(' from {value1}', { value1: note.poolName }) : '';
  // The account and the pool are already named here, so the grounds stay a short clause rather
  // than a second sentence repeating both.
  return note.reason
    ? i18n.t('RunHQ chose {value1}{from}, which {value3}', {
        value1: note.accountName,
        from: from,
        value3: note.reason,
      })
    : i18n.t('RunHQ chose {value1}{from}', { value1: note.accountName, from: from });
}
