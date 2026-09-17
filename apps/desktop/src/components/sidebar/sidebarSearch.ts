import type { Section, ServiceDef, StackDef } from '@runhq/cockpit-types';

export function matchesWorkspaceSearch(query: string, ...parts: string[]): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = parts.join(' ').toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}
export function serviceSearchText(
  service: ServiceDef,
  sections: Section[],
  assigned?: string,
): string {
  return [
    service.name,
    service.cwd,
    ...service.tags,
    ...service.cmds.map((command) => command.cmd),
    sections.find((section) => section.id === assigned)?.name ?? '',
  ].join(' ');
}
export function stackMatchesSearch(
  stack: StackDef,
  query: string,
  services: ServiceDef[],
  sections: Section[],
  assigned?: string,
): boolean {
  return matchesWorkspaceSearch(
    query,
    stack.name,
    sections.find((section) => section.id === assigned)?.name ?? '',
    ...services
      .filter((service) => stack.service_ids.includes(service.id))
      .map((service) => serviceSearchText(service, [], undefined)),
  );
}
