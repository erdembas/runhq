use super::AgentManager;
use crate::AppResult;

pub(super) fn valid_policy(value: &serde_json::Value) -> bool {
    matches!(value.as_str(), Some("ask" | "read" | "all"))
}

impl AgentManager {
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
}
