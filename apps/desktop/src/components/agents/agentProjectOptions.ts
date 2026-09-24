import type { AgentProject, Section, ServiceDef, StackDef } from '@runhq/cockpit-types';
import type { SearchableOption } from '@runhq/cockpit-ui';
import { sectionColor } from '@/lib/sectionColors';

const pathKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
export function agentProjectOptions(
  projects: AgentProject[],
  services: ServiceDef[],
  stacks: StackDef[],
  sections: Section[],
  serviceSection: Record<string, string>,
  stackSection: Record<string, string>,
): SearchableOption[] {
  const byPath = new Map<string, string>();
  for (const service of services) {
    const direct = serviceSection[service.id];
    const stack = stacks.find(
      (entry) => entry.service_ids.includes(service.id) && stackSection[entry.id],
    );
    const assigned = direct ?? (stack ? stackSection[stack.id] : undefined);
    if (
      assigned &&
      sections.some((section) => section.id === assigned) &&
      !byPath.has(pathKey(service.cwd))
    )
      byPath.set(pathKey(service.cwd), assigned);
  }
  const order = new Map(sections.map((section, index) => [section.id, index]));
  return projects
    .map((project) => {
      const group = sections.find(
        (section) =>
          section.id === (project.workspace?.section_id ?? byPath.get(pathKey(project.path))),
      );
      return {
        value: project.id,
        label: project.name,
        description: project.path,
        group: group?.name ?? 'Other projects',
        groupId: group?.id ?? '',
        color: group ? sectionColor(group.color).solid : undefined,
      };
    })
    .sort(
      (a, b) =>
        (order.get(a.groupId) ?? sections.length) - (order.get(b.groupId) ?? sections.length) ||
        a.label.localeCompare(b.label),
    );
}
