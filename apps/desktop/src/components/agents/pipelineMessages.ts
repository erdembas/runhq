import * as i18n from '@runhq/cockpit-ui/i18n/core';
export function pipelineMessage(error: string): string {
  const code = error.match(/pipeline\.[a-z_]+/)?.[0];
  switch (code) {
    case 'pipeline.invalid_manifest':
      return i18n.t('The pipeline package or its schema is invalid.');
    case 'pipeline.package_limit':
      return i18n.t('The package exceeds the supported size or file count.');
    case 'pipeline.invalid_path':
      return i18n.t('The package contains an unsafe or unsupported file path.');
    case 'pipeline.invalid_archive':
      return i18n.t('The package archive could not be read.');
    case 'pipeline.missing_file':
      return i18n.t('A referenced prompt or asset is missing.');
    case 'pipeline.workspace_missing':
      return i18n.t('The workspace folder is missing.');
    case 'pipeline.repositories_explicit':
      return i18n.t(
        'List the target repositories explicitly in settings.repositories before starting.',
      );
    case 'pipeline.repositories_missing':
      return i18n.t('Choose between one and sixteen Git repositories in the package settings.');
    case 'pipeline.external_assets':
      return i18n.t(
        'This prompt refers to another copy of a package file. Use RUNHQ_PACKAGE_ROOT instead of an absolute path.',
      );
    case 'pipeline.review_contract':
      return i18n.t(
        'RunHQ creates read-only review snapshots and saves reports. Review prompts must not create worktrees or write state files.',
      );
    case 'pipeline.stale_action':
      return i18n.t('An approval or step changed. Refresh and try again.');
    case 'pipeline.preflight_failed':
      return i18n.t('Resolve package issues before starting.');
    case 'pipeline.workspace_changed':
      return i18n.t('A repository moved or no longer matches the workspace.');
    case 'pipeline.branch_changed':
      return i18n.t(
        'A repository branch changed since import. Import the package again to review the new target.',
      );
    case 'pipeline.dirty_workspace':
      return i18n.t(
        'The repositories contain uncommitted changes. Preserve or resolve them before starting.',
      );
    case 'pipeline.reviewer_required':
      return i18n.t('Independent review requires a Codex or Claude connection.');
    case 'pipeline.retry_required':
      return i18n.t('Retry the failed step before resuming.');
    case 'pipeline.wait_running':
      return i18n.t('Wait for running steps to finish before retrying.');
    case 'pipeline.review_limit':
      return i18n.t('The automatic review limit was reached.');
    case 'pipeline.pass_required':
      return i18n.t('This gate requires a PASS verdict.');
    case 'pipeline.result_rejected':
      return i18n.t('The result is missing, ambiguous, or reports a failure.');
    case 'pipeline.command_failed':
      return i18n.t('The terminal command failed.');
    case 'pipeline.agent_failed':
      return i18n.t('The agent did not complete successfully.');
    case 'pipeline.timed_out':
      return i18n.t('The step exceeded its time limit.');
    case 'pipeline.recovered':
      return i18n.t('RunHQ restarted during this step. Inspect its changes before retrying.');
    case 'pipeline.snapshot_missing':
      return i18n.t('A captured repository revision is missing.');
    case 'pipeline.managed_session':
      return i18n.t(
        'This conversation is controlled by its pipeline. Retry it from Pipeline packages.',
      );
    case 'pipeline.invalid_settings':
    case 'pipeline.invalid_condition':
    case 'pipeline.invalid_step':
    case 'pipeline.invalid_graph':
    case 'pipeline.invalid_loop':
    case 'pipeline.invalid_regex':
      return i18n.t('This package contains unsupported settings, conditions, or step connections.');
    case 'pipeline.runtime_error':
      return i18n.t('The pipeline stopped because an operation failed.');
    default:
      return error;
  }
}
export function pipelineStatus(status: string): string {
  switch (status) {
    case 'draft':
      return i18n.t('Draft');
    case 'running':
      return i18n.t('Running');
    case 'pending':
      return i18n.t('Pending');
    case 'completed':
      return i18n.t('Completed');
    case 'halted':
      return i18n.t('Halted');
    case 'paused':
      return i18n.t('Paused');
    case 'failed':
      return i18n.t('Failed');
    case 'skipped':
      return i18n.t('Skipped');
    case 'awaiting_approval':
      return i18n.t('Waiting for approval');
    default:
      return status;
  }
}
