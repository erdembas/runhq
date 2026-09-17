export interface AgentTaskTemplate {
  id: 'plan' | 'fix' | 'review' | 'canvas';
  title: string;
  description: string;
  prompt: string;
  mode: 'default' | 'plan';
}

export const AGENT_TASK_TEMPLATES: AgentTaskTemplate[] = [
  {
    id: 'plan',
    title: 'Plan a feature',
    description: 'Explore first. Build a clear plan.',
    prompt:
      'Help me plan a feature for this project. First inspect the architecture and existing patterns, then ask me which feature to focus on. Propose a concrete implementation plan with affected files, tradeoffs, and validation steps. Do not edit project files until I approve the plan.',
    mode: 'plan',
  },
  {
    id: 'fix',
    title: 'Fix a bug',
    description: 'Find the cause and verify the fix.',
    prompt:
      'Help me fix a bug in this project. Ask me for the observed behavior, expected behavior, and steps to reproduce if they are not already available. Inspect the relevant code, reproduce the problem, explain its root cause, and implement the smallest reliable fix. Run the relevant checks and summarize the result.',
    mode: 'default',
  },
  {
    id: 'review',
    title: 'Review changes',
    description: 'Catch regressions before they ship.',
    prompt:
      'Review the current uncommitted changes in this project for bugs, regressions, and missing validation. If there are no changes, ask which branch or commit to review. Prioritize actionable findings by severity and cite the affected files and lines. Explain the concrete failure scenario for each finding. Do not modify files during this review.',
    mode: 'plan',
  },
  {
    id: 'canvas',
    title: 'Create a canvas',
    description: 'Turn an idea into a live visual.',
    prompt:
      'Create an interactive visual canvas for this project. Inspect the project and ask what I want to visualize or prototype. Return the result as a complete, self-contained HTML document in a fenced html code block so RunHQ can preview it. Include inline CSS and JavaScript, accessible controls, and a responsive layout. Use no external scripts, network requests, or remote assets. Explain how to interact with it. Do not modify project files unless I ask.',
    mode: 'default',
  },
];
