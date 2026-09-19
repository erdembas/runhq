use super::*;
use std::collections::BTreeMap;

fn setup() -> (tempfile::TempDir, Arc<AgentManager>, AgentSession) {
    let dir = tempfile::tempdir().unwrap();
    let manager = Arc::new(
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap(),
    );
    let project = manager
        .add_project("Example".into(), dir.path().into())
        .unwrap();
    let session = AgentSession {
        id: "session-a".into(),
        project_id: project.id,
        project_name: project.name,
        cwd: project.path,
        backend: "codex".into(),
        adapter: "codex".into(),
        backend_name: "Codex".into(),
        args: vec![],
        env: Default::default(),
        executable: "codex".into(),
        title: "Task".into(),
        model: String::new(),
        effort: String::new(),
        mode: "default".into(),
        agent: String::new(),
        native_id: None,
        status: "idle".into(),
        created_at: now(),
        updated_at: now(),
        revision: 1,
        archived: false,
        unread: false,
        last_error: None,
        isolated: false,
        branch: None,
        usage: Value::Null,
        base_revision: None,
        pre_existing_paths: vec![],
        turn_started_at: None,
        last_turn_ms: None,
        total_run_ms: 0,
        runtime_state: Value::Null,
        workflow_read_only: false,
        pending: vec![],
    };
    {
        let mut state = manager.state.lock();
        state.db.save(&session).unwrap();
        state.sessions.insert(session.id.clone(), session.clone());
    }
    (dir, manager, session)
}

#[test]
fn project_identity_is_canonical_and_independent_of_service_name() {
    let (dir, manager, session) = setup();
    let duplicate = manager
        .add_project("Different service".into(), dir.path().join("."))
        .unwrap();
    assert_eq!(duplicate.id, session.project_id);
    assert_eq!(manager.projects().unwrap().len(), 1);
}

#[test]
fn session_metadata_does_not_load_transcript_rows() {
    let (_dir, manager, session) = setup();
    manager
        .state
        .lock()
        .db
        .conn
        .execute(
            "INSERT INTO agent_items(session_id,item_id,data) VALUES(?1,'invalid','invalid json')",
            [&session.id],
        )
        .unwrap();
    assert_eq!(manager.session(&session.id).unwrap().title, session.title);
    assert!(manager.snapshot(&session.id, None).is_err());
    assert!(manager.session("missing").is_err());
}

#[tokio::test]
#[cfg(unix)]
async fn backend_version_probes_run_concurrently_and_preserve_tool_order() {
    use std::os::unix::fs::PermissionsExt;

    let (dir, manager, _session) = setup();
    manager.state.lock().tools.retain(|id, _| id != "cursor");
    // A probe only completes after the other probes have started. Serial
    // discovery times out here without relying on a wall-clock assertion.
    let script = r#"#!/bin/sh
dir=${0%/*}
touch "$0.started"
while [ ! -f "$dir/claude.started" ] || [ ! -f "$dir/codex.started" ] || [ ! -f "$dir/opencode.started" ]; do
    sleep 0.01
done
echo '1.0.0'
"#;
    for id in ["claude", "codex", "opencode"] {
        let path = dir.path().join(id);
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut tool = manager.tool(id).unwrap();
        tool.executable = path.to_string_lossy().into_owned();
        manager.save_tool(tool).unwrap();
    }
    let backends = manager.detect().await;
    assert_eq!(
        backends
            .iter()
            .map(|backend| backend.id.as_str())
            .collect::<Vec<_>>(),
        ["claude", "codex", "opencode"],
    );
    assert!(backends
        .iter()
        .all(|backend| backend.version.as_deref() == Some("1.0.0")));
}

#[test]
fn concurrent_requests_resolve_individually_and_survive_snapshot() {
    let (_dir, manager, session) = setup();
    for (id, kind) in [("1", "approval"), ("2", "question")] {
        manager
            .apply_event(
                &session.id,
                "turn",
                json!({"type":"request","request":{"id":id,"kind":kind,"title":"Input needed"}}),
            )
            .unwrap();
    }
    let s = manager.snapshot(&session.id, None).unwrap();
    assert_eq!(s.session.status, "waiting_input");
    assert_eq!(s.session.pending.len(), 2);
    manager
        .apply_event(&session.id, "old-turn", json!({"type":"resolved","id":"2"}))
        .unwrap();
    assert_eq!(
        manager
            .snapshot(&session.id, None)
            .unwrap()
            .session
            .pending
            .len(),
        2
    );
    manager
        .apply_event(&session.id, "turn", json!({"type":"resolved","id":"2"}))
        .unwrap();
    assert_eq!(
        manager.snapshot(&session.id, None).unwrap().session.status,
        "waiting_permission"
    );
    manager
        .apply_event(&session.id, "turn", json!({"type":"resolved","id":"1"}))
        .unwrap();
    assert_eq!(
        manager.snapshot(&session.id, None).unwrap().session.status,
        "running"
    );
}

#[test]
fn restart_does_not_replay_turns_or_restore_stale_approvals() {
    let (dir, manager, session) = setup();
    manager
        .apply_event(
            &session.id,
            "turn",
            json!({"type":"native","id":"native-session"}),
        )
        .unwrap();
    manager
        .apply_event(
            &session.id,
            "turn",
            json!({"type":"request","request":{"id":"1","kind":"approval","title":"Execute?"}}),
        )
        .unwrap();
    manager
        .mutate(&session.id, |s, _| {
            s.turn_started_at = Some(now() - 60_000);
            Ok(())
        })
        .unwrap();
    drop(manager);
    let reopened =
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap();
    let s = reopened.snapshot(&session.id, None).unwrap().session;
    assert_eq!(s.status, "interrupted");
    assert!(s.pending.is_empty());
    assert!(s.unread);
    assert_eq!(s.native_id.as_deref(), Some("native-session"));
    // The turn's real end is unknown after a crash, so the measurement is dropped rather than
    // guessed from the last activity timestamp.
    assert_eq!(s.turn_started_at, None);
    assert_eq!(s.total_run_ms, 0);
    assert_eq!(s.last_turn_ms, None);
}

#[test]
fn transcript_upserts_and_paginates_without_losing_turn_identity() {
    let (_dir, manager, session) = setup();
    for n in 0..205 {
        manager.apply_event(&session.id, "turn", json!({"type":"item","item":{"id":n.to_string(),"kind":"assistant","title":"Agent","text":"first","status":"running"}})).unwrap();
    }
    manager.apply_event(&session.id, "turn", json!({"type":"item","item":{"id":"204","kind":"assistant","title":"Agent","text":"complete","status":"completed"}})).unwrap();
    let latest = manager.snapshot(&session.id, None).unwrap();
    assert_eq!(latest.items.len(), 200);
    assert_eq!(latest.items.last().unwrap().text, "complete");
    let older = manager.snapshot(&session.id, latest.before).unwrap();
    assert_eq!(older.items.len(), 5);
    assert!(older.before.is_none());
    manager.apply_event(&session.id, "next-turn", json!({"type":"item","item":{"id":"204","kind":"assistant","title":"Agent","text":"different turn","status":"completed"}})).unwrap();
    assert_eq!(
        manager
            .snapshot(&session.id, None)
            .unwrap()
            .items
            .last()
            .unwrap()
            .text,
        "different turn"
    );
}

#[test]
fn active_sessions_cannot_be_archived_and_cancelling_is_sticky() {
    let (_dir, manager, session) = setup();
    manager
        .mutate(&session.id, |s, _| {
            s.status = "cancelling".into();
            Ok(())
        })
        .unwrap();
    manager
        .apply_event(
            &session.id,
            "turn",
            json!({"type":"status","status":"running"}),
        )
        .unwrap();
    assert_eq!(
        manager.snapshot(&session.id, None).unwrap().session.status,
        "cancelling"
    );
    assert!(manager
        .update(&session.id, None, Some(true), false)
        .is_err());
}

#[tokio::test]
async fn ended_session_rejects_permission_responses() {
    let (_dir, manager, session) = setup();
    assert!(manager
        .answer(&session.id, "old:1", json!({"decision":"accept"}))
        .await
        .is_err());
}

#[tokio::test]
async fn actor_routes_answers_and_persists_a_turn_without_ui() {
    if executable("node").is_none() {
        eprintln!(
            "Node is unavailable; runtime integration is covered by the agent-runtime test job"
        );
        return;
    }
    let (dir, manager, session) = setup();
    std::fs::write(dir.path().join("bridge.cjs"), r#"
const readline = require('node:readline');
const emit = x => process.stdout.write(JSON.stringify(x)+'\n');
readline.createInterface({input:process.stdin}).on('line', line => {
const c = JSON.parse(line);
if(c.type === 'start') {
emit({type:'native', id:'native-one'});
emit({type:'request', request:{id:'q',kind:'question',title:'Choose',questions:[{id:'choice',secret:false}]}});
} else if(c.type === 'answer') {
emit({type:'resolved',id:'q'});emit({type:'ack',command_id:c.command_id});
emit({type:'item',item:{id:'final',kind:'assistant',title:'Agent',text:'Answer received',status:'completed'}});
setTimeout(()=>{emit({type:'finished',status:'completed'});process.exit(0);},30);
} else if(c.type === 'interrupt') { emit({type:'ack',command_id:c.command_id});emit({type:'finished',status:'cancelled'});process.exit(0); }
});
"#).unwrap();
    let request_id = uuid::Uuid::new_v4().to_string();
    let input = || AgentTurnInput {
        session_id: session.id.clone(),
        request_id: request_id.clone(),
        prompt: "Test".into(),
        model: String::new(),
        effort: String::new(),
        mode: None,
        agent: None,
        attachments: vec![],
    };
    manager.start(input()).await.unwrap();
    manager.start(input()).await.unwrap(); // idempotent retry, not another process
    let waiting = wait_for_session(&manager, &session.id, "a pending question", |session| {
        !session.pending.is_empty()
    })
    .await
    .unwrap();
    let request = &waiting.pending[0];
    manager
        .answer(
            &session.id,
            &request.id,
            json!({"answers":{"choice":["yes"]}}),
        )
        .await
        .unwrap();
    wait_inactive(&manager, &session.id).await;
    let snapshot = manager.snapshot(&session.id, None).unwrap();
    assert_eq!(snapshot.session.status, "completed");
    assert_eq!(snapshot.session.native_id.as_deref(), Some("native-one"));
    assert_eq!(
        snapshot.items.iter().filter(|i| i.text == "Test").count(),
        1
    );
    assert!(snapshot.items.iter().any(|i| i.text == "Answer received"));
    assert!(manager
        .answer(
            &session.id,
            &request.id,
            json!({"answers":{"choice":["no"]}})
        )
        .await
        .is_err());
}

fn turn_input(session: &AgentSession) -> AgentTurnInput {
    AgentTurnInput {
        session_id: session.id.clone(),
        request_id: uuid::Uuid::new_v4().to_string(),
        prompt: "Integration check".into(),
        model: String::new(),
        effort: String::new(),
        mode: None,
        agent: None,
        attachments: vec![],
    }
}

#[tokio::test]
async fn image_attachments_reach_runtime_without_persisting_image_bytes_in_transcript() {
    let (dir, manager, session) = setup();
    std::fs::write(
        dir.path().join("bridge.cjs"),
        r#"
const assert = require('node:assert/strict');
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const command=JSON.parse(line); if(command.type!=='start') return;
 assert.deepEqual(command.config.attachments,[{name:'screenshot.png',mime_type:'image/png',data:'aGVsbG8='}]);
 assert.equal(command.config.read_only_review,false);
 assert.equal(command.config.prompt,'Inspect screenshot');
 process.stdout.write(JSON.stringify({type:'finished',status:'completed'})+'\n',()=>process.exit(0));
});
"#,
    ).unwrap();
    let mut input = turn_input(&session);
    input.prompt = "Inspect screenshot".into();
    input.attachments = vec![AgentAttachment {
        name: "screenshot.png".into(),
        mime_type: "image/png".into(),
        data: "aGVsbG8=".into(),
    }];
    manager.start(input).await.unwrap();
    let completed = wait_for_session(
        &manager,
        &session.id,
        "an image turn completion",
        |session| session.status == "completed",
    )
    .await
    .unwrap();
    assert!(completed.last_error.is_none());
    let snapshot = manager.snapshot(&session.id, None).unwrap();
    assert!(snapshot
        .items
        .iter()
        .any(|item| item.text == "Inspect screenshot"));
    assert!(!serde_json::to_string(&snapshot)
        .unwrap()
        .contains("aGVsbG8="));
}

#[tokio::test]
async fn invalid_image_turn_is_retryable_and_never_reserves_or_persists_a_request() {
    let (_dir, manager, session) = setup();
    let mut input = turn_input(&session);
    let request_id = input.request_id.clone();
    input.attachments = vec![AgentAttachment {
        name: "screenshot.png".into(),
        mime_type: "image/png".into(),
        data: "invalid".into(),
    }];
    assert!(manager
        .start(input)
        .await
        .unwrap_err()
        .to_string()
        .contains("Image data is invalid"));
    assert_eq!(manager.session(&session.id).unwrap().status, "idle");
    assert!(manager
        .state
        .lock()
        .db
        .request_owner(&request_id)
        .unwrap()
        .is_none());
    assert!(manager
        .snapshot(&session.id, None)
        .unwrap()
        .items
        .is_empty());
}
async fn wait_for_session(
    manager: &AgentManager,
    id: &str,
    expected: &str,
    ready: impl Fn(&AgentSession) -> bool,
) -> Result<AgentSession, String> {
    // Hosted Windows runners can take several seconds to start a fresh Node
    // process while parallel tests initialize databases. Poll metadata only;
    // reloading transcripts here adds unrelated disk work to that startup.
    let diagnostic = || match manager.session(id) {
        Ok(session) => format!(
            "status={}, last_error={:?}, native_id={:?}, pending={}",
            session.status,
            session.last_error,
            session.native_id,
            session.pending.len()
        ),
        Err(error) => error.to_string(),
    };
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let session = manager.session(id).map_err(|error| error.to_string())?;
            if ready(&session) {
                return Ok(session);
            }
            if !session.active() {
                return Err(format!(
                    "Session {id} ended before {expected}: {}",
                    diagnostic()
                ));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        Err(format!(
            "Timed out after 30s waiting for {expected} in session {id}: {}",
            diagnostic()
        ))
    })
}

async fn wait_inactive(manager: &AgentManager, id: &str) {
    wait_for_session(manager, id, "the turn to end", |session| !session.active())
        .await
        .unwrap();
}
#[tokio::test]
async fn checkout_lease_rejects_parallel_writers_and_releases_after_stop() {
    if executable("node").is_none() {
        return;
    }
    let (dir, manager, first) = setup();
    std::fs::write(dir.path().join("bridge.cjs"), r#"
const readline=require('node:readline');const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);if(c.type==='start')emit({type:'status',status:'running'});if(c.type==='interrupt'){emit({type:'ack',command_id:c.command_id});emit({type:'finished',status:'cancelled'});}});
"#).unwrap();
    let mut second = first.clone();
    second.id = "second".into();
    {
        let mut state = manager.state.lock();
        state.db.save(&second).unwrap();
        state.sessions.insert(second.id.clone(), second.clone());
    }
    manager.start(turn_input(&first)).await.unwrap();
    let error = manager.start(turn_input(&second)).await.unwrap_err();
    assert!(error.to_string().contains("owns this checkout"));
    manager.interrupt(&first.id).await.unwrap();
    wait_inactive(&manager, &first.id).await;
    assert_eq!(
        manager.snapshot(&first.id, None).unwrap().session.status,
        "cancelled"
    );
    manager.start(turn_input(&second)).await.unwrap();
    manager.interrupt(&second.id).await.unwrap();
    wait_inactive(&manager, &second.id).await;
    assert!(manager.state.lock().running.is_empty());
}
#[tokio::test]
async fn abnormal_bridge_exit_marks_failure_and_releases_checkout() {
    if executable("node").is_none() {
        return;
    }
    let (dir, manager, session) = setup();
    std::fs::write(
        dir.path().join("bridge.cjs"),
        "process.stdin.once('data',()=>process.exit(13));",
    )
    .unwrap();
    manager.start(turn_input(&session)).await.unwrap();
    let failure = wait_for_session(&manager, &session.id, "a pending question", |session| {
        !session.pending.is_empty()
    })
    .await
    .unwrap_err();
    assert!(
        failure.contains("ended before a pending question"),
        "{failure}"
    );
    assert!(failure.contains("status=failed"), "{failure}");
    assert!(failure.contains("disconnected"), "{failure}");
    let snapshot = manager.snapshot(&session.id, None).unwrap();
    assert_eq!(snapshot.session.status, "failed");
    assert!(snapshot
        .session
        .last_error
        .unwrap()
        .contains("disconnected"));
    assert!(manager.state.lock().running.is_empty());
}
#[tokio::test]
async fn git_commands_clear_repository_environment_without_mutating_the_parent() {
    let dir = tempfile::tempdir().unwrap();
    git_output(dir.path(), &["init"]).await.unwrap();
    std::fs::write(dir.path().join("tracked.txt"), "fixture").unwrap();
    let parent_index = std::env::var_os("GIT_INDEX_FILE");
    let wrong_index = dir.path().join("missing/index");
    let mut command = Command::new("git");
    command
        .args(["add", "tracked.txt"])
        .env("GIT_INDEX_FILE", &wrong_index)
        .env("GIT_DIR", dir.path().join("missing/repo"));
    // Seed the child directly so the regression test stays safe alongside
    // concurrent tests, then apply the same setup used by agent Git calls.
    crate::git::configure_git_cmd(command.as_std_mut(), dir.path());
    let output = command.output().await.unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(dir.path().join(".git/index").is_file());
    assert!(!wrong_index.exists());
    assert_eq!(
        git_output(dir.path(), &["ls-files"]).await.unwrap().trim(),
        "tracked.txt"
    );
    assert_eq!(std::env::var_os("GIT_INDEX_FILE"), parent_index);
}

#[tokio::test]
async fn isolated_worktree_preserves_original_uncommitted_files() {
    let (dir, manager, session) = setup();
    git_output(dir.path(), &["init"]).await.unwrap();
    std::fs::write(dir.path().join("tracked.txt"), "committed").unwrap();
    git_output(dir.path(), &["add", "tracked.txt"])
        .await
        .unwrap();
    git_output(
        dir.path(),
        &[
            "-c",
            "user.name=RunHQ Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "fixture",
        ],
    )
    .await
    .unwrap();
    std::fs::write(dir.path().join("tracked.txt"), "local edit").unwrap();
    let created = manager
        .create(CreateAgentSession {
            creation_request_id: None,
            project_id: session.project_id.clone(),
            backend: "codex".into(),
            executable: executable("git").unwrap().to_string_lossy().into(),
            title: "Isolated task".into(),
            model: String::new(),
            effort: String::new(),
            mode: "default".into(),
            agent: String::new(),
            isolated: true,
        })
        .await
        .unwrap();
    assert!(created.branch.unwrap().starts_with("codex/runhq-"));
    assert_eq!(
        std::fs::read_to_string(Path::new(&created.cwd).join("tracked.txt")).unwrap(),
        "committed"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("tracked.txt")).unwrap(),
        "local edit"
    );
    // The isolated checkout starts from committed HEAD, so nothing there predates the task.
    assert!(created.base_revision.is_some());
    assert!(created.pre_existing_paths.is_empty());

    // A task on the local workspace inherits the edit that was already there, and says so, rather
    // than letting Changes present it as the agent's work.
    let local = manager
        .create(CreateAgentSession {
            creation_request_id: None,
            project_id: session.project_id,
            backend: "codex".into(),
            executable: executable("git").unwrap().to_string_lossy().into(),
            title: "Local task".into(),
            model: String::new(),
            effort: String::new(),
            mode: "default".into(),
            agent: String::new(),
            isolated: false,
        })
        .await
        .unwrap();
    assert_eq!(local.base_revision, created.base_revision);
    assert_eq!(local.pre_existing_paths, vec!["tracked.txt".to_string()]);
}
#[test]
fn newer_database_version_is_not_downgraded() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("agents.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA user_version=3;").unwrap();
    drop(conn);
    assert!(AgentDb::open(&path).is_err());
}

#[test]
fn a_second_manager_cannot_recover_another_live_managers_sessions() {
    let (dir, manager, _session) = setup();
    assert!(
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).is_err()
    );
    drop(manager);
    assert!(
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).is_ok()
    );
}

#[test]
fn tool_registry_persists_disabled_and_custom_tools_without_losing_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let manager =
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap();
    let mut codex = manager.tool("codex").unwrap();
    codex.enabled = false;
    manager.save_tool(codex).unwrap();
    let tool = AgentTool {
        id: "custom-agent".into(),
        name: "Custom agent".into(),
        adapter: "terminal".into(),
        executable: "test-agent".into(),
        args: vec!["a value with spaces".into()],
        env: Default::default(),
        enabled: true,
    };
    manager.save_tool(tool.clone()).unwrap();
    drop(manager);
    let manager =
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap();
    assert_eq!(manager.tools().len(), 5);
    let cursor = manager.tool("cursor").unwrap();
    assert_eq!(cursor.adapter, "acp");
    assert_eq!(cursor.executable, "agent");
    assert_eq!(cursor.args, vec!["acp"]);
    let mut invalid_cursor = cursor;
    invalid_cursor.adapter = "terminal".into();
    assert!(manager.save_tool(invalid_cursor).is_err());
    assert!(manager.tool("codex").is_err());
    assert_eq!(manager.tool("custom-agent").unwrap().args, tool.args);
    let mut invalid = manager.tool("claude").unwrap();
    invalid.adapter = "terminal".into();
    assert!(manager.save_tool(invalid).is_err());
    let mut invalid = tool;
    invalid.args = vec!["bad\0arg".into()];
    assert!(manager.save_tool(invalid).is_err());
}

#[test]
fn connection_environment_selects_an_account_without_shadowing_runhq_or_path() {
    let dir = tempfile::tempdir().unwrap();
    let manager =
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap();
    let account = |env: BTreeMap<String, String>| AgentTool {
        id: "codex-second-account".into(),
        name: "Codex (second account)".into(),
        adapter: "codex".into(),
        executable: "codex".into(),
        args: vec![],
        env,
        enabled: true,
    };
    // A second account for the same product is an ordinary connection with its own config home.
    let valid = account(BTreeMap::from([(
        "CODEX_HOME".into(),
        "/fixture/second".into(),
    )]));
    manager.save_tool(valid.clone()).unwrap();
    assert_eq!(
        manager.tool("codex-second-account").unwrap().env,
        valid.env,
        "the configured account survives a save"
    );

    // RunHQ resolves executables and owns its bridge variables, so these cannot be taken over.
    for reserved in ["PATH", "RUNHQ_AGENT_PROCESS_GROUP"] {
        assert!(manager
            .save_tool(account(BTreeMap::from([(
                reserved.into(),
                "/somewhere".into()
            )])))
            .is_err());
    }
    for bad_name in ["", "2HOME", "WITH SPACE", "WITH-DASH"] {
        assert!(manager
            .save_tool(account(BTreeMap::from([(bad_name.into(), "value".into())])))
            .is_err());
    }
    assert!(manager
        .save_tool(account(BTreeMap::from([(
            "CODEX_HOME".into(),
            "bad\0value".into()
        )])))
        .is_err());
    assert!(
        manager
            .save_tool(account(
                (0..33)
                    .map(|i| (format!("VAR_{i}"), "value".into()))
                    .collect()
            ))
            .is_err(),
        "a connection cannot carry an unbounded environment"
    );
    assert_eq!(
        manager.tool("codex-second-account").unwrap().env,
        valid.env,
        "a rejected edit leaves the stored account untouched"
    );
}

#[tokio::test]
#[cfg(unix)]
async fn custom_sessions_snapshot_connection_and_disabled_tools_cannot_start() {
    let (dir, manager, _) = setup();
    let project = manager.projects().unwrap()[0].clone();
    let mut tool = AgentTool {
        id: "custom-acp".into(),
        name: "ACP tool".into(),
        adapter: "acp".into(),
        executable: "/bin/echo".into(),
        args: vec!["--acp".into()],
        env: BTreeMap::from([("ACP_HOME".into(), "/fixture/account-one".into())]),
        enabled: true,
    };
    manager.save_tool(tool.clone()).unwrap();
    let session = manager
        .create(CreateAgentSession {
            creation_request_id: None,
            project_id: project.id,
            backend: tool.id.clone(),
            executable: String::new(),
            title: "Task".into(),
            model: String::new(),
            effort: String::new(),
            mode: "default".into(),
            agent: String::new(),
            isolated: false,
        })
        .await
        .unwrap();
    assert_eq!(
        session.env,
        BTreeMap::from([("ACP_HOME".into(), "/fixture/account-one".into())]),
        "a session records the account it was opened with"
    );
    tool.args = vec!["changed".into()];
    tool.env = BTreeMap::from([("ACP_HOME".into(), "/fixture/account-two".into())]);
    tool.enabled = false;
    manager.save_tool(tool).unwrap();
    let snapshot = manager.snapshot(&session.id, None).unwrap().session;
    assert_eq!(snapshot.args, vec!["--acp"]);
    // Provider-native resume belongs to the account that opened the conversation, so repointing the
    // connection at another account must not move a live session onto it.
    assert_eq!(
        snapshot.env,
        BTreeMap::from([("ACP_HOME".into(), "/fixture/account-one".into())])
    );
    assert_eq!(session.adapter, "acp");
    let error = manager
        .start(AgentTurnInput {
            session_id: session.id,
            request_id: uuid::Uuid::new_v4().to_string(),
            prompt: "Hello".into(),
            model: String::new(),
            effort: String::new(),
            mode: None,
            agent: None,
            attachments: vec![],
        })
        .await
        .unwrap_err();
    assert!(error.to_string().contains("disabled"));
    drop(dir);
}

#[test]
fn version_one_workspace_migrates_without_losing_existing_sessions() {
    let (dir, manager, session) = setup();
    drop(manager);
    let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
    db.execute_batch("DROP TABLE agent_tools; PRAGMA user_version=1; UPDATE agent_sessions SET data=json_remove(data,'$.adapter','$.args','$.backend_name','$.runtime_state');").unwrap();
    drop(db);
    let manager =
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap();
    let restored = manager.snapshot(&session.id, None).unwrap().session;
    assert_eq!(restored.title, session.title);
    assert!(restored.adapter.is_empty());
    assert_eq!(manager.tools().len(), 4);
    manager
        .apply_event(
            &session.id,
            "test",
            json!({"type":"state","state":{"models":{"currentModelId":"example"}}}),
        )
        .unwrap();
    drop(manager);
    let manager =
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap();
    assert_eq!(
        manager
            .snapshot(&session.id, None)
            .unwrap()
            .session
            .runtime_state["models"]["currentModelId"],
        "example"
    );
}

#[test]
fn deleting_conversation_removes_only_its_history_and_survives_restart() {
    let (dir, manager, session) = setup();
    let project_file = dir.path().join("keep.txt");
    std::fs::write(&project_file, "project changes").unwrap();
    let mut other = session.clone();
    other.id = "other-session".into();
    {
        let mut state = manager.state.lock();
        state.db.save(&other).unwrap();
        state.sessions.insert(other.id.clone(), other.clone());
        for s in [&session, &other] {
            state
                .db
                .record_request(&format!("turn-{}", s.id), &s.id)
                .unwrap();
            state
                .db
                .item(
                    &s.id,
                    &AgentItem {
                        id: "message".into(),
                        kind: "user".into(),
                        title: "You".into(),
                        text: "history".into(),
                        status: "completed".into(),
                        created_at: now(),
                    },
                )
                .unwrap();
        }
    }
    manager.delete_session(&session.id).unwrap();
    manager.delete_session(&session.id).unwrap(); // Safe to repeat after a lost IPC response.
    assert!(manager.snapshot(&session.id, None).is_err());
    {
        let state = manager.state.lock();
        assert!(state.db.items(&session.id, None).unwrap().0.is_empty());
        assert!(state
            .db
            .request_owner(&format!("turn-{}", session.id))
            .unwrap()
            .is_none());
    }
    drop(manager);
    let reopened =
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap();
    assert_eq!(reopened.sessions().len(), 1);
    assert_eq!(reopened.snapshot(&other.id, None).unwrap().items.len(), 1);
    assert_eq!(reopened.projects().unwrap().len(), 1);
    assert_eq!(
        std::fs::read_to_string(project_file).unwrap(),
        "project changes"
    );
}

#[test]
fn deleting_conversation_rejects_active_or_still_owned_sessions() {
    let (_dir, manager, session) = setup();
    for status in [
        "starting",
        "running",
        "waiting_input",
        "waiting_permission",
        "cancelling",
    ] {
        manager
            .mutate(&session.id, |s, _| {
                s.status = status.into();
                Ok(())
            })
            .unwrap();
        assert!(manager.delete_session(&session.id).is_err(), "{status}");
    }
    manager
        .mutate(&session.id, |s, _| {
            s.status = "completed".into();
            Ok(())
        })
        .unwrap();
    let (sender, _receiver) = mpsc::channel(1);
    manager.state.lock().running.insert(
        session.id.clone(),
        Running {
            run_id: "finishing".into(),
            cwd: session.cwd.into(),
            sender,
        },
    );
    assert!(manager.delete_session(&session.id).is_err());
    assert!(manager.snapshot(&session.id, None).is_ok());
}

#[test]
fn deleting_conversation_rolls_back_all_history_on_database_failure() {
    let (_dir, manager, session) = setup();
    {
        let state = manager.state.lock();
        state.db.record_request("keep-turn", &session.id).unwrap();
        state.db.conn.execute_batch("CREATE TRIGGER prevent_session_delete BEFORE DELETE ON agent_sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    }
    assert!(manager.delete_session(&session.id).is_err());
    assert!(manager.snapshot(&session.id, None).is_ok());
    assert_eq!(
        manager.state.lock().db.request_owner("keep-turn").unwrap(),
        Some(session.id)
    );
}

#[tokio::test]
#[cfg(unix)]
async fn discovery_preserves_found_paths_and_distinguishes_missing_blocked_and_available() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("custom-cli");
    let tool = AgentTool {
        id: "custom".into(),
        name: "Custom".into(),
        adapter: "codex".into(),
        executable: script.to_string_lossy().into_owned(),
        args: vec![],
        env: Default::default(),
        enabled: true,
    };
    let missing = detect_tool(Some(tool.clone()), &Some("Agent runtime is missing".into()))
        .await
        .unwrap();
    assert_eq!(missing.detection_status, AgentDetectionStatus::NotFound);
    assert!(missing.executable.is_none());
    assert!(missing.error.unwrap().contains("Executable not found"));
    std::fs::write(&script, "#!/bin/sh\necho 1.2.3\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let found = detect_tool(Some(tool.clone()), &None).await.unwrap();
    assert_eq!(found.detection_status, AgentDetectionStatus::Available);
    assert_eq!(found.detection_source, Some(AgentDetectionSource::Explicit));
    assert_eq!(found.executable.as_deref(), Some(tool.executable.as_str()));
    assert_eq!(found.version.as_deref(), Some("1.2.3"));
    let blocked = detect_tool(
        Some(tool.clone()),
        &Some("Node.js runtime is missing".into()),
    )
    .await
    .unwrap();
    assert_eq!(blocked.detection_status, AgentDetectionStatus::Blocked);
    assert!(!blocked.available);
    assert_eq!(blocked.executable, found.executable);
    assert!(blocked.error.unwrap().contains("Node.js"));
    std::fs::write(&script, "#!/bin/sh\nexit 7\n").unwrap();
    let failed = detect_tool(Some(tool.clone()), &None).await.unwrap();
    assert_eq!(failed.detection_status, AgentDetectionStatus::Blocked);
    assert_eq!(failed.executable, found.executable);
    assert!(failed.error.unwrap().contains("version check failed"));
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o644)).unwrap();
    let permissions = detect_tool(Some(tool.clone()), &None).await.unwrap();
    assert_eq!(permissions.detection_status, AgentDetectionStatus::Blocked);
    assert!(permissions.error.unwrap().contains("not executable"));
    assert!(resolve_executable(&tool.executable, "")
        .unwrap_err()
        .to_string()
        .contains("not executable"));
}

#[tokio::test]
#[cfg(unix)]
async fn explicit_cli_resolution_matches_detection_catalog_creation_and_terminal() {
    use std::os::unix::fs::PermissionsExt;
    if executable("node").is_none() {
        return;
    }
    let (dir, manager, _) = setup();
    let script = dir.path().join("custom-cli");
    std::fs::write(&script, "#!/bin/sh\necho 1.2.3\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::write(dir.path().join("bridge.cjs"), "require('node:readline').createInterface({input:process.stdin}).once('line',line=>{const {config}=JSON.parse(line); console.log(JSON.stringify({type:'catalog',catalog:{executable:config.executable}}));process.exit(0);});").unwrap();
    let mut tool = manager.tool("codex").unwrap();
    tool.executable = script.to_string_lossy().into_owned();
    manager.save_tool(tool.clone()).unwrap();
    let project = manager.projects().unwrap()[0].clone();
    let detected = detect_tool(Some(tool.clone()), &None).await.unwrap();
    let terminal = manager.terminal_tool("codex").unwrap();
    let created = manager
        .create(CreateAgentSession {
            creation_request_id: None,
            project_id: project.id.clone(),
            backend: "codex".into(),
            executable: String::new(),
            title: "Resolution fixture".into(),
            model: String::new(),
            effort: String::new(),
            mode: "default".into(),
            agent: String::new(),
            isolated: false,
        })
        .await
        .unwrap();
    // A registry edit must not redirect discovery for an existing session.
    tool.executable = "/bin/echo".into();
    manager.save_tool(tool).unwrap();
    let catalog = manager
        .catalog(
            "codex".into(),
            String::new(),
            project.id,
            Some(created.id.clone()),
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        detected.executable.as_deref(),
        Some(created.executable.as_str())
    );
    assert_eq!(terminal.0, created.executable);
    assert_eq!(
        catalog["executable"].as_str(),
        Some(created.executable.as_str())
    );
    assert!(
        resolve_executable("codex", dir.path().join("missing-codex").to_str().unwrap()).is_err()
    );
}

#[test]
fn workspace_records_and_literal_history_search_preserve_project_scope() {
    let (dir, manager, session) = setup();
    manager
        .workspace_save(
            "recipe:example".into(),
            Some(json!({"name":"Review","prompt":"Check changes"})),
        )
        .unwrap();
    assert_eq!(manager.workspace_records().unwrap().len(), 1);
    assert!(manager
        .workspace_save("unknown:key".into(), Some(json!({})))
        .is_err());
    // A saved recipe schedule is a workspace record like any other; rejecting its prefix would
    // leave the scheduling screen unable to store anything it accepts from the user.
    manager
        .workspace_save(
            "schedule:example".into(),
            Some(json!({
                "id":"s1","recipeId":"example","projectId":session.project_id,
                "cadence":{"kind":"interval","hours":6},"enabled":true
            })),
        )
        .unwrap();
    assert!(manager
        .workspace_record("schedule:example")
        .unwrap()
        .is_some());
    manager
        .workspace_save("schedule:example".into(), None)
        .unwrap();
    assert!(manager
        .workspace_save("preferences:capacity".into(), Some(json!({"global":0})))
        .is_err());
    manager
        .workspace_save(
            "preferences:capacity".into(),
            Some(json!({"global":2,"providers":{"codex":1}})),
        )
        .unwrap();
    {
        let state = manager.state.lock();
        assert_eq!(
            AgentManager::capacity_limits(&state.db.conn, "codex").unwrap(),
            (2, 1)
        );
        state
            .db
            .item(
                &session.id,
                &AgentItem {
                    id: "literal".into(),
                    kind: "assistant".into(),
                    title: "Result".into(),
                    text: "Fixed 100% of _edge_ cases".into(),
                    status: "completed".into(),
                    created_at: now(),
                },
            )
            .unwrap();
    }
    let query = |project_id| AgentHistoryQuery {
        query: "100%".into(),
        project_id,
        backend: Some("codex".into()),
        status: None,
        before: None,
        from_date: None,
        to_date: None,
    };
    assert_eq!(
        manager
            .history_search(query(Some(session.project_id.clone())))
            .unwrap()
            .len(),
        1
    );
    let mut dated = query(None);
    dated.from_date = Some(now() + 60_000);
    assert!(manager.history_search(dated).unwrap().is_empty());
    std::fs::create_dir(dir.path().join("other")).unwrap();
    let other = manager
        .add_project("Other".into(), dir.path().join("other"))
        .unwrap();
    assert!(manager
        .history_search(query(Some(other.id)))
        .unwrap()
        .is_empty());
    manager
        .workspace_save("recipe:example".into(), None)
        .unwrap();
    assert!(manager
        .workspace_record("recipe:example")
        .unwrap()
        .is_none());
}

#[test]
fn history_retention_protects_memory_and_checks_preview_revision() {
    let (_dir, manager, session) = setup();
    let archived = manager
        .update(&session.id, None, Some(true), false)
        .unwrap();
    let cutoff = now() + 60_000;
    assert_eq!(
        manager
            .history_retention_preview(None, cutoff)
            .unwrap()
            .len(),
        1
    );
    manager
        .workspace_save(
            "memory:evidence".into(),
            Some(json!({"sourceSessionId":session.id})),
        )
        .unwrap();
    assert!(manager
        .history_retention_preview(None, cutoff)
        .unwrap()
        .is_empty());
    assert!(manager
        .history_retention_remove(&session.id, archived.revision)
        .is_err());
    manager
        .workspace_save("memory:evidence".into(), None)
        .unwrap();
    let current = manager
        .update(&session.id, Some("Retain revised task".into()), None, false)
        .unwrap();
    assert!(manager
        .history_retention_remove(&session.id, archived.revision)
        .is_err());
    manager
        .history_retention_remove(&session.id, current.revision)
        .unwrap();
    manager
        .history_retention_remove(&session.id, current.revision)
        .unwrap();
    assert!(manager.session(&session.id).is_err());
}

#[tokio::test]
async fn imported_history_is_archived_and_cannot_execute() {
    let (_dir, manager, session) = setup();
    manager
        .state
        .lock()
        .db
        .item(
            &session.id,
            &AgentItem {
                id: "result".into(),
                kind: "assistant".into(),
                title: "Result".into(),
                text: "Verified fix".into(),
                status: "completed".into(),
                created_at: now(),
            },
        )
        .unwrap();
    let archive = manager
        .history_export(Some(session.project_id.clone()))
        .unwrap();
    assert_eq!(archive.conversations.len(), 1);
    assert!(archive.conversations[0].session.native_id.is_none());
    assert!(archive.conversations[0].session.executable.is_empty());
    assert_eq!(
        manager
            .history_import(&session.project_id, archive)
            .unwrap(),
        1
    );
    let imported = manager
        .sessions()
        .into_iter()
        .find(|s| s.id != session.id)
        .unwrap();
    assert!(imported.archived);
    assert_eq!(
        manager.snapshot(&imported.id, None).unwrap().items[0].text,
        "Verified fix"
    );
    manager
        .update(&imported.id, None, Some(false), false)
        .unwrap();
    let error = manager
        .start(AgentTurnInput {
            session_id: imported.id,
            request_id: uuid::Uuid::new_v4().to_string(),
            prompt: "run".into(),
            model: String::new(),
            effort: String::new(),
            mode: None,
            agent: None,
            attachments: vec![],
        })
        .await
        .unwrap_err();
    assert!(error.to_string().contains("Imported history"));
}

#[test]
fn project_context_is_bounded_and_rejects_parent_traversal() {
    let (dir, manager, session) = setup();
    std::fs::write(dir.path().join("source.txt"), "hello").unwrap();
    assert_eq!(
        manager
            .context_file(&session.project_id, None, "source.txt")
            .unwrap()
            .content,
        "hello"
    );
    let outside = tempfile::NamedTempFile::new().unwrap();
    assert!(manager
        .context_file(&session.project_id, None, &outside.path().to_string_lossy())
        .is_err());
    std::fs::write(dir.path().join("large.txt"), vec![b'a'; 193 * 1024]).unwrap();
    assert!(manager
        .context_file(&session.project_id, None, "large.txt")
        .is_err());
    assert!(manager
        .context_file(&session.project_id, Some("missing"), "source.txt")
        .is_err());
}

#[tokio::test]
async fn creation_request_replays_after_restart_without_duplicate_sessions() {
    let (dir, manager, session) = setup();
    let id = uuid::Uuid::new_v4().to_string();
    let input = || CreateAgentSession {
        creation_request_id: Some(id.clone()),
        project_id: session.project_id.clone(),
        backend: "codex".into(),
        executable: std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        title: "Recoverable task".into(),
        model: String::new(),
        effort: String::new(),
        mode: "default".into(),
        agent: String::new(),
        isolated: false,
    };
    let created = manager.create(input()).await.unwrap();
    assert_eq!(created.id, id);
    assert_eq!(manager.create(input()).await.unwrap().id, id);
    let mut changed = input();
    changed.title = "Different task".into();
    assert!(manager.create(changed).await.is_err());
    drop(manager);
    let reopened = Arc::new(
        AgentManager::open(dir.path(), dir.path().join("bridge.cjs"), Arc::new(|_| {})).unwrap(),
    );
    assert_eq!(reopened.create(input()).await.unwrap().id, id);
    assert_eq!(reopened.sessions().len(), 2);
    reopened.delete_session(&id).unwrap();
    assert!(reopened.create(input()).await.is_err());
}
