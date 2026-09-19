import type { AgentQuestion } from '@runhq/cockpit-types';

type SelectedAnswers = Readonly<Record<string, readonly string[]>>;
type CustomAnswers = Readonly<Record<string, string>>;

/** Keep provider option values intact; custom text follows the request's selection mode. */
export function getAgentQuestionAnswers(
  question: AgentQuestion,
  selected: SelectedAnswers,
  custom: CustomAnswers,
): string[] {
  const choices = selected[question.id] ?? [];
  const text = question.allow_custom !== false ? custom[question.id]?.trim() : undefined;
  if (text) return question.multiple ? [...choices, text] : [text];
  return [...choices];
}

/** Collect the wire payload and completion state from the same effective answers. */
export function collectAgentRequestAnswers(
  questions: readonly AgentQuestion[],
  selected: SelectedAnswers,
  custom: CustomAnswers,
): {
  answers: Record<string, string[]>;
  missingQuestionIds: string[];
  answeredCount: number;
} {
  const entries = questions.map(
    (question) => [question.id, getAgentQuestionAnswers(question, selected, custom)] as const,
  );
  const missingQuestionIds = entries
    .filter(([, values]) => values.length === 0 || values.some((value) => !value.trim()))
    .map(([id]) => id);
  return {
    answers: Object.fromEntries(entries),
    missingQuestionIds,
    answeredCount: questions.length - missingQuestionIds.length,
  };
}
