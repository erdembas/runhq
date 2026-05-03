export type TimelineEventType =
  | 'service_started'
  | 'service_stopped'
  | 'service_crashed'
  | 'git_commit'
  | 'git_push'
  | 'git_pull'
  | 'git_checkout'
  | 'git_branch_created'
  | 'git_stash'
  | 'log_error'
  | 'log_warning'
  | 'file_changed';

export interface TimelineEvent {
  id: number;
  timestamp: string;
  service_id: string | null;
  service_name: string | null;
  event_type: TimelineEventType;
  description: string;
  run_id: string | null;
}
