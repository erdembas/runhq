use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimelineEventType {
    ServiceStarted,
    ServiceStopped,
    ServiceCrashed,
    GitCommit,
    GitPush,
    GitPull,
    GitCheckout,
    GitBranchCreated,
    GitStash,
    LogError,
    LogWarning,
    FileChanged,
}

impl TimelineEventType {
    pub(super) fn from_db(value: &str) -> Self {
        match value {
            "service_started" => Self::ServiceStarted,
            "service_stopped" => Self::ServiceStopped,
            "service_crashed" => Self::ServiceCrashed,
            "git_commit" => Self::GitCommit,
            "git_push" => Self::GitPush,
            "git_pull" => Self::GitPull,
            "git_checkout" => Self::GitCheckout,
            "git_branch_created" => Self::GitBranchCreated,
            "git_stash" => Self::GitStash,
            "log_error" => Self::LogError,
            "log_warning" => Self::LogWarning,
            "file_changed" => Self::FileChanged,
            _ => Self::LogError,
        }
    }
}

impl std::fmt::Display for TimelineEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ServiceStarted => write!(f, "service_started"),
            Self::ServiceStopped => write!(f, "service_stopped"),
            Self::ServiceCrashed => write!(f, "service_crashed"),
            Self::GitCommit => write!(f, "git_commit"),
            Self::GitPush => write!(f, "git_push"),
            Self::GitPull => write!(f, "git_pull"),
            Self::GitCheckout => write!(f, "git_checkout"),
            Self::GitBranchCreated => write!(f, "git_branch_created"),
            Self::GitStash => write!(f, "git_stash"),
            Self::LogError => write!(f, "log_error"),
            Self::LogWarning => write!(f, "log_warning"),
            Self::FileChanged => write!(f, "file_changed"),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TimelineEvent {
    pub id: i64,
    pub timestamp: DateTime<Utc>,
    pub service_id: Option<String>,
    pub service_name: Option<String>,
    pub event_type: TimelineEventType,
    pub description: String,
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DailySummary {
    pub date: String,
    pub projects_worked: usize,
    pub commits: usize,
    pub services_started: usize,
    pub errors: usize,
    pub project_names: Vec<String>,
}
