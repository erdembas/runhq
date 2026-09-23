// Adapter-supplied metadata only: never infer consent from a title, command or tool output.
export function automaticApproval(config, request, approval) {
  if (
    config.read_only_review ||
    config.mode === 'plan' ||
    config.agent === 'plan' ||
    request.kind !== 'approval' ||
    !approval ||
    typeof approval.decision !== 'string' ||
    !approval.decision ||
    !['read', 'tool'].includes(approval.category)
  )
    return null;
  const policy = config.permission_policy;
  if (policy !== 'all' && !(policy === 'read' && approval.category === 'read')) return null;
  // Use only a one-time grant advertised by the adapter. Never install provider-side rules.
  if (!request.choices?.some((choice) => choice.value === approval.decision)) return null;
  return { decision: approval.decision };
}

export function openCodeApproval(permission) {
  return {
    category: ['read', 'glob', 'grep', 'list', 'external_directory'].includes(permission)
      ? 'read'
      : 'tool',
    decision: 'once',
  };
}

export function claudeApproval(name) {
  if (['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'].includes(name)) return null;
  return {
    category: ['Read', 'Glob', 'Grep', 'LS'].includes(name) ? 'read' : 'tool',
    decision: 'accept',
  };
}

export function acpApproval(params) {
  const option = params.options?.find((option) => option.kind === 'allow_once');
  if (!option) return null;
  return {
    category: params.toolCall?.kind === 'read' ? 'read' : 'tool',
    decision: option.optionId,
  };
}
