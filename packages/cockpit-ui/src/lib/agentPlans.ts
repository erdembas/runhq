import * as i18n from '../i18n/core';
import type { AgentItem } from '@runhq/cockpit-types';

export interface AgentPlanStep {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}
export interface AgentPlanDocument {
  id: string;
  title: string;
  body: string;
  steps: AgentPlanStep[];
}

function planSteps(value: unknown): AgentPlanStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AgentPlanStep[] => {
    if (!entry || typeof entry !== 'object') return [];
    const text = entry.step ?? entry.content ?? entry.text ?? entry.title;
    if (typeof text !== 'string' || !text.trim()) return [];
    return [
      {
        text,
        status: ['completed', 'done'].includes(entry.status)
          ? 'completed'
          : ['in_progress', 'running'].includes(entry.status)
            ? 'in_progress'
            : 'pending',
      },
    ];
  });
}

export function agentPlanDocument(item: AgentItem): AgentPlanDocument {
  let body = item.text;
  let steps: AgentPlanStep[] = [];
  try {
    const data: unknown = JSON.parse(item.text);
    if (Array.isArray(data)) {
      steps = planSteps(data);
      if (steps.length)
        body = steps
          .map((step) => `- [${step.status === 'completed' ? 'x' : ' '}] ${step.text}`)
          .join('\n');
    } else if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      steps = planSteps(record.entries ?? record.steps ?? record.plan);
      body =
        [
          typeof record.overview === 'string' ? record.overview : '',
          typeof record.plan === 'string' ? record.plan : '',
          steps
            .map((step) => `- [${step.status === 'completed' ? 'x' : ' '}] ${step.text}`)
            .join('\n'),
        ]
          .filter(Boolean)
          .join('\n\n') || item.text;
    }
  } catch {
    // Markdown plans are valid documents too; never discard unknown provider output.
  }
  if (!steps.length) {
    steps = [...body.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/gm)].map((match) => ({
      text: match[2] ?? '',
      status: match[1]?.toLowerCase() === 'x' ? 'completed' : 'pending',
    }));
  }
  return { id: item.id, title: item.title || i18n.t('Implementation plan'), body, steps };
}

export function collectAgentPlans(items: AgentItem[], planMode: boolean): AgentPlanDocument[] {
  const plans = items
    .filter((item) => item.kind === 'plan' && item.text.trim())
    .map(agentPlanDocument);
  for (const item of items) {
    if (
      item.kind !== 'user' ||
      !item.text.startsWith('Implement the following reviewed plan in this workspace.')
    )
      continue;
    const body = item.text.match(/<reviewed_plan>\n([\s\S]*)\n<\/reviewed_plan>$/)?.[1];
    if (body)
      plans.push(
        agentPlanDocument({
          ...item,
          id: `reviewed-${item.id}`,
          title: i18n.t('Reviewed implementation plan'),
          text: body,
        }),
      );
  }
  if (planMode) {
    const lastUser = items.map((item) => item.kind).lastIndexOf('user');
    const response = items
      .slice(lastUser + 1)
      .filter((item) => item.kind === 'assistant' && item.text.trim())
      .at(-1);
    if (response) plans.push(agentPlanDocument({ ...response, title: i18n.t('Plan response') }));
  }
  return plans;
}

export function buildAgentPlanPrompt(body: string): string {
  return `Implement the following reviewed plan in this workspace. Follow the project instructions, complete the implementation, and run appropriate verification. Report the resulting changes and any remaining limitations.\n\n<reviewed_plan>\n${body.trim()}\n</reviewed_plan>`;
}
