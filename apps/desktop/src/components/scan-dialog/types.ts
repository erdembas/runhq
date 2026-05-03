export interface CustomCmd {
  label: string;
  cmd: string;
}

export interface ProjectConfig {
  selectedIndices: number[];
  customCmds: CustomCmd[];
  category: string;
}

export type ScanStep = 1 | 2;
