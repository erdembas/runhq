import type { CommandEntry, DetectedEditor } from '@/types';

// Two-letter labels surfaced in the small square badge next to each editor
// row. Stay short — anything wider than 2 chars throws off the badge's
// fixed h-5/w-5 footprint and the row alignment drifts.
export const EDITOR_ICONS: Record<string, string> = {
  vscode: 'VS',
  cursor: 'Cu',
  windsurf: 'Ws',
  zed: 'Zd',
  sublime: 'St',
  webstorm: 'WJ',
  idea: 'IJ',
  rider: 'Rd',
  nvim: 'Nv',
};

export function editorBadgeLabel(editor: Pick<DetectedEditor, 'key' | 'command'>): string {
  return EDITOR_ICONS[editor.key] ?? (editor.command[0] ?? '?').toUpperCase();
}

// Same regex/heuristic as EditorDropdown — kept here so every surface that
// lists editors (dropdown, quick-action drill-in, future palettes) agrees on
// when Rider is relevant. Loose on the right of `dotnet ` so `dotnet run`,
// `dotnet watch`, `dotnet ef`, etc. all qualify, while avoiding `mydotnet-cli`.
const DOTNET_CMD_RE = /(^|[\s;&|])dotnet(\s|$)/;
const isDotnetProject = (cmds: ReadonlyArray<Pick<CommandEntry, 'cmd'>> | undefined): boolean =>
  !!cmds && cmds.some((c) => DOTNET_CMD_RE.test(c.cmd));

// Editors gated to specific runtime contexts. Rider is paid + .NET-centric,
// so showing it on Node-only services would be noise. Extend this map when
// we add more ecosystem-scoped editors (Android Studio for gradle, etc.).
const RUNTIME_SCOPED_EDITORS: Record<
  string,
  (cmds: ReadonlyArray<Pick<CommandEntry, 'cmd'>> | undefined) => boolean
> = {
  rider: isDotnetProject,
};

/**
 * Filter the detected-editor list down to the ones a given service should
 * surface. Pass the service's commands so runtime-scoped editors (Rider)
 * disappear on services that don't actually invoke the matching CLI; pass
 * `undefined` on surfaces not tied to a specific service to hide all
 * runtime-scoped editors entirely.
 */
export function visibleEditorsFor<E extends Pick<DetectedEditor, 'key'>>(
  editors: ReadonlyArray<E>,
  cmds: ReadonlyArray<Pick<CommandEntry, 'cmd'>> | undefined,
): E[] {
  return editors.filter((e) => {
    const gate = RUNTIME_SCOPED_EDITORS[e.key];
    return gate ? gate(cmds) : true;
  });
}
