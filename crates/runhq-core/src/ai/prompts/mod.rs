mod advisory;
mod commit;
mod common;
mod explain;
mod workspace;

pub use advisory::{build_advisory_triage_prompt, AdvisoryBrief};
pub use commit::{build_commit_prompt, generate_commit_message};
pub use explain::{
    build_explain_diff_prompt, build_explain_project_prompt, build_log_triage_prompt,
};
pub use workspace::{build_polish_standup_prompt, build_workspace_report_prompt};

#[cfg(test)]
pub(super) use commit::{strip_message_artifacts, truncate_for_prompt, MAX_DIFF_CHARS};
#[cfg(test)]
pub(super) use common::MAX_EXPLAIN_DIFF_CHARS;
