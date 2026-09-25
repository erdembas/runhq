import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { pipelineMessage } from './pipelineMessages';
export function workflowExecutionError(value: string): string {
  if (/(?:^|: )pipeline\./.test(value)) return pipelineMessage(value);
  const code = value.match(/(?:^|: )(workflow\.[a-z_]+)$/)?.[1] ?? value;
  switch (code) {
    case 'workflow.invalid_execution':
      return i18n.t('Invalid workflow execution settings.');
    case 'workflow.invalid_regex':
      return i18n.t(
        'A result pattern is invalid. Use a regular expression without lookaround or backreferences.',
      );
    case 'workflow.invalid_condition':
      return i18n.t('The result condition is invalid.');
    case 'workflow.condition_dependency':
      return i18n.t('Conditions must refer to earlier dependencies.');
    case 'workflow.conditional_review':
      return i18n.t('An independent review cannot be conditional.');
    case 'workflow.invalid_shell':
      return i18n.t('A terminal step needs a command and the shared working copy.');
    case 'workflow.invalid_directory':
      return i18n.t('Choose an existing relative subfolder inside the working copy.');
    case 'workflow.resource_busy':
      return i18n.t('Another step holds this resource lock.');
    case 'workflow.result_rejected':
      return i18n.t(
        'The final result is missing, ambiguous, or reports a failure. Inspect the output before retrying.',
      );
    case 'workflow.timed_out':
      return i18n.t('The step exceeded its time limit. Inspect partial changes before retrying.');
    case 'workflow.stalled':
      return i18n.t('The step exceeded its inactivity limit. Inspect its output before retrying.');
    case 'workflow.cancelled':
      return i18n.t('The step was stopped. Inspect partial changes before retrying.');
    case 'workflow.command_failed':
      return i18n.t('The command failed. Inspect its output and exit code.');
    case 'workflow.recovered':
      return i18n.t(
        'RunHQ closed during this step. Nothing was replayed. Inspect the working copy and retry when ready.',
      );
    case 'workflow.import_too_large':
      return i18n.t('The recipe bundle exceeds 16 MiB or a prompt exceeds 128 KiB.');
    case 'workflow.import_encoding':
      return i18n.t('Recipe and prompt files must use UTF-8.');
    case 'workflow.invalid_import':
      return i18n.t('Choose a workflow JSON file or a JSON/ZIP package.');
    case 'workflow.run_limit':
      return i18n.t(
        'This step reached its run limit. Inspect the result before allowing another run.',
      );
    case 'workflow.stale_approval':
    case 'workflow.stale_decision':
      return i18n.t('An approval is no longer current. Refresh the workflow before deciding.');
    case 'workflow.approval_rejected':
      return i18n.t('The approval was rejected.');
    case 'workflow.pass_required':
      return i18n.t('This workflow requires a PASS verdict from its dependencies.');
    case 'workflow.invalid_context':
      return i18n.t('Check the workflow workspace and captured package paths.');
    case 'workflow.preflight_failed':
      return i18n.t('Resolve the imported workspace issues before starting.');
    case 'workflow.branch_changed':
      return i18n.t('A repository is on a different branch. Review the workspace settings.');
    case 'workflow.dirty_workspace':
      return i18n.t('A repository has uncommitted changes. Commit or stash them before starting.');
    case 'workflow.workspace_changed':
      return i18n.t('The workspace repositories changed. Review their paths before starting.');
    case 'workflow.direct_no_integration':
      return i18n.t('This workflow already works in the selected repositories.');
    case 'workflow.invalid_prompt_file':
      return i18n.t('Prompt files must be inside the selected recipe’s folder.');
    default:
      return value;
  }
}
