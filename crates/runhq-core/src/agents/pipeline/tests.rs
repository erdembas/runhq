use super::*;
use std::io::Write;
fn manifest(root: &Path) -> Manifest {
    serde_json::from_value(json!({
 "version":1,"name":"Review pipeline","settings":{"agentWorkingDirectory":root,"locks":{"main":{"maxConcurrent":1}},"review":{"maxReviewsPerPlan":3,"maxFixesPerPlan":2,"acceptConditionalFromReview":2}},
 "steps":[
 {"id":"start","type":"human","message":"Approve decisions"},
 {"id":"impl","type":"agent","lock":"main","dependsOn":["start"],"prompt":"Implement","success":{"outputRegex":"PIPELINE_RESULT: (SUCCESS|PARTIAL)"},"haltIf":{"outputRegex":"PIPELINE_RESULT: (BLOCKED|FAILED)"}},
 {"id":"gate","type":"shell","lock":"main","dependsOn":["impl"],"command":"exit 0","success":{"exitCode":0}},
 {"id":"review","type":"agent","dependsOn":["gate"],"prompt":"Review","capture":{"verdict":"REVIEW_VERDICT: (PASS|CONDITIONAL|FAIL)"},"maxRuns":3},
 {"id":"fix","type":"agent","lock":"main","dependsOn":["review"],"prompt":"Fix","runIf":"!(review.verdict == 'PASS' || (review.verdict == 'CONDITIONAL' && review.runCount >= 2)) && review.runCount < 3","success":{"outputRegex":"PIPELINE_RESULT: SUCCESS"},"maxRuns":2},
 {"id":"fix-gate","type":"shell","lock":"main","dependsOn":["fix"],"command":"exit 0","success":{"exitCode":0},"onSuccess":{"rerun":"review"},"maxRuns":2},
 {"id":"done","type":"barrier","dependsOn":["review"],"completeIf":"review.verdict == 'PASS' || (review.verdict == 'CONDITIONAL' && review.runCount >= 2)","haltIf":"!(review.verdict == 'PASS' || (review.verdict == 'CONDITIONAL' && review.runCount >= 2)) && review.runCount >= 3"}
 ]})).unwrap()
}
fn run(m: Manifest) -> PipelineRun {
    PipelineRun {
        id: uuid::Uuid::new_v4().to_string(),
        steps: m
            .steps
            .iter()
            .map(|s| (s.id.clone(), StepState::default()))
            .collect(),
        manifest: m,
        package_root: String::new(),
        run_root: String::new(),
        repositories: vec![],
        issues: vec![],
        state: "running".into(),
        revision: 0,
        backend: String::new(),
        reviewer: String::new(),
        project_id: String::new(),
        created_at: now(),
        updated_at: now(),
    }
}
fn complete(r: &mut PipelineRun, id: &str, text: &str, exit: Option<i32>) {
    let a = begin(r, id).unwrap();
    finish(r, id, &a, text.into(), exit, None).unwrap();
    gates(r).unwrap();
}
fn reviewed(verdict: &str) -> PipelineRun {
    let mut r = run(manifest(Path::new("/tmp")));
    gates(&mut r).unwrap();
    r.steps.get_mut("start").unwrap().status = "completed".into();
    r.state = "running".into();
    complete(&mut r, "impl", "PIPELINE_RESULT: SUCCESS", None);
    complete(&mut r, "gate", "", Some(0));
    complete(
        &mut r,
        "review",
        &format!("REVIEW_VERDICT: {verdict}"),
        None,
    );
    r
}
#[test]
fn human_and_barrier_do_not_execute_agents() {
    let mut r = run(manifest(Path::new("/tmp")));
    gates(&mut r).unwrap();
    assert_eq!(r.state, "awaiting_approval");
    assert_eq!(r.steps["impl"].status, "pending");
    assert!(r.steps.values().all(|s| s.attempts.is_empty()));
}
#[test]
fn pass_skips_fix_and_its_gate_without_satisfying_gate_dependency() {
    let r = reviewed("PASS");
    assert_eq!(r.state, "completed");
    assert_eq!(r.steps["done"].status, "completed");
    assert_eq!(r.steps["fix-gate"].status, "skipped");
    assert_eq!(r.steps["review"].runs, 1);
}
#[test]
fn conditional_requires_second_review_and_each_fix_has_a_gate() {
    let mut r = reviewed("CONDITIONAL");
    assert_eq!(r.steps["done"].status, "pending");
    complete(&mut r, "fix", "PIPELINE_RESULT: SUCCESS", None);
    assert_eq!(r.steps["review"].runs, 1);
    complete(&mut r, "fix-gate", "", Some(0));
    assert_eq!(r.steps["review"].status, "pending");
    complete(&mut r, "review", "REVIEW_VERDICT: CONDITIONAL", None);
    assert_eq!(r.state, "completed");
    assert_eq!(r.steps["fix"].runs, 1);
    assert_eq!(r.steps["review"].attempts.len(), 2);
}
#[test]
fn third_failed_review_halts_without_third_fix() {
    let mut r = reviewed("FAIL");
    for _ in 0..2 {
        complete(&mut r, "fix", "PIPELINE_RESULT: SUCCESS", None);
        complete(&mut r, "fix-gate", "", Some(0));
        complete(&mut r, "review", "REVIEW_VERDICT: FAIL", None);
    }
    assert_eq!(r.state, "halted");
    assert_eq!(r.steps["review"].runs, 3);
    assert_eq!(r.steps["fix"].runs, 2);
    assert_eq!(r.steps["done"].status, "failed");
}
#[test]
fn technical_retry_does_not_consume_review_round() {
    let mut r = reviewed("FAIL");
    complete(&mut r, "fix", "PIPELINE_RESULT: SUCCESS", None);
    complete(&mut r, "fix-gate", "", Some(0));
    let a = begin(&mut r, "review").unwrap();
    finish(
        &mut r,
        "review",
        &a,
        String::new(),
        None,
        Some("pipeline.timed_out".into()),
    )
    .unwrap();
    assert_eq!(r.steps["review"].runs, 1);
    r.steps.get_mut("review").unwrap().status = "pending".into();
    r.state = "running".into();
    complete(&mut r, "review", "REVIEW_VERDICT: CONDITIONAL", None);
    assert_eq!(r.steps["review"].runs, 2);
    assert_eq!(r.steps["review"].attempts.len(), 3);
    assert_eq!(r.state, "completed");
}
#[test]
fn conditions_wait_for_results_and_reject_executable_expressions() {
    let r = run(manifest(Path::new("/tmp")));
    assert_eq!(
        condition::condition("review.verdict != 'PASS'", &r.steps).unwrap(),
        None
    );
    for e in [
        "process.exit()",
        "review.runCount >= 2; bash x",
        "review.verdict == 'PASS' garbage",
        &format!(
            "{}review.verdict == 'PASS'{}",
            "(".repeat(40),
            ")".repeat(40)
        ),
    ] {
        assert!(condition::references(e).is_err(), "{e}");
    }
}
#[test]
fn strict_barrier_does_not_accept_conditional() {
    let mut r = reviewed("CONDITIONAL");
    r.steps.get_mut("review").unwrap().runs = 2;
    r.manifest
        .steps
        .iter_mut()
        .find(|s| s.id == "done")
        .unwrap()
        .require_pass = vec!["review".into()];
    gates(&mut r).unwrap();
    assert_eq!(r.state, "halted");
    assert!(r.steps["done"]
        .error
        .as_ref()
        .unwrap()
        .contains("pass_required"));
}
#[test]
fn failure_wins_and_ambiguous_results_fail() {
    let m = manifest(Path::new("/tmp"));
    let s = &m.steps[1];
    assert!(result(s, "PIPELINE_RESULT: SUCCESS\nPIPELINE_RESULT: FAILED", None).is_err());
    assert!(result(
        s,
        "PIPELINE_RESULT: SUCCESS\nPIPELINE_RESULT: SUCCESS",
        None
    )
    .is_err());
    assert!(result(
        &m.steps[3],
        "REVIEW_VERDICT: PASS\nREVIEW_VERDICT: FAIL",
        None
    )
    .is_err());
    assert!(result(&m.steps[3], "no verdict", None).is_err());
}
#[test]
fn validated_loops_and_graph_reject_missing_unknown_and_cyclic_inputs() {
    let mut m = manifest(Path::new("/tmp"));
    import::validate_manifest(&m).unwrap();
    m.steps[0].depends_on = vec!["done".into()];
    assert!(import::validate_manifest(&m).is_err());
    m.steps[0].depends_on.clear();
    m.steps[5].on_success.as_mut().unwrap().rerun = "missing".into();
    assert!(import::validate_manifest(&m).is_err());
    let mut v = serde_json::to_value(m).unwrap();
    v["settings"]["silentUnsupportedFlag"] = json!(true);
    assert!(serde_json::from_value::<Manifest>(v).is_err());
}
fn manager(temp: &tempfile::TempDir) -> Arc<AgentManager> {
    Arc::new(
        AgentManager::open(
            &temp.path().join("home"),
            temp.path().join("bridge.mjs"),
            Arc::new(|_| {}),
        )
        .unwrap(),
    )
}
fn repo(root: &Path, name: &str) -> PathBuf {
    let p = root.join(name);
    std::fs::create_dir_all(&p).unwrap();
    for args in [
        vec!["init", "-b", "work"],
        vec![
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "init",
        ],
    ] {
        assert!(std::process::Command::new("git")
            .args(args)
            .current_dir(&p)
            .output()
            .unwrap()
            .status
            .success());
    }
    p.canonicalize().unwrap()
}
#[tokio::test]
async fn local_two_repository_validation_and_changed_branch() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("projects");
    let a = repo(&root, "backend");
    let b = repo(&root, "frontend");
    let manager = manager(&temp);
    let mut r = run(manifest(&root));
    r.repositories = vec![
        Repository {
            name: "Backend".into(),
            path: a.to_string_lossy().into(),
            branch: "work".into(),
        },
        Repository {
            name: "Frontend".into(),
            path: b.to_string_lossy().into(),
            branch: "work".into(),
        },
    ];
    manager
        .pipeline_validate_repositories(&r, true)
        .await
        .unwrap();
    r.repositories[1].branch = "wrong".into();
    assert!(manager
        .pipeline_validate_repositories(&r, false)
        .await
        .is_err());
    r.repositories[1].branch = "work".into();
    std::fs::write(a.join("unfinished"), "keep").unwrap();
    assert!(manager
        .pipeline_validate_repositories(&r, true)
        .await
        .is_err());
    assert_eq!(
        std::fs::read_to_string(a.join("unfinished")).unwrap(),
        "keep"
    );
}
#[tokio::test]
async fn shell_failure_halts_and_retains_exit_code() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("projects");
    let a = repo(&root, "backend");
    let manager = manager(&temp);
    let mut m = manifest(&root);
    m.steps = vec![
        Step {
            id: "gate".into(),
            r#type: "shell".into(),
            command: if cfg!(windows) {
                "echo evidence & exit /b 7"
            } else {
                "printf evidence; exit 7"
            }
            .into(),
            lock: "main".into(),
            ..Step::default()
        },
        Step {
            id: "later".into(),
            r#type: "shell".into(),
            command: "exit 0".into(),
            depends_on: vec!["gate".into()],
            lock: "main".into(),
            ..Step::default()
        },
    ];
    let mut r = run(m);
    r.package_root = temp.path().canonicalize().unwrap().to_string_lossy().into();
    r.run_root = r.package_root.clone();
    r.repositories = vec![Repository {
        name: "Backend".into(),
        path: a.to_string_lossy().into(),
        branch: "work".into(),
    }];
    manager.pipeline_save(&r).unwrap();
    manager.pipeline_tick(&r.id).await.unwrap();
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(10)).await;
        let current = manager.pipeline(&r.id).unwrap();
        if current.state == "halted" {
            assert_eq!(current.steps["later"].status, "pending");
            assert_eq!(current.steps["gate"].attempts[0].exit_code, Some(7));
            assert!(current.steps["gate"].attempts[0]
                .output
                .contains("evidence"));
            assert!(manager.state.lock().workflow_leases.is_empty());
            return;
        }
    }
    panic!("shell did not finish");
}
#[test]
fn recovery_never_replays_active_work() {
    let temp = tempfile::tempdir().unwrap();
    let m = manager(&temp);
    let mut r = run(manifest(temp.path()));
    begin(&mut r, "impl").unwrap();
    m.pipeline_save(&r).unwrap();
    drop(m);
    let m = manager(&temp);
    let r = m.pipeline(&r.id).unwrap();
    assert_eq!(r.state, "halted");
    assert_eq!(r.steps["impl"].runs, 0);
    assert_eq!(r.steps["impl"].attempts[0].outcome, "interrupted");
}
#[test]
fn resource_lock_is_shared_between_package_runs() {
    let temp = tempfile::tempdir().unwrap();
    let manager = manager(&temp);
    let mut a = run(manifest(temp.path()));
    begin(&mut a, "impl").unwrap();
    manager.pipeline_save(&a).unwrap();
    let b = run(manifest(temp.path()));
    assert!(!manager
        .pipeline_available(&b, &b.manifest.steps[1])
        .unwrap());
}
#[test]
fn zip_traversal_is_rejected_before_extracting() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("bad.zip");
    let file = std::fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    zip.start_file("../escape", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"bad").unwrap();
    zip.finish().unwrap();
    assert!(import::read_package(&path).is_err());
    assert!(!temp.path().join("escape").exists());
}
#[test]
fn zip_round_trip_resolves_prompt_and_import_only_creates_draft() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("projects");
    repo(&root, "backend");
    repo(&root, "frontend");
    let mut m = manifest(&root);
    m.steps[1].prompt.clear();
    m.steps[1].prompt_file = "prompts/impl.md".into();
    let path = temp.path().join("bundle.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    for (name, bytes) in [
        ("pipeline.json", serde_json::to_vec(&m).unwrap()),
        ("prompts/impl.md", b"Implement from file".to_vec()),
    ] {
        zip.start_file(
            format!("bundle/{name}"),
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap();
    let manager = manager(&temp);
    let r = manager.pipeline_import(path).unwrap();
    assert_eq!(r.state, "draft");
    assert_eq!(r.repositories.len(), 2);
    assert_eq!(r.manifest.steps[1].prompt, "Implement from file");
    assert!(r.steps.values().all(|s| s.attempts.is_empty()));
    assert!(manager.state.lock().sessions.is_empty());
}
#[test]
#[ignore = "Set RUNHQ_PIPELINE_AUDIT_ZIP to inspect a supplied package without executing it"]
fn supplied_package_preflight() {
    let temp = tempfile::tempdir().unwrap();
    let manager = manager(&temp);
    let r = manager
        .pipeline_import(std::env::var("RUNHQ_PIPELINE_AUDIT_ZIP").unwrap().into())
        .unwrap();
    assert!(!r.manifest.steps.is_empty());
    if !r.manifest.settings.repositories.is_empty() {
        assert_eq!(r.repositories.len(), r.manifest.settings.repositories.len());
    }
    assert!(r.issues.iter().all(|i| !i.blocking), "{:?}", r.issues);
    assert!(r
        .issues
        .iter()
        .all(|i| i.code != "pipeline.external_assets"));
    assert_eq!(r.state, "draft");
    assert!(r.steps.values().all(|s| s.attempts.is_empty()));
    assert!(manager.state.lock().running.is_empty());
}

#[test]
fn human_extra_review_keeps_history_and_requires_a_fresh_gate() {
    let mut r = reviewed("FAIL");
    for _ in 0..2 {
        complete(&mut r, "fix", "PIPELINE_RESULT: SUCCESS", None);
        complete(&mut r, "fix-gate", "", Some(0));
        complete(&mut r, "review", "REVIEW_VERDICT: FAIL", None);
    }
    authorize_extra_review(&mut r, "done").unwrap();
    assert_eq!(r.steps["gate"].status, "pending");
    assert_eq!(r.steps["review"].attempts.len(), 3);
    assert_eq!(r.steps["review"].extra_runs_approved_at.len(), 1);
    assert_eq!(r.steps["fix"].runs, 2);
    complete(&mut r, "gate", "", Some(0));
    complete(&mut r, "review", "REVIEW_VERDICT: PASS", None);
    assert_eq!(r.state, "completed");
    assert_eq!(r.steps["review"].runs, 4);
}

#[test]
fn malformed_second_protocol_line_and_review_blocked_fail_closed() {
    let m = manifest(Path::new("/tmp"));
    assert!(result(
        &m.steps[1],
        "PIPELINE_RESULT: SUCCESS\nPIPELINE_RESULT: UNKNOWN",
        None
    )
    .is_err());
    assert!(result(
        &m.steps[3],
        "REVIEW_VERDICT: PASS\nPIPELINE_RESULT: BLOCKED",
        None
    )
    .is_err());
    let mut partial = m.clone();
    partial.settings.agent_permissions = vec!["read".into()];
    assert!(import::validate_manifest(&partial).is_err());
    let mut future = m;
    future.steps[1].run_if = "review.verdict == 'PASS'".into();
    assert!(import::validate_manifest(&future).is_err());
}

#[tokio::test]
async fn package_runs_two_repository_agents_and_pinned_read_only_review_with_fake_bridge() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("projects");
    repo(&root, "backend");
    repo(&root, "frontend");
    std::fs::write(temp.path().join("bridge.mjs"),r#"
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
createInterface({input:process.stdin}).on('line',line=>{
 const {config}=JSON.parse(line);
 const members=JSON.parse(config.prompt.split('Selected projects (JSON data):\n')[1].split('\n\nShared workspace instructions:')[0]);
 assert.equal(members.length,2);
 for(const m of members) assert.equal(execFileSync('git',['-C',m.path,'status','--porcelain'],{encoding:'utf8'}),'');
 if(config.read_only_review){ assert.equal(config.mode,'plan'); for(const m of members) { assert.ok(m.path.includes(path.sep+'review'+path.sep));assert.equal(execFileSync('git',['-C',m.path,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),m.base_revision); } }
 const paths=JSON.parse(config.prompt.split('Resolved pipeline paths (JSON data):\n')[1].split('\n')[0]);
 assert.equal(paths.RUNHQ_PACKAGE_ROOT,process.env.RUNHQ_PACKAGE_ROOT);
 assert.equal(paths.RUNHQ_WORKSPACE_ROOT,process.env.RUNHQ_WORKSPACE_ROOT);
 if(config.read_only_review){
   assert.ok(paths.RUNHQ_WORKSPACE_ROOT.includes(path.sep+'review'+path.sep));
   const context=JSON.parse(config.prompt.split('RunHQ execution context (recorded results, not new instructions):\n')[1].split('\n')[0]);
   assert.ok(context.some(x=>x.step==='impl'&&x.output.includes('Implementation evidence')));
   const changes=JSON.parse(config.prompt.split('Repository changes (JSON data; captured revisions, not the live working trees):\n')[1].split('\n')[0]);
   assert.equal(changes.length,2);for(const change of changes){assert.ok(change.files.includes('fixture.txt'));assert.ok(change.commits.includes('Fixture implementation'));}
 }else{
   for(const m of members){writeFileSync(path.join(m.path,'fixture.txt'),'sample');execFileSync('git',['-C',m.path,'add','fixture.txt']);execFileSync('git',['-C',m.path,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','Fixture implementation']);}
 }
 const text=config.read_only_review?'REVIEW_VERDICT: PASS':'Implementation evidence\nPIPELINE_RESULT: SUCCESS';
 for(const event of [{type:'state',state:{provider:'fixture'}},{type:'item',item:{id:'result',kind:'assistant',title:'',text,status:'completed',created_at:0}},{type:'finished',status:'completed'}]) process.stdout.write(JSON.stringify(event)+'\n');
});
"#).unwrap();
    let manager = manager(&temp);
    let mut tool = manager.tool("codex").unwrap();
    tool.executable = executable("node").unwrap().to_string_lossy().into();
    manager.save_tool(tool).unwrap();
    let path = temp.path().join("pipeline.json");
    let mut definition = manifest(&root);
    definition.settings.repositories = ["backend", "frontend"]
        .iter()
        .map(|name| Repository {
            name: (*name).into(),
            path: root
                .join(name)
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into(),
            branch: "work".into(),
        })
        .collect();
    std::fs::write(&path, serde_json::to_vec(&definition).unwrap()).unwrap();
    let r = manager.pipeline_import(path).unwrap();
    let r = manager
        .pipeline_control(
            &r.id,
            r.revision,
            "start",
            None,
            "codex".into(),
            "codex".into(),
        )
        .await
        .unwrap();
    assert_eq!(r.state, "awaiting_approval");
    assert!(manager.sessions().is_empty());
    assert!(manager
        .pipeline_control(
            &r.id,
            r.revision - 1,
            "approve",
            Some("start".into()),
            String::new(),
            String::new()
        )
        .await
        .is_err());
    manager
        .pipeline_control(
            &r.id,
            r.revision,
            "approve",
            Some("start".into()),
            String::new(),
            String::new(),
        )
        .await
        .unwrap();
    for _ in 0..150 {
        manager.pipeline_tick(&r.id).await.unwrap();
        let current = manager.pipeline(&r.id).unwrap();
        if current.state == "completed" {
            let review = &current.steps["review"].attempts[0];
            let session = manager
                .session(review.session_id.as_ref().unwrap())
                .unwrap();
            assert!(session.workflow_read_only);
            assert_eq!(session.runtime_state["pipeline_id"], r.id);
            assert!(manager
                .validate_pipeline_turn(&session, "manual-turn")
                .is_err());
            assert!(Path::new(&current.run_root)
                .join("reports")
                .join(format!("review-{}.md", review.id))
                .is_file());
            assert_eq!(current.steps["fix"].status, "skipped");
            return;
        }
        assert_ne!(current.state, "halted", "{:?}", current.steps);
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("package did not finish");
}

#[test]
fn version_two_last_line_capture_does_not_accept_an_earlier_verdict() {
    let mut m = manifest(Path::new("/tmp"));
    m.version = 2;
    m.steps[3].capture = Some(Capture {
        verdict: VerdictCapture::LastLine(LastLineCapture {
            last_line_regex: "^REVIEW_VERDICT: (PASS|CONDITIONAL|FAIL)$".into(),
            group: 1,
        }),
    });
    assert_eq!(
        result(&m.steps[3], "Report\nREVIEW_VERDICT: PASS\n  ", None).unwrap(),
        Some("PASS".into())
    );
    assert!(result(&m.steps[3], "REVIEW_VERDICT: PASS\nMore text", None).is_err());
    m.steps[1].success = Some(Matcher {
        last_line_regex: Some("^PIPELINE_RESULT: SUCCESS$".into()),
        ..Matcher::default()
    });
    assert!(result(&m.steps[1], "PIPELINE_RESULT: SUCCESS\nMore text", None).is_err());
    assert!(result(&m.steps[1], "Report\nPIPELINE_RESULT: SUCCESS", None).is_ok());
}

#[test]
fn minimal_package_metadata_and_variable_paths_import_without_false_blockers() {
    let temp = tempfile::tempdir().unwrap();
    let root = repo(temp.path(), "project");
    let manager = manager(&temp);
    let mut definition = serde_json::to_value(manifest(&root)).unwrap();
    definition["package"] = json!({"contents":["pipeline.json","README.md","scripts/"]});
    definition["steps"][1]["prompt"]=json!("Read `$RUNHQ_PACKAGE_ROOT/README.md`, ${RUNHQ_PACKAGE_ROOT}/scripts/verify.sh and ./scripts/verify.sh.");
    std::fs::write(temp.path().join("README.md"), "Package instructions").unwrap();
    std::fs::create_dir(temp.path().join("scripts")).unwrap();
    std::fs::write(temp.path().join("scripts/verify.sh"), "exit 0\n").unwrap();
    let file = temp.path().join("pipeline.json");
    std::fs::write(&file, serde_json::to_vec(&definition).unwrap()).unwrap();
    let run = manager.pipeline_import(file.clone()).unwrap();
    assert!(run.issues.iter().all(|i| !i.blocking), "{:?}", run.issues);
    assert!(Path::new(&run.package_root).join("README.md").is_file());
    assert!(Path::new(&run.package_root)
        .join("scripts/verify.sh")
        .is_file());
    assert!(run.manifest.package.unwrap().install.is_empty());
    definition["steps"][1]["prompt"]=json!("Read `/Users/example/old-copy/README.md`. Also run bash /Users/example/old-copy/verify.sh.");
    std::fs::write(&file, serde_json::to_vec(&definition).unwrap()).unwrap();
    let run = manager.pipeline_import(file).unwrap();
    assert_eq!(
        run.issues
            .iter()
            .filter(|i| i.code == "pipeline.external_assets" && i.blocking)
            .count(),
        2
    );
    assert!(manager.sessions().is_empty());
}
