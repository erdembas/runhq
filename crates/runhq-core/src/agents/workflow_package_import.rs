//! Package manifests become ordinary editable native Workflow declarations.
//! The captured manifest/assets are data; importing never executes installation or shell commands.
use super::*;
use crate::agents::pipeline::{self, Halt, Manifest, Matcher, Step};
use std::collections::HashSet;

pub(super) fn import_package(home: &Path, path: &Path) -> AppResult<Value> {
    let files = pipeline::import::read_package(path)?;
    let mut manifest: Manifest = serde_json::from_slice(
        files
            .get("pipeline.json")
            .ok_or_else(|| invalid("pipeline.invalid_manifest"))?,
    )
    .map_err(|_| invalid("pipeline.invalid_manifest"))?;
    for step in &mut manifest.steps {
        if !step.prompt_file.is_empty() {
            let name = pipeline::import::relative(&step.prompt_file)?
                .to_string_lossy()
                .into_owned();
            step.prompt = String::from_utf8(
                files
                    .get(&name)
                    .ok_or_else(|| invalid("pipeline.missing_file"))?
                    .clone(),
            )
            .map_err(|_| invalid("workflow.import_encoding"))?;
        }
    }
    pipeline::import::validate_manifest(&manifest)?;
    let (repositories, issues) = pipeline::import::preflight_manifest(&manifest)?;
    let working_directory = Path::new(&manifest.settings.agent_working_directory)
        .canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| manifest.settings.agent_working_directory.clone());
    let capture_id = uuid::Uuid::new_v4().to_string();
    let capture_root = home.join("workflow-packages").join(&capture_id);
    let package_root = capture_root.join("package");
    // Every import gets its own capture. Failed conversions remove their incomplete capture.
    let result = (|| -> AppResult<Value> {
        std::fs::create_dir_all(&package_root)?;
        for (name, bytes) in &files {
            let target = package_root.join(pipeline::import::relative(name)?);
            std::fs::create_dir_all(
                target
                    .parent()
                    .ok_or_else(|| invalid("pipeline.invalid_path"))?,
            )?;
            std::fs::write(target, bytes)?;
        }
        let package_root = package_root.canonicalize()?;
        let steps = converted_steps(&manifest, &package_root)?;
        let shell_directory = package_root.join(&manifest.settings.shell_working_directory);
        if !shell_directory.is_dir() {
            return Err(invalid("workflow.invalid_directory"));
        }
        let objective = [manifest.name.as_str(), manifest.description.as_str()]
            .into_iter()
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        let recipe = json!({
            "id": capture_id,
            "name": manifest.name,
            "prompt": objective,
            "backend": "", "model": "", "effort": "", "agent": "",
            "mode": if manifest.settings.agent_mode == "plan" { "plan" } else { "default" },
            "isolated": false,
            "acceptance": manifest.semantics.join("\n"),
            "setupCommands": "", "checkCommands": "", "version": 1,
            "workflowSteps": steps,
            "workflowConcurrency": manifest.settings.max_concurrent_unlocked_steps,
            "workflowContext": {
                "workspace_mode": "direct",
                "package_root": package_root,
                "working_directory": working_directory,
                "repositories": repositories,
                "issues": issues,
                "environment": {},
                "notify_human": manifest.settings.failure_policy.notify_human,
                "source": path.to_string_lossy()
            }
        });
        let data = json!({ "version": 1, "recipes": [recipe] });
        if serde_json::to_vec(&data)?.len() > 16 * 1024 * 1024 {
            return Err(invalid("workflow.import_too_large"));
        }
        Ok(data)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&capture_root);
    }
    result
}

fn converted_steps(manifest: &Manifest, package_root: &Path) -> AppResult<Vec<Value>> {
    let mut done = HashSet::new();
    let mut converted = Vec::with_capacity(manifest.steps.len());
    // Package manifests allow forward declarations. Native Workflow recipes use topological order.
    while converted.len() < manifest.steps.len() {
        let before = converted.len();
        for step in &manifest.steps {
            if done.contains(&step.id) || !step.depends_on.iter().all(|id| done.contains(id)) {
                continue;
            }
            converted.push(converted_step(manifest, step, package_root)?);
            done.insert(step.id.clone());
        }
        if before == converted.len() {
            return Err(invalid("pipeline.invalid_graph"));
        }
    }
    Ok(converted)
}

fn matcher_fields(execution: &mut Value, prefix: &str, matcher: &Matcher) {
    if let Some(pattern) = matcher
        .output_regex
        .as_ref()
        .or(matcher.last_line_regex.as_ref())
    {
        execution[format!("{prefix}_regex")] = json!(pattern);
        execution[format!("{prefix}_scope")] = json!(if matcher.output_regex.is_some() {
            "output"
        } else {
            "last_line"
        });
    }
    if let Some(code) = matcher.exit_code {
        execution[format!("{prefix}_exit_code")] = json!(code);
    }
    if let Some(code) = matcher.exit_code_not.filter(|_| prefix == "failure") {
        execution[format!("{prefix}_exit_code_not")] = json!(code);
    }
}

fn converted_step(manifest: &Manifest, step: &Step, package_root: &Path) -> AppResult<Value> {
    let review = step.review();
    let role = match step.r#type.as_str() {
        "agent" if review => "review",
        "agent"
            if step
                .depends_on
                .iter()
                .any(|id| manifest.steps.iter().any(|s| &s.id == id && s.review())) =>
        {
            "revise"
        }
        "agent"
            if step.mode == "plan"
                || (step.mode.is_empty() && manifest.settings.agent_mode == "plan") =>
        {
            "plan"
        }
        "agent" => "implement",
        role => role,
    };
    let mut prompt_parts: Vec<&str> = [&step.title, &step.description]
        .into_iter()
        .filter(|text| !text.trim().is_empty())
        .map(String::as_str)
        .collect();
    if !step.message.trim().is_empty() {
        prompt_parts.push(&step.message);
    }
    if !step.prompt.trim().is_empty() {
        prompt_parts.push(&step.prompt);
    }
    let prompt = if prompt_parts.is_empty() {
        step.id.clone()
    } else {
        prompt_parts.join("\n\n")
    };
    if prompt.len() > MAX_STEP_PROMPT {
        return Err(invalid("workflow.import_too_large"));
    }
    let timeout = step.timeout_minutes.unwrap_or(if step.r#type == "shell" {
        manifest.settings.shell_timeout_minutes
    } else {
        manifest.settings.agent_timeout_minutes
    });
    let mut execution = json!({
        "command": step.command,
        "lock": step.lock,
        "timeout_minutes": if ["human", "barrier"].contains(&role) { 0 } else { timeout },
        "max_fix_attempts": 0,
        "result_format": if review { "review" } else if step.r#type == "agent" { "pipeline" } else { "none" },
        "result_scope": "final_response",
        "run_condition": step.run_if,
        "complete_condition": step.complete_if,
        "max_runs": step.max_runs,
        "require_pass": step.require_pass,
        "on_failure": "pause"
    });
    if step.r#type == "shell" {
        execution["working_directory"] =
            json!(package_root.join(&manifest.settings.shell_working_directory));
    }
    if let Some(matcher) = &step.success {
        matcher_fields(&mut execution, "success", matcher);
    }
    match &step.halt_if {
        Some(Halt::Match(matcher)) => matcher_fields(&mut execution, "failure", matcher),
        Some(Halt::Expression(expression)) => execution["halt_condition"] = json!(expression),
        None => {}
    }
    if let Some(capture) = &step.capture {
        execution["verdict_regex"] = json!(capture.verdict.pattern());
        execution["verdict_scope"] = json!(if capture.verdict.last_line() {
            "last_line"
        } else {
            "output"
        });
    }
    if step.r#type == "agent" {
        if let Some(line) = &manifest.settings.result_line {
            execution["result_line_regex"] = json!(if review {
                &line.review_steps
            } else {
                &line.agent_steps
            });
        }
    }
    if let Some(rerun) = &step.on_success {
        execution["rerun_step"] = json!(rerun.rerun);
    }
    Ok(json!({
        "id": step.id,
        "role": role,
        "target": step.backend,
        "model": step.model,
        "effort": step.effort,
        "mode": if review || role == "plan" { "plan" } else { "default" },
        "prompt": prompt,
        "dependsOn": step.depends_on,
        "workspace": "shared",
        "reviewPolicy": if review { "continue" } else { "" },
        "execution": execution
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture(root: &Path) -> Value {
        json!({
            "version": 2, "name": "Package workflow", "description": "Editable task graph",
            "settings": { "agentWorkingDirectory": root, "agentTimeoutMinutes": 240,
                "locks": { "main": { "maxConcurrent": 1 } },
                "repositories": [{ "name": "Repo", "path": root, "branch": "main" }] },
            "steps": [
                {"id":"approve","type":"human","message":"Approve the selected checkouts"},
                {"id":"implement","type":"agent","dependsOn":["approve"],"lock":"main", "backend":"opencode","model":"chosen-model","effort":"high","promptFile":"prompts/implement.md","success":{"outputRegex":"PIPELINE_RESULT: (SUCCESS|PARTIAL)"},"haltIf":{"lastLineRegex":"PIPELINE_RESULT: (FAILED|BLOCKED)"}},
                {"id":"gate","type":"shell","dependsOn":["implement"],"command":"bash ./verify.sh","success":{"exitCode":7},"haltIf":{"exitCodeNot":7}},
                {"id":"review","type":"agent","dependsOn":["gate"],"prompt":"Review this change","capture":{"verdict":{"lastLineRegex":"REVIEW_VERDICT: (PASS|CONDITIONAL|FAIL)","group":1}},"maxRuns":3},
                {"id":"fix","type":"agent","dependsOn":["review"],"prompt":"Fix findings","runIf":"review.verdict != 'PASS' && review.runCount < 3","success":{"lastLineRegex":"PIPELINE_RESULT: SUCCESS"},"maxRuns":2},
                {"id":"fix-gate","type":"shell","dependsOn":["fix"],"command":"true","maxRuns":2,"onSuccess":{"rerun":"review"}},
                {"id":"done","type":"barrier","dependsOn":["review"],"requirePass":["review"],"completeIf":"review.verdict == 'PASS'","haltIf":"review.verdict != 'PASS' && review.runCount >= 3"}
            ],
            "assets": ["verify.sh"]
        })
    }

    fn write_fixture(root: &Path, data: &Value) -> PathBuf {
        std::fs::create_dir_all(root.join("prompts")).unwrap();
        std::fs::write(
            root.join("prompts/implement.md"),
            "Implement the requested change",
        )
        .unwrap();
        std::fs::write(root.join("verify.sh"), "exit 7\n").unwrap();
        let path = root.join("pipeline.json");
        std::fs::write(&path, serde_json::to_vec(data).unwrap()).unwrap();
        path
    }

    #[test]
    fn package_import_preserves_native_graph_and_execution_contract() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("source");
        let manifest = write_fixture(&root, &fixture(&root));
        let home = temp.path().join("home");
        let imported = import_package(&home, &manifest).unwrap();
        let recipe = &imported["recipes"][0];
        let steps = recipe["workflowSteps"].as_array().unwrap();
        assert_eq!(steps.len(), 7);
        assert_eq!(steps[0]["role"], "human");
        assert_eq!(steps[1]["target"], "opencode");
        assert_eq!(steps[1]["model"], "chosen-model");
        assert_eq!(steps[1]["effort"], "high");
        assert_eq!(steps[1]["execution"]["timeout_minutes"], 240);
        assert_eq!(steps[1]["execution"]["success_scope"], "output");
        assert_eq!(steps[1]["execution"]["failure_scope"], "last_line");
        assert_eq!(steps[2]["execution"]["success_exit_code"], 7);
        assert_eq!(steps[2]["execution"]["failure_exit_code_not"], 7);
        assert_eq!(steps[3]["execution"]["max_runs"], 3);
        assert_eq!(steps[3]["reviewPolicy"], "continue");
        assert_eq!(steps[4]["role"], "revise");
        assert_eq!(steps[5]["execution"]["rerun_step"], "review");
        assert_eq!(steps[6]["execution"]["require_pass"], json!(["review"]));
        // The shared native execution schema must accept every translated field.
        for step in steps {
            let _: crate::agents::WorkflowExecution =
                serde_json::from_value(step["execution"].clone()).unwrap();
        }
        assert_eq!(recipe["workflowContext"]["workspace_mode"], "direct");
        assert_eq!(
            recipe["workflowContext"]["repositories"][0]["branch"],
            "main"
        );
        let captured = Path::new(recipe["workflowContext"]["package_root"].as_str().unwrap());
        assert!(captured.starts_with(home.canonicalize().unwrap().join("workflow-packages")));
        assert_eq!(
            std::fs::read_to_string(captured.join("verify.sh")).unwrap(),
            "exit 7\n"
        );
        std::fs::write(root.join("prompts/implement.md"), "Modified source").unwrap();
        assert_eq!(steps[1]["prompt"], "Implement the requested change");
        assert_eq!(
            std::fs::read_to_string(captured.join("prompts/implement.md")).unwrap(),
            "Implement the requested change"
        );
        assert!(!home.join("pipelines").exists());
        assert!(!home.join("agents.db").exists());
    }

    #[test]
    fn sorts_forward_dependencies_and_supports_large_graphs() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("source");
        let mut data = fixture(&root);
        let mut steps: Vec<Value> = (0..138)
            .map(|index| {
                json!({
                    "id": format!("s{index}"), "type": "human", "message": format!("Gate {index}"),
                    "dependsOn": if index == 0 { vec![] } else { vec![format!("s{}", index - 1)] }
                })
            })
            .collect();
        steps.reverse();
        data["steps"] = json!(steps);
        let file = write_fixture(&root, &data);
        let imported = import_package(&temp.path().join("home"), &file).unwrap();
        let steps = imported["recipes"][0]["workflowSteps"].as_array().unwrap();
        assert_eq!(steps.len(), 138);
        assert_eq!(steps[0]["id"], "s0");
        assert_eq!(steps[137]["dependsOn"], json!(["s136"]));
    }

    fn zip_file(path: &Path, files: &[(&str, Vec<u8>)]) {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        for (name, bytes) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    async fn native_fixture() -> (tempfile::TempDir, Arc<AgentManager>, AgentWorkflow) {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        std::fs::create_dir(&repository).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.email", "fixture@example.invalid"],
            vec!["config", "user.name", "Workflow fixture"],
            vec!["commit", "--allow-empty", "-m", "Initial"],
        ] {
            let output = std::process::Command::new("git")
                .current_dir(&repository)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let path = write_fixture(&temp.path().join("source"), &fixture(&repository));
        let manager = Arc::new(
            AgentManager::open(
                &temp.path().join("home"),
                PathBuf::from("unused-runtime"),
                Arc::new(|_| {}),
            )
            .unwrap(),
        );
        let imported = manager.import_workflow_file(&path).unwrap();
        let recipe = &imported["recipes"][0];
        let steps: Vec<Value> = recipe["workflowSteps"]
            .as_array()
            .unwrap()
            .iter()
            .cloned()
            .map(|mut step| {
                for (recipe_field, native_field) in [
                    ("dependsOn", "depends_on"),
                    ("reviewPolicy", "review_policy"),
                ] {
                    let value = step.as_object_mut().unwrap().remove(recipe_field).unwrap();
                    step[native_field] = value;
                }
                if step["target"] == "" {
                    step["target"] = json!("codex");
                }
                step
            })
            .collect();
        let input: CreateAgentWorkflow = serde_json::from_value(json!({
            "project_id":"", "backend":"codex", "reviewer_backend":"codex",
            "objective":recipe["prompt"], "check_commands":[], "steps":steps,
            "context":recipe["workflowContext"]
        }))
        .unwrap();
        let workflow = manager.workflow_create(input).await.unwrap();
        assert!(manager.sessions().is_empty());
        assert!(!manager.home.join("pipelines").exists());
        (temp, manager, workflow)
    }

    #[tokio::test]
    async fn imported_package_is_a_native_draft_and_false_barriers_are_skipped() {
        let (_temp, _manager, mut workflow) = native_fixture().await;
        assert!(workflow.direct_workspace());
        assert_eq!(workflow.steps.len(), 7);
        assert_eq!(workflow.steps[0].role, "human");
        for step in &mut workflow.steps {
            if step.id != "done" {
                step.status = "completed".into();
                step.result.outcome = Some("pass".into());
            }
        }
        let review = workflow
            .steps
            .iter_mut()
            .find(|s| s.id == "review")
            .unwrap();
        review.result.verdict = Some("FAIL".into());
        review.result.runs = 1;
        let barrier = workflow.steps.iter_mut().find(|s| s.id == "done").unwrap();
        barrier.execution.require_pass.clear();
        barrier.execution.run_condition = "review.verdict == 'PASS'".into();
        assert!(
            workflow.runnable_steps().iter().any(|s| s.id == "done"),
            "False barrier conditions must be admitted to record a skip"
        );
    }

    #[tokio::test]
    async fn native_package_results_preserve_anchored_output_and_failure_precedence() {
        let (_temp, manager, workflow) = native_fixture().await;
        let mut implementation = workflow.step("implement").unwrap().clone();
        implementation.execution.success_regex = "^PIPELINE_RESULT: SUCCESS$".into();
        manager.workflow_finish_execution(
            &mut implementation,
            true,
            Some((
                None,
                "Implementation report\nPIPELINE_RESULT: SUCCESS\nAdditional notes".into(),
            )),
        );
        assert_eq!(
            implementation.status, "completed",
            "outputRegex is applied to standalone lines, not the entire multiline response"
        );
        let mut review = workflow.step("review").unwrap().clone();
        manager.workflow_finish_execution(
            &mut review,
            true,
            Some((
                None,
                "PIPELINE_RESULT: BLOCKED\nREVIEW_VERDICT: PASS".into(),
            )),
        );
        assert_ne!(
            review.status, "completed",
            "Blocked implementation protocol overrides a passing review marker"
        );
        implementation.execution.success_scope = "last_line".into();
        implementation.execution.success_regex = "^PIPELINE_RESULT: (SUCCESS|PARTIAL)$".into();
        implementation.execution.result_line_regex = "^PIPELINE_RESULT: SUCCESS$".into();
        manager.workflow_finish_execution(
            &mut implementation,
            true,
            Some((None, "PIPELINE_RESULT: PARTIAL".into())),
        );
        assert_ne!(
            implementation.status, "completed",
            "Global result-line policy must also pass independently of the per-step matcher"
        );
    }

    #[tokio::test]
    async fn extra_review_revalidates_manual_changes_before_capturing_a_new_snapshot() {
        let (_temp, manager, mut workflow) = native_fixture().await;
        for step in &mut workflow.steps {
            step.status = "completed".into();
            step.result.outcome = Some("pass".into());
        }
        let review = workflow
            .steps
            .iter_mut()
            .find(|s| s.id == "review")
            .unwrap();
        review.result.verdict = Some("FAIL".into());
        review.result.runs = 3;
        review
            .result
            .repository_revisions
            .insert("repo".into(), "old-snapshot".into());
        let barrier = workflow.steps.iter_mut().find(|s| s.id == "done").unwrap();
        barrier.status = "blocked".into();
        barrier.error = Some("workflow.run_limit".into());
        workflow.stage = "review_failed".into();
        manager.save_workflow(&mut workflow).unwrap();
        let approved = manager
            .workflow_allow_run(&workflow.id, "review")
            .await
            .unwrap();
        assert_eq!(
            approved.step("gate").unwrap().status,
            "pending",
            "Manual changes need a fresh verification before another review"
        );
        assert_eq!(approved.step("review").unwrap().status, "pending");
        assert!(
            approved
                .step("review")
                .unwrap()
                .result
                .repository_revisions
                .is_empty(),
            "The extra review must use the new gate snapshot"
        );
        assert_eq!(
            approved.step("fix").unwrap().result.extra_runs,
            0,
            "Manual review approval must not extend automatic fix limits"
        );
    }

    #[tokio::test]
    async fn strict_pass_gate_allows_manual_revalidation_before_the_review_cap() {
        let (_temp, manager, mut workflow) = native_fixture().await;
        for step in &mut workflow.steps {
            step.status = "completed".into();
            step.result.outcome = Some("pass".into());
            step.result.runs = 1;
        }
        let review = workflow
            .steps
            .iter_mut()
            .find(|s| s.id == "review")
            .unwrap();
        review.result.verdict = Some("CONDITIONAL".into());
        let barrier = workflow.steps.iter_mut().find(|s| s.id == "done").unwrap();
        barrier.status = "blocked".into();
        barrier.error = Some("workflow.pass_required".into());
        workflow.stage = "review_failed".into();
        manager.save_workflow(&mut workflow).unwrap();
        let approved = manager
            .workflow_allow_run(&workflow.id, "review")
            .await
            .unwrap();
        assert_eq!(approved.step("review").unwrap().result.extra_runs, 0);
        assert_eq!(approved.step("gate").unwrap().status, "pending");
        assert_eq!(approved.step("gate").unwrap().result.extra_runs, 1);
        assert_eq!(approved.step("fix").unwrap().result.extra_runs, 0);
        assert!(
            manager
                .workflow_allow_run(&workflow.id, "review")
                .await
                .is_err(),
            "The same permission must not be granted twice from a stale view"
        );
    }

    #[tokio::test]
    async fn native_human_approval_requires_the_current_gate_identity() {
        let (_temp, manager, workflow) = native_fixture().await;
        let waiting = manager
            .workflow_run_named_step(&workflow.id, "approve")
            .await
            .unwrap();
        let gate = waiting.step("approve").unwrap();
        assert_eq!(gate.status, "awaiting_approval");
        let started = gate.started_at.unwrap();
        assert!(manager
            .workflow_decide_human(
                &workflow.id,
                "approve",
                true,
                String::new(),
                started - 1,
                gate.generation
            )
            .await
            .is_err());
        let approved = manager
            .workflow_decide_human(
                &workflow.id,
                "approve",
                true,
                "Reviewed repositories".into(),
                started,
                gate.generation,
            )
            .await
            .unwrap();
        assert_eq!(approved.step("approve").unwrap().status, "completed");
        assert_eq!(
            approved.step("approve").unwrap().result.decision.as_deref(),
            Some("approved")
        );
        assert!(manager.sessions().is_empty());
    }

    #[test]
    fn zip_captures_nested_assets_without_running_install_scripts() {
        let temp = tempfile::tempdir().unwrap();
        let mut data = fixture(temp.path());
        let marker = temp.path().join("must-not-exist");
        data["package"] = json!({ "contents": ["prompts", "verify.sh", "generate.mjs"],
            "install": [format!("touch {}", marker.display())] });
        let zip = temp.path().join("package.zip");
        zip_file(
            &zip,
            &[
                ("bundle/pipeline.json", serde_json::to_vec(&data).unwrap()),
                ("bundle/prompts/implement.md", b"Do the change".to_vec()),
                (
                    "bundle/verify.sh",
                    format!("touch {}", marker.display()).into_bytes(),
                ),
                (
                    "bundle/generate.mjs",
                    b"throw new Error('must not execute')".to_vec(),
                ),
            ],
        );
        let imported = import_package(&temp.path().join("home"), &zip).unwrap();
        let package = Path::new(
            imported["recipes"][0]["workflowContext"]["package_root"]
                .as_str()
                .unwrap(),
        );
        assert!(package.join("generate.mjs").is_file());
        assert_eq!(
            imported["recipes"][0]["workflowSteps"][1]["prompt"],
            "Do the change"
        );
        assert!(!marker.exists());
    }

    #[test]
    fn rejects_archive_traversal_and_external_prompt_symlinks_without_capturing() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let zip = temp.path().join("evil.zip");
        zip_file(&zip, &[("../escape", b"bad".to_vec())]);
        assert!(import_package(&home, &zip).is_err());
        assert!(!home.exists());
        #[cfg(unix)]
        {
            let root = temp.path().join("source");
            let path = write_fixture(&root, &fixture(&root));
            std::fs::remove_file(root.join("prompts/implement.md")).unwrap();
            let outside = temp.path().join("outside.md");
            std::fs::write(&outside, "Not part of the package").unwrap();
            std::os::unix::fs::symlink(outside, root.join("prompts/implement.md")).unwrap();
            assert!(import_package(&home, &path).is_err());
            assert!(!home.exists());
        }
    }

    #[test]
    fn long_keys_and_preflight_issues_survive_import_without_loss() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("source");
        let mut data = fixture(&root);
        let long_key = format!("review-{}", "a".repeat(50));
        data["steps"][3]["id"] = json!(long_key);
        for step in data["steps"].as_array_mut().unwrap() {
            for dep in step
                .get_mut("dependsOn")
                .and_then(Value::as_array_mut)
                .into_iter()
                .flatten()
            {
                if dep == "review" {
                    *dep = json!(long_key);
                }
            }
            for field in ["runIf", "completeIf", "haltIf"] {
                if let Some(condition) = step[field].as_str() {
                    step[field] = json!(condition.replace("review.", &format!("{long_key}.")));
                }
            }
        }
        data["steps"][5]["onSuccess"]["rerun"] = json!(long_key);
        data["steps"][6]["requirePass"] = json!([long_key]);
        data["steps"][1]["prompt"] = json!("See /outside/package/verify.sh");
        data["steps"][1]
            .as_object_mut()
            .unwrap()
            .remove("promptFile");
        let file = write_fixture(&root, &data);
        let imported = import_package(&temp.path().join("home"), &file).unwrap();
        let recipe = &imported["recipes"][0];
        assert_eq!(recipe["workflowSteps"][3]["id"], long_key);
        assert_eq!(
            recipe["workflowSteps"][5]["execution"]["rerun_step"],
            long_key
        );
        assert!(recipe["workflowContext"]["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|issue| issue["code"] == "pipeline.external_assets" && issue["blocking"] == true));
    }

    #[test]
    fn global_result_line_matcher_is_preserved_in_addition_to_step_matchers() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("source");
        let mut data = fixture(&root);
        data["settings"]["resultLine"] = json!({
            "position":"last", "trimTrailingWhitespace":true,
            "agentSteps":"^PIPELINE_RESULT: SUCCESS$", "reviewSteps":"^REVIEW_VERDICT: PASS$"
        });
        data["steps"][1]["success"] =
            json!({"lastLineRegex":"^PIPELINE_RESULT: (SUCCESS|PARTIAL)$"});
        let path = write_fixture(&root, &data);
        let imported = import_package(&temp.path().join("home"), &path).unwrap();
        let steps = &imported["recipes"][0]["workflowSteps"];
        assert_eq!(
            steps[1]["execution"]["result_line_regex"],
            "^PIPELINE_RESULT: SUCCESS$"
        );
        assert_eq!(
            steps[1]["execution"]["success_regex"],
            "^PIPELINE_RESULT: (SUCCESS|PARTIAL)$"
        );
        assert_eq!(
            steps[3]["execution"]["result_line_regex"],
            "^REVIEW_VERDICT: PASS$"
        );
        assert_eq!(
            steps[3]["execution"]["verdict_regex"],
            "REVIEW_VERDICT: (PASS|CONDITIONAL|FAIL)"
        );
    }
}
