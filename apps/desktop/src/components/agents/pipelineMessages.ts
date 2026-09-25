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
    case 'pipeline.invalid_settings':
    case 'pipeline.invalid_condition':
    case 'pipeline.invalid_step':
    case 'pipeline.invalid_graph':
    case 'pipeline.invalid_loop':
    case 'pipeline.invalid_regex':
      return i18n.t('This package contains unsupported settings, conditions, or step connections.');
    default:
      return error;
  }
}
