import type { AgentCatalog } from '@runhq/cockpit-types';
import type { SearchableOption } from './selectSearch';

/** OpenCode labels are `provider · model`; preserve IDs verbatim for the runtime. */
export function agentModelOptions(
  models: AgentCatalog['models'],
  current: string,
): SearchableOption[] {
  const groups = new Map<string, SearchableOption[]>();
  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const separator = model.name.indexOf(' · ');
    const providerId = model.id.indexOf('/');
    const grouped = separator > 0 && providerId > 0;
    const group = grouped ? model.name.slice(0, separator) : '';
    const groupId = grouped ? model.id.slice(0, providerId) : '';
    const option: SearchableOption = {
      value: model.id,
      label: grouped ? model.name.slice(separator + 3) : model.name,
      description: [model.resolved_model || model.id, model.description]
        .filter(Boolean)
        .join(' · '),
      badge: model.is_alias ? 'Auto' : undefined,
      keywords: `${model.name} ${model.id}`,
      ...(grouped ? { group, groupId } : {}),
    };
    const entries = groups.get(groupId) ?? [];
    entries.push(option);
    groups.set(groupId, entries);
  }
  const options: SearchableOption[] = [
    { value: '', label: 'Default model', description: 'Use your agent configuration' },
  ];
  if (current && !seen.has(current))
    options.push({
      value: current,
      label: current,
      description:
        models.find((model) => model.resolved_model === current)?.description ||
        'Current model · Availability is checked by your provider',
      badge: models.some((model) => model.resolved_model === current) ? 'Version' : 'Custom ID',
    });
  for (const entries of groups.values()) options.push(...entries);
  // Only offer a pinned version when the provider explicitly reports its wire ID.
  for (const model of models) {
    const resolved = model.resolved_model;
    if (!resolved || resolved === model.id || seen.has(resolved) || resolved === current) continue;
    seen.add(resolved);
    options.push({
      value: resolved,
      label: resolved,
      badge: 'Version',
      description: model.description || model.name,
      group: 'Exact versions',
      groupId: 'resolved-versions',
    });
  }
  return options;
}

export function customModelOption(value: string): SearchableOption | null {
  const id = value.trim();
  if (!id || /\s/.test(id)) return null;
  return {
    value: id,
    label: `Use ${id}`,
    badge: 'Custom ID',
    description: 'Use this exact ID · Availability is checked by your provider',
  };
}

export function agentModelEfforts(models: AgentCatalog['models'], current: string): string[] {
  return (
    (
      models.find((model) => model.id === current) ??
      models.find((model) => model.resolved_model === current)
    )?.efforts ?? []
  );
}
