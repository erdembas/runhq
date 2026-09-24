use super::{AgentManager, WorkspaceRecord};
use crate::AppResult;
use std::path::Path;

pub(super) const WORKSPACE_PERMISSION_PREFIX: &str = "preferences:workspace-permissions:";

pub(super) fn workspace_permission_key(path: &str) -> String {
    format!("{WORKSPACE_PERMISSION_PREFIX}{path}")
}

pub(super) fn valid_workspace_permission(key: &str, value: &serde_json::Value) -> bool {
    value["policy"] == "all"
        && value["path"].as_str().is_some_and(|path| {
            Path::new(path).is_absolute() && key == workspace_permission_key(path)
        })
}

pub(super) fn valid_policy(value: &serde_json::Value) -> bool {
    matches!(value.as_str(), Some("ask" | "read" | "all"))
}

impl AgentManager {
    pub(super) fn workspace_permission(&self, cwd: &str) -> AppResult<Option<WorkspaceRecord>> {
        let path = Path::new(cwd)
            .canonicalize()?
            .to_string_lossy()
            .into_owned();
        Ok(self
            .workspace_record(&workspace_permission_key(&path))?
            .filter(|record| valid_workspace_permission(&record.key, &record.value)))
    }

    pub(super) fn permission_policy_for(&self, cwd: &str) -> AppResult<String> {
        if self.workspace_permission(cwd)?.is_some() {
            return Ok("all".into());
        }
        self.permission_policy()
    }

    pub(super) fn allow_workspace_permissions(&self, cwd: &str) -> AppResult<()> {
        let path = Path::new(cwd)
            .canonicalize()?
            .to_string_lossy()
            .into_owned();
        self.workspace_save(
            workspace_permission_key(&path),
            Some(serde_json::json!({
                "path": path, "policy": "all",
            })),
        )
    }

    pub(super) fn permission_policy(&self) -> AppResult<String> {
        let record = self.workspace_record("preferences:permissions")?;
        Ok(record
            .as_ref()
            .map(|record| &record.value["policy"])
            .filter(|value| valid_policy(value))
            .and_then(|value| value.as_str())
            .unwrap_or("ask")
            .to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn permission_policy_is_opt_in_validated_and_durable() {
        let home = tempfile::tempdir().unwrap();
        let open = || AgentManager::open(home.path(), "unused".into(), Arc::new(|_| {})).unwrap();
        let manager = open();
        assert_eq!(manager.permission_policy().unwrap(), "ask");
        for policy in ["ask", "read", "all"] {
            manager
                .workspace_save(
                    "preferences:permissions".into(),
                    Some(json!({"policy": policy})),
                )
                .unwrap();
            assert_eq!(manager.permission_policy().unwrap(), policy);
        }
        assert!(manager
            .workspace_save(
                "preferences:permissions".into(),
                Some(json!({"policy": "unknown"}))
            )
            .is_err());
        drop(manager);
        let manager = open();
        assert_eq!(manager.permission_policy().unwrap(), "all");
        manager
            .workspace_save("preferences:permissions".into(), None)
            .unwrap();
        assert_eq!(manager.permission_policy().unwrap(), "ask");
    }

    #[test]
    fn workspace_permissions_are_canonical_scoped_durable_and_revocable() {
        let home = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let open = || AgentManager::open(home.path(), "unused".into(), Arc::new(|_| {})).unwrap();
        let manager = open();
        let cwd = workspace.path().to_str().unwrap();
        manager.allow_workspace_permissions(cwd).unwrap();
        assert_eq!(manager.permission_policy_for(cwd).unwrap(), "all");
        assert_eq!(
            manager
                .permission_policy_for(workspace.path().join(".").to_str().unwrap())
                .unwrap(),
            "all"
        );
        assert_eq!(
            manager
                .permission_policy_for(other.path().to_str().unwrap())
                .unwrap(),
            "ask"
        );
        std::fs::create_dir(workspace.path().join("child")).unwrap();
        assert_eq!(
            manager
                .permission_policy_for(workspace.path().join("child").to_str().unwrap())
                .unwrap(),
            "ask"
        );
        drop(manager);
        let manager = open();
        assert_eq!(manager.permission_policy_for(cwd).unwrap(), "all");
        let record = manager.workspace_permission(cwd).unwrap().unwrap();
        assert!(manager
            .workspace_save(
                record.key.clone(),
                Some(json!({"path": "/another", "policy": "all"}))
            )
            .is_err());
        manager.workspace_save(record.key, None).unwrap();
        assert_eq!(manager.permission_policy_for(cwd).unwrap(), "ask");
    }
}
