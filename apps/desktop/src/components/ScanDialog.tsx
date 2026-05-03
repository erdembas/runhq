import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { ProjectCandidate } from '@/types';
import { ScanLoadingOverlay } from './scan-dialog/ScanLoadingOverlay';
import { ScanStepConfig } from './scan-dialog/ScanStepConfig';
import { ScanStepProjects } from './scan-dialog/ScanStepProjects';
import type { ProjectConfig, ScanStep } from './scan-dialog/types';

interface Props {
  path: string;
  onClose: () => void;
}

export function ScanDialog({ path, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<ProjectCandidate[]>([]);
  const [step, setStep] = useState<ScanStep>(1);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<Record<string, ProjectConfig>>({});
  const [addingCustom, setAddingCustom] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [customCmd, setCustomCmd] = useState('');
  const upsertService = useAppStore((s) => s.upsertService);
  const setSelected = useAppStore((s) => s.setSelected);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await ipc.scanDirectory(path);
        if (!alive) return;
        setCandidates(res);
      } catch (err) {
        console.error('scan failed', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  const toggleProject = (cwd: string) => {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else {
        next.add(cwd);
        if (!configs[cwd]) {
          setConfigs((prevConfigs) => ({
            ...prevConfigs,
            [cwd]: {
              selectedIndices: candidates.find((x) => x.cwd === cwd) ? [0] : [],
              customCmds: [],
              category: 'other',
            },
          }));
        }
      }
      return next;
    });
  };

  const toggleSuggestion = (cwd: string, idx: number) => {
    setConfigs((prev) => {
      const cfg = prev[cwd] ?? { selectedIndices: [], customCmds: [], category: 'other' };
      const current = cfg.selectedIndices;
      const next = current.includes(idx) ? current.filter((i) => i !== idx) : [...current, idx];
      return { ...prev, [cwd]: { ...cfg, selectedIndices: next } };
    });
  };

  const setCategory = (cwd: string, category: string) => {
    setConfigs((prev) => {
      const cfg = prev[cwd] ?? { selectedIndices: [], customCmds: [], category: 'other' };
      return { ...prev, [cwd]: { ...cfg, category } };
    });
  };

  const addCustomCmd = (cwd: string) => {
    const label = customLabel.trim();
    const cmd = customCmd.trim();
    if (!label || !cmd) return;
    setConfigs((prev) => {
      const cfg = prev[cwd] ?? { selectedIndices: [], customCmds: [], category: 'other' };
      return { ...prev, [cwd]: { ...cfg, customCmds: [...cfg.customCmds, { label, cmd }] } };
    });
    setCustomLabel('');
    setCustomCmd('');
    setAddingCustom(null);
  };

  const removeCustomCmd = (cwd: string, idx: number) => {
    setConfigs((prev) => {
      const cfg = prev[cwd] ?? { selectedIndices: [], customCmds: [], category: 'other' };
      return { ...prev, [cwd]: { ...cfg, customCmds: cfg.customCmds.filter((_, i) => i !== idx) } };
    });
  };

  const totalCommands = [...selectedProjects].reduce((sum, cwd) => {
    const cfg = configs[cwd];
    if (!cfg) return sum;
    return sum + cfg.selectedIndices.length + cfg.customCmds.length;
  }, 0);

  const importSelected = async () => {
    const tasks = [...selectedProjects].map(async (cwd) => {
      const candidate = candidates.find((c) => c.cwd === cwd);
      const cfg = configs[cwd];
      if (!candidate || !cfg) return;
      const effective = [
        ...candidate.suggestions,
        ...cfg.customCmds.map((cc) => ({ label: cc.label, cmd: cc.cmd })),
      ];
      const cmds = cfg.selectedIndices
        .map((i) => effective[i])
        .filter((s): s is NonNullable<typeof s> => s != null)
        .map((s) => ({ name: s.label, cmd: s.cmd }));
      const extraCmds = cfg.customCmds.map((cc) => ({ name: cc.label, cmd: cc.cmd }));
      const allCmds = [...cmds, ...extraCmds];
      if (allCmds.length === 0) return;
      const svc = await ipc.addService({
        name: candidate.name,
        cwd: candidate.cwd,
        cmds: allCmds,
        tags: [cfg.category],
      });
      upsertService(svc);
      setSelected(svc.id);
    });
    await Promise.allSettled(tasks);
    onClose();
  };

  if (loading) return <ScanLoadingOverlay path={path} onClose={onClose} />;

  return (
    <Dialog
      title={step === 1 ? 'Detected projects' : 'Configure imports'}
      subtitle={path}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <span className="text-fg-dim mr-auto text-[10px]">
            {step === 1
              ? `${selectedProjects.size} project${selectedProjects.size !== 1 ? 's' : ''} selected`
              : `${totalCommands} command${totalCommands !== 1 ? 's' : ''} across ${selectedProjects.size} project${selectedProjects.size !== 1 ? 's' : ''}`}
          </span>
          {step === 1 ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => setStep(2)}
                disabled={selectedProjects.size === 0}
              >
                Next
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => setStep(1)}
                leftIcon={<ArrowLeft className="h-3 w-3" />}
              >
                Back
              </Button>
              <Button
                variant="primary"
                onClick={importSelected}
                disabled={totalCommands === 0}
                rightIcon={<ArrowRight className="h-3 w-3" />}
              >
                Import
              </Button>
            </>
          )}
        </>
      }
    >
      {candidates.length === 0 ? (
        <div className="text-fg-dim py-6 text-center text-[11px]">
          Nothing runnable detected. Try a different folder or add a service manually.
        </div>
      ) : step === 1 ? (
        <ScanStepProjects
          candidates={candidates}
          selectedProjects={selectedProjects}
          onToggle={toggleProject}
        />
      ) : (
        <ScanStepConfig
          candidates={candidates}
          selectedProjects={selectedProjects}
          configs={configs}
          addingCustom={addingCustom}
          customLabel={customLabel}
          customCmd={customCmd}
          onToggleSuggestion={toggleSuggestion}
          onSetCategory={setCategory}
          onAddCustom={addCustomCmd}
          onRemoveCustom={removeCustomCmd}
          onSetAddingCustom={setAddingCustom}
          onSetCustomLabel={setCustomLabel}
          onSetCustomCmd={setCustomCmd}
        />
      )}
    </Dialog>
  );
}
