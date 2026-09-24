use super::*;

/// Require canonical, existing members beneath the chosen root. Recheck before every turn:
/// removing a directory or replacing it with a symlink must not silently retarget a chat.
pub(super) fn validate_workspace_scope(root: &Path, scope: &AgentWorkspaceScope) -> AppResult<()> {
    let canonical = root.canonicalize()?;
    if !canonical.is_dir() || canonical != root || canonical.parent().is_none() {
        return Err(invalid(
            "Choose a shared project folder, not the filesystem root",
        ));
    }
    if scope.members.is_empty() {
        return Err(invalid("Select at least one service for this workspace"));
    }
    for member in &scope.members {
        let path = Path::new(&member.path);
        let resolved = path.canonicalize()?;
        if !resolved.is_dir() || resolved != path || !resolved.starts_with(&canonical) {
            return Err(invalid(format!(
                "Workspace member is missing, moved, or outside the root: {}",
                member.name
            )));
        }
    }
    Ok(())
}

pub(super) fn workspace_prompt(
    scope: Option<&AgentWorkspaceScope>,
    prompt: &str,
) -> AppResult<String> {
    let Some(scope) = scope else {
        return Ok(prompt.into());
    };
    // This is agent context, not interface text. JSON keeps names and paths as data.
    Ok(format!("RunHQ multi-project workspace. Work across the selected project folders listed below. The current directory is their shared root. Limit project changes to these selected folders unless the user explicitly expands the scope. Each folder may have its own repository and instructions; inspect and follow them. Do not assume the shared root is a Git repository. At the end, summarize changes per selected project and list the exact checks or tests run with their outcomes. Explicitly identify checks that were not run.\nSelected projects (JSON data):\n{}\n\nShared workspace instructions:\n{}\n\nUser request:\n{prompt}", serde_json::to_string(&scope.members)?, scope.instructions))
}

impl AgentManager {
    /// Resolve service folders again before a workspace run; moving a service must not retarget it.
    pub fn validate_workspace_run(
        &self,
        id: &str,
        services: &[crate::state::ServiceDef],
    ) -> AppResult<()> {
        let project = self.state.lock().db.project(id)?;
        let scope = project
            .workspace
            .ok_or_else(|| invalid("Expected a multi-project workspace"))?;
        for service in services {
            let member = scope
                .members
                .iter()
                .find(|member| member.service_id == service.id)
                .ok_or_else(|| invalid("Run group includes a service outside this workspace"))?;
            if service.cwd.canonicalize()? != Path::new(&member.path) {
                return Err(invalid(
                    "A service folder changed. Update the workspace before starting its run group",
                ));
            }
        }
        Ok(())
    }

    pub fn save_multi_workspace(
        &self,
        id: Option<String>,
        name: String,
        root: PathBuf,
        scope: AgentWorkspaceScope,
    ) -> AppResult<AgentProject> {
        if scope.instructions.len() > 32_000 {
            return Err(invalid("Workspace instructions exceed 32000 bytes"));
        }
        if name.trim().is_empty() || name.chars().count() > 200 {
            return Err(invalid("Workspace name must contain 1–200 characters"));
        }
        let root = root.canonicalize()?;
        validate_workspace_scope(&root, &scope)?;
        let state = self.state.lock();
        let id = match id {
            Some(id) => {
                if state.db.project(&id)?.workspace.is_none() {
                    return Err(invalid("This project is not a multi-project workspace"));
                }
                id
            }
            None => uuid::Uuid::new_v4().to_string(),
        };
        let project = AgentProject {
            id,
            name: name.trim().into(),
            path: root.to_string_lossy().into(),
            workspace: Some(scope),
        };
        state.db.conn.execute(
            "INSERT INTO agent_multi_workspaces(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            rusqlite::params![project.id, serde_json::to_string(&project)?],
        ).map_err(|e| AppError::other(e.to_string()))?;
        Ok(project)
    }

    pub fn delete_multi_workspace(&self, id: &str) -> AppResult<()> {
        // Session snapshots remain valid and resumable after removing the workspace definition.
        self.state
            .lock()
            .db
            .conn
            .execute("DELETE FROM agent_multi_workspaces WHERE id=?1", [id])
            .map_err(|e| AppError::other(e.to_string()))?;
        Ok(())
    }
}

pub(super) fn select_task_members(
    scope: &mut Option<AgentWorkspaceScope>,
    ids: Option<&[String]>,
) -> AppResult<()> {
    let Some(ids) = ids else { return Ok(()) };
    let scope = scope
        .as_mut()
        .ok_or_else(|| invalid("Project selection requires a multi-project workspace"))?;
    if ids.is_empty()
        || ids
            .iter()
            .any(|id| !scope.members.iter().any(|m| &m.service_id == id))
    {
        return Err(invalid("Select at least one current workspace project"));
    }
    scope
        .members
        .retain(|member| ids.contains(&member.service_id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn workspace_identity_persistence_and_session_scope_are_independent() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let a = root.join("frontend");
        let b = root.join("backend");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        let scope = AgentWorkspaceScope {
            instructions: "Keep API clients aligned".into(),
            section_id: "section".into(),
            members: vec![
                AgentWorkspaceMember {
                    service_id: "a".into(),
                    name: "Frontend".into(),
                    path: a.to_string_lossy().into(),
                    base_revision: None,
                    pre_existing_paths: vec![],
                },
                AgentWorkspaceMember {
                    service_id: "b".into(),
                    name: "Backend".into(),
                    path: b.to_string_lossy().into(),
                    base_revision: None,
                    pre_existing_paths: vec![],
                },
            ],
        };
        let manager =
            AgentManager::open(&root.join("state"), root.join("bridge"), Arc::new(|_| {})).unwrap();
        let ordinary = manager
            .add_project("Root project".into(), root.clone())
            .unwrap();
        let workspace = manager
            .save_multi_workspace(None, "Workspace".into(), root.clone(), scope.clone())
            .unwrap();
        assert_ne!(ordinary.id, workspace.id);
        let mut run_service: crate::state::ServiceDef =
            serde_json::from_value(json!({"id":"a","name":"A","cwd":a,"cmds":[]})).unwrap();
        manager
            .validate_workspace_run(&workspace.id, &[run_service.clone()])
            .unwrap();
        run_service.cwd = b.clone();
        assert!(manager
            .validate_workspace_run(&workspace.id, &[run_service.clone()])
            .is_err());
        run_service.cwd = a.clone();
        run_service.id = "outside".into();
        assert!(manager
            .validate_workspace_run(&workspace.id, &[run_service.clone()])
            .is_err());
        #[cfg(unix)]
        {
            let alias = root.join("alias");
            std::os::unix::fs::symlink(&a, &alias).unwrap();
            run_service.id = "a".into();
            run_service.cwd = alias;
            manager
                .validate_workspace_run(&workspace.id, &[run_service])
                .unwrap();
        }

        let input = CreateAgentSession {
            workspace_service_ids: None,
            creation_request_id: None,
            project_id: workspace.id.clone(),
            backend: "codex".into(),
            executable: "codex".into(),
            title: "Task".into(),
            model: String::new(),
            effort: String::new(),
            mode: "default".into(),
            agent: String::new(),
            isolated: false,
        };
        let session = manager
            .create(serde_json::from_value(serde_json::to_value(&input).unwrap()).unwrap())
            .await
            .unwrap();
        assert_eq!(session.workspace.as_ref().unwrap().members.len(), 2);
        assert_eq!(session.cwd, root.to_string_lossy());
        let subset_input = || {
            serde_json::from_value::<CreateAgentSession>(serde_json::to_value(&input).unwrap())
                .unwrap()
        };
        let mut subset = subset_input();
        subset.workspace_service_ids = Some(vec!["b".into(), "b".into()]);
        let narrowed = manager.create(subset).await.unwrap();
        assert_eq!(narrowed.workspace.as_ref().unwrap().members.len(), 1);
        assert_eq!(
            narrowed.workspace.as_ref().unwrap().members[0].service_id,
            "b"
        );
        assert_eq!(
            narrowed.workspace.as_ref().unwrap().instructions,
            "Keep API clients aligned"
        );
        for ids in [vec![], vec!["outside".into()]] {
            let mut invalid = subset_input();
            invalid.workspace_service_ids = Some(ids);
            assert!(manager.create(invalid).await.is_err());
        }
        assert_eq!(
            manager
                .state
                .lock()
                .db
                .project(&workspace.id)
                .unwrap()
                .workspace
                .unwrap()
                .members
                .len(),
            2
        );

        let prompt = workspace_prompt(session.workspace.as_ref(), "Update both").unwrap();
        assert!(prompt.contains(&a.to_string_lossy().to_string()));
        assert!(prompt.contains(&b.to_string_lossy().to_string()));
        assert_eq!(workspace_prompt(None, "unchanged").unwrap(), "unchanged");
        let mut isolated = input;
        isolated.isolated = true;
        assert!(manager.create(isolated).await.is_err());
        let mut edited = scope.clone();
        edited.members.pop();
        edited.instructions = "New instructions".into();
        manager
            .save_multi_workspace(
                Some(workspace.id.clone()),
                "Renamed".into(),
                root.clone(),
                edited,
            )
            .unwrap();
        assert_eq!(
            manager
                .session(&session.id)
                .unwrap()
                .workspace
                .unwrap()
                .members
                .len(),
            2
        );
        assert_eq!(
            manager
                .session(&narrowed.id)
                .unwrap()
                .workspace
                .unwrap()
                .instructions,
            "Keep API clients aligned"
        );
        drop(manager);
        let manager =
            AgentManager::open(&root.join("state"), root.join("bridge"), Arc::new(|_| {})).unwrap();
        assert_eq!(manager.projects().unwrap().len(), 2);
        assert_eq!(
            manager.state.lock().db.project(&workspace.id).unwrap().name,
            "Renamed"
        );
        manager.delete_multi_workspace(&workspace.id).unwrap();
        assert_eq!(manager.projects().unwrap().len(), 1);
        assert_eq!(
            manager
                .session(&session.id)
                .unwrap()
                .workspace
                .unwrap()
                .members
                .len(),
            2
        );
        assert!(manager
            .save_multi_workspace(None, "Bad".into(), a.clone(), scope.clone())
            .is_err());
        std::fs::remove_dir(&b).unwrap();
        assert!(validate_workspace_scope(&root, &scope).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn replaced_symlinks_do_not_retarget_members() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let member = root.join("member");
        let other = root.join("other");
        std::fs::create_dir(&member).unwrap();
        std::fs::create_dir(&other).unwrap();
        let scope = AgentWorkspaceScope {
            instructions: String::new(),
            section_id: String::new(),
            members: vec![AgentWorkspaceMember {
                service_id: "x".into(),
                name: "X".into(),
                path: member.to_string_lossy().into(),
                base_revision: None,
                pre_existing_paths: vec![],
            }],
        };
        validate_workspace_scope(&root, &scope).unwrap();
        std::fs::remove_dir(&member).unwrap();
        std::os::unix::fs::symlink(other, member).unwrap();
        assert!(validate_workspace_scope(&root, &scope).is_err());
    }
}
