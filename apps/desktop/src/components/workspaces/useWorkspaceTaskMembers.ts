import { useState } from 'react';
import type { AgentProject } from '@runhq/cockpit-types';
import { createAgentRecoveryPersistence } from '@/lib/agentRecoveryPersistence';

type Selections = Record<string, string[]>;
const persistence = createAgentRecoveryPersistence<Selections>(
  'runhq.workspace-task-projects.v1',
  (value): value is Selections =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
    ),
);

export function useWorkspaceTaskMembers(project: AgentProject | undefined) {
  const [loaded] = useState(() => persistence.load({}));
  const [selections, setSelections] = useState(loaded.data);
  const [error, setError] = useState(loaded.error);
  const available = project?.workspace?.members.map((member) => member.service_id) ?? [];
  const selected = project
    ? (selections[project.id] ?? available).filter((id) => available.includes(id))
    : [];
  const toggle = (id: string) => {
    if (!project || !available.includes(id)) return;
    const ids = selected.includes(id)
      ? selected.filter((entry) => entry !== id)
      : [...selected, id];
    const next = { ...selections, [project.id]: ids };
    setSelections(next);
    setError(persistence.save(next));
  };
  return { selected, toggle, error };
}
