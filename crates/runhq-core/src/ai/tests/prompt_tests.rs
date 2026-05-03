use super::*;

#[test]
fn explain_diff_prompt_truncates_oversized_payload() {
    let big = "+".repeat(MAX_EXPLAIN_DIFF_CHARS + 5_000);
    let msgs = build_explain_diff_prompt(&big, Some("src/a.rs"), false);
    assert_eq!(msgs.len(), 2);
    let body = &msgs[1].content;
    assert!(body.contains("src/a.rs"));
    assert!(body.contains("[diff truncated"));
}

fn ad(sev: &str, pkg: &str) -> AdvisoryBrief {
    AdvisoryBrief {
        id: Some(format!("GHSA-{pkg}")),
        package: pkg.into(),
        severity: sev.into(),
        title: format!("{pkg} has a {sev} issue"),
        vulnerable_range: Some("<1.0.0".into()),
        fix_version: Some("1.0.0".into()),
    }
}

#[test]
fn advisory_triage_prompt_sorts_critical_first() {
    let rows = vec![
        ad("low", "left-pad"),
        ad("critical", "lodash"),
        ad("medium", "axios"),
        ad("high", "ws"),
    ];
    let msgs = build_advisory_triage_prompt(&rows, Some("api"), Some("node"));
    assert_eq!(msgs.len(), 2);
    let body = &msgs[1].content;
    let critical_at = body.find("`lodash`").expect("critical row");
    let high_at = body.find("`ws`").expect("high row");
    let medium_at = body.find("`axios`").expect("medium row");
    let low_at = body.find("`left-pad`").expect("low row");
    // Severity ordering is the entire point — pin it.
    assert!(critical_at < high_at, "critical must precede high");
    assert!(high_at < medium_at, "high must precede medium");
    assert!(medium_at < low_at, "medium must precede low");
    assert!(body.contains("Project: `api`"));
    assert!(body.contains("Runtime: `node`"));
}

#[test]
fn advisory_triage_prompt_trims_excess_rows_and_announces_it() {
    // 80 low-severity rows — well over MAX_ADVISORY_TRIAGE_ROWS.
    // We expect trim + an explicit "[row cap]" surface to the model.
    let rows: Vec<AdvisoryBrief> = (0..80).map(|i| ad("low", &format!("pkg-{i}"))).collect();
    let msgs = build_advisory_triage_prompt(&rows, None, None);
    let body = &msgs[1].content;
    assert!(body.contains("[row cap]"));
    // The header reports `Advisories: <included> of <total>` so
    // the model knows the prompt is partial. We don't pin the
    // exact `included` value — only that it's smaller than the
    // total and the "of 80" total is mentioned.
    assert!(body.contains("of 80"));
}

#[test]
fn advisory_triage_prompt_handles_empty_input() {
    let msgs = build_advisory_triage_prompt(&[], None, None);
    // Even with zero rows we want a well-formed pair of
    // messages, not a panic. The downstream UI gates the call
    // on `advisories.len() > 0`, but defending against an empty
    // payload here is cheap insurance.
    assert_eq!(msgs.len(), 2);
    let body = &msgs[1].content;
    assert!(body.contains("Advisories: 0"));
}

#[test]
fn workspace_report_prompt_carries_facts_blob() {
    let facts = r#"{"workspace":{"project_count":3,"running":1,"cve_critical":2},"projects":[{"name":"api","status":"running"}]}"#;
    let msgs = build_workspace_report_prompt(facts);
    assert_eq!(msgs.len(), 2);
    // System prompt must lock the four-section layout — that's
    // the contract the dashboard UI is building muscle memory
    // around. Reordering or renaming any of these would
    // silently regress the report's scanability.
    let sys = &msgs[0].content;
    assert!(sys.contains("**TL;DR**"));
    assert!(sys.contains("**Risk hotspots**"));
    assert!(sys.contains("**Quick wins**"));
    assert!(sys.contains("**Steady state**"));
    // User message must include the JSON blob inside a fenced
    // code block so the model sees it as a literal data
    // payload, not free prose.
    let user = &msgs[1].content;
    assert!(user.contains("```json"));
    assert!(user.contains("\"project_count\":3"));
}

#[test]
fn workspace_report_prompt_truncates_oversized_facts() {
    // Build a payload safely above the 12K-char ceiling. The
    // tail-trim path is what saves the prompt from blowing the
    // model's context window on monorepo workspaces; a
    // regression here would mean a 200-project user pays
    // the full token bill on every regenerate.
    let big = format!("{{\"junk\":\"{}\"}}", "x".repeat(20_000));
    let msgs = build_workspace_report_prompt(&big);
    let user = &msgs[1].content;
    assert!(user.contains("[snapshot truncated"));
    // Sanity: we shouldn't be emitting a runaway prompt.
    // 12K facts + ~600 chars of framing fits comfortably under
    // 14K total — anything dramatically larger means the cap
    // wasn't applied.
    assert!(user.len() < 14_000, "user message length: {}", user.len());
}

#[test]
fn log_triage_prompt_includes_service_and_runtime() {
    let msgs = build_log_triage_prompt(
        "ECONNREFUSED 127.0.0.1:5432",
        &["earlier line".to_string()],
        Some("node"),
        Some("api-svc"),
    );
    assert_eq!(msgs.len(), 2);
    let body = &msgs[1].content;
    assert!(body.contains("api-svc"));
    assert!(body.contains("node"));
    assert!(body.contains("ECONNREFUSED"));
}
