import { useEffect, useMemo, useState } from 'react';
import type { ProjectDoc } from '@/types';
import { DocsNavModeToggle } from './DocsNavModeToggle';
import { SubNavButton } from './SubNavButton';
import { DocsTreeNav } from './DocsTreeNav';
import { buildDocsTree, collectFolderKeys } from './docsTreeModel';
import type { DocsNavMode } from './docsNavTypes';

interface DocsSubNavProps {
  docs: ProjectDoc[];
  activePath: string | null;
  onSelect: (path: string) => void;
}

export function DocsSubNav({ docs, activePath, onSelect }: DocsSubNavProps) {
  const [mode, setMode] = useState<DocsNavMode>(() => readModePref());
  const topLevel = docs.filter((d) => d.kind !== 'doc');
  const tree = docs.filter((d) => d.kind === 'doc');
  const treeNodes = useMemo(() => buildDocsTree(docs), [docs]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(collectFolderKeys(treeNodes)),
  );

  useEffect(() => {
    setExpanded((prev) => new Set([...prev, ...collectFolderKeys(treeNodes)]));
  }, [treeNodes]);

  const setNavMode = (next: DocsNavMode) => {
    setMode(next);
    writeModePref(next);
  };

  const toggleFolder = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <nav className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-fg-dim text-[10px] font-semibold tracking-wider uppercase">Docs</span>
        <DocsNavModeToggle mode={mode} onModeChange={setNavMode} />
      </div>
      {mode === 'tree' ? (
        <DocsTreeNav
          docs={docs}
          activePath={activePath}
          expanded={expanded}
          onToggleFolder={toggleFolder}
          onSelect={onSelect}
        />
      ) : (
        <div className="flex flex-col gap-0.5">
          {topLevel.map((d) => (
            <SubNavButton
              key={d.relative_path}
              doc={d}
              active={activePath === d.relative_path}
              onSelect={onSelect}
            />
          ))}
          {tree.length > 0 && (
            <>
              <div className="text-fg-dim mt-3 mb-1 px-2 text-[10px] font-semibold tracking-wider uppercase">
                Docs
              </div>
              {tree.map((d) => (
                <SubNavButton
                  key={d.relative_path}
                  doc={d}
                  active={activePath === d.relative_path}
                  onSelect={onSelect}
                />
              ))}
            </>
          )}
        </div>
      )}
    </nav>
  );
}

const MODE_KEY = 'runhq.docs.navMode';

function readModePref(): DocsNavMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'tree' ? 'tree' : 'flat';
  } catch {
    return 'flat';
  }
}

function writeModePref(mode: DocsNavMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
}
