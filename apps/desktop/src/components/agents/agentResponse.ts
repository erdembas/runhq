import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AgentItem } from '@runhq/cockpit-types';

type ResponseTone = 'allowed' | 'declined' | 'neutral';
type ResponseField = { label: string; values: string[] };
export interface AgentResponse {
  label: string;
  tone: ResponseTone;
  fields: ResponseField[];
}

const decisions: Record<string, Omit<AgentResponse, 'fields'>> = {
  accept: {
    get label() {
      return i18n.t('Allowed');
    },
    tone: 'allowed',
  },
  allow: {
    get label() {
      return i18n.t('Allowed');
    },
    tone: 'allowed',
  },
  once: {
    get label() {
      return i18n.t('Allowed once');
    },
    tone: 'allowed',
  },
  allow_once: {
    get label() {
      return i18n.t('Allowed once');
    },
    tone: 'allowed',
  },
  always: {
    get label() {
      return i18n.t('Always allowed');
    },
    tone: 'allowed',
  },
  allow_always: {
    get label() {
      return i18n.t('Always allowed');
    },
    tone: 'allowed',
  },
  acceptForSession: {
    get label() {
      return i18n.t('Allowed for this session');
    },
    tone: 'allowed',
  },
  accepted: {
    get label() {
      return i18n.t('Plan approved');
    },
    tone: 'allowed',
  },
  rejected: {
    get label() {
      return i18n.t('Plan rejected');
    },
    tone: 'declined',
  },
  decline: {
    get label() {
      return i18n.t('Declined');
    },
    tone: 'declined',
  },
  deny: {
    get label() {
      return i18n.t('Declined');
    },
    tone: 'declined',
  },
  reject: {
    get label() {
      return i18n.t('Declined');
    },
    tone: 'declined',
  },
  reject_once: {
    get label() {
      return i18n.t('Declined');
    },
    tone: 'declined',
  },
  reject_always: {
    get label() {
      return i18n.t('Always declined');
    },
    tone: 'declined',
  },
  cancel: {
    get label() {
      return i18n.t('Cancelled');
    },
    tone: 'neutral',
  },
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function readQuestions(request?: AgentItem): Record<string, unknown>[] {
  if (!request) return [];
  try {
    const value: unknown = JSON.parse(request.text);
    return Array.isArray(value) ? value.filter(record) : [];
  } catch {
    return [];
  }
}

function fieldLabel(id: string) {
  const text = id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Only interpret saved request replies; a user's JSON message is still their message. */
export function describeAgentResponse(item: AgentItem, request?: AgentItem): AgentResponse | null {
  if (item.kind !== 'user' || !item.id.startsWith('answer:') || item.status !== 'completed')
    return null;
  let value: unknown;
  try {
    value = JSON.parse(item.text);
  } catch {
    return null;
  }
  if (!record(value)) return null;
  if (value.permission_scope === 'workspace' && typeof value.decision === 'string')
    return { label: i18n.t('Allowed for this workspace'), tone: 'allowed', fields: [] };
  if (Object.hasOwn(value, 'decision')) {
    const decision =
      typeof value.decision === 'string' && Object.hasOwn(decisions, value.decision)
        ? decisions[value.decision]
        : undefined;
    // Providers may use opaque IDs or structured policy decisions. Do not guess their meaning.
    return { ...(decision ?? { label: i18n.t('Response recorded'), tone: 'neutral' }), fields: [] };
  }
  if (value.action === 'accept' || value.action === 'decline' || value.action === 'cancel') {
    return {
      label:
        value.action === 'accept'
          ? i18n.t('Response submitted')
          : value.action === 'decline'
            ? i18n.t('Declined')
            : i18n.t('Cancelled'),
      tone: value.action === 'decline' ? 'declined' : 'neutral',
      fields: [],
    };
  }
  if (!record(value.answers)) return null;
  const questions = readQuestions(request);
  const fields: ResponseField[] = [];
  for (const [id, answers] of Object.entries(value.answers)) {
    if (!Array.isArray(answers) || !answers.every((answer) => typeof answer === 'string'))
      return null;
    const question = questions.find((entry) => entry.id === id);
    const options = Array.isArray(question?.options) ? question.options.filter(record) : [];
    fields.push({
      label: typeof question?.question === 'string' ? question.question : fieldLabel(id),
      values: answers.map((answer: string) => {
        if (answer === '[redacted]') return i18n.t('Hidden answer');
        const option = options.find((entry) => entry.value === answer);
        return typeof option?.label === 'string' ? option.label : answer;
      }),
    });
  }
  return { label: i18n.t('Answered'), tone: 'neutral', fields };
}
