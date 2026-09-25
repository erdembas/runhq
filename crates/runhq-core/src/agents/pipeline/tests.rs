use super::*;
use std::io::Write;
fn manifest(root: &Path) -> Manifest {
    serde_json::from_value(json!({
 "version":1,"name":"Review pipeline","settings":{"agentWorkingDirectory":root,"locks":{"main":{"maxConcurrent":1}},"review":{"maxReviewsPerPlan":3,"maxFixesPerPlan":2,"acceptConditionalFromReview":2}},
 "steps":[
 {"id":"start","type":"human","message":"Approve decisions"},
 {"id":"impl","type":"agent","lock":"main","dependsOn":["start"],"prompt":"Implement","success":{"outputRegex":"PIPELINE_RESULT: (SUCCESS|PARTIAL)"},"haltIf":{"outputRegex":"PIPELINE_RESULT: (BLOCKED|FAILED)"}},
 {"id":"gate","type":"shell","lock":"main","dependsOn":["impl"],"command":"true","success":{"exitCode":0}},
 {"id":"review","type":"agent","dependsOn":["gate"],"prompt":"Review","capture":{"verdict":"REVIEW_VERDICT: (PASS|CONDITIONAL|FAIL)"},"maxRuns":3},
 {"id":"fix","type":"agent","lock":"main","dependsOn":["review"],"prompt":"Fix","runIf":"!(review.verdict == 'PASS' || (review.verdict == 'CONDITIONAL' && review.runCount >= 2)) && review.runCount < 3","success":{"outputRegex":"PIPELINE_RESULT: SUCCESS"},"maxRuns":2},
 {"id":"fix-gate","type":"shell","lock":"main","dependsOn":["fix"],"command":"true","success":{"exitCode":0},"onSuccess":{"rerun":"review"},"maxRuns":2},
 {"id":"done","type":"barrier","dependsOn":["review"],"completeIf":"review.verdict == 'PASS' || (review.verdict == 'CONDITIONAL' && review.runCount >= 2)","haltIf":"!(review.verdict == 'PASS' || (review.verdict == 'CONDITIONAL' && review.runCount >= 2)) && review.runCount >= 3"}
 ]})).unwrap()
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
fn conditions_validate_references_without_executing_expressions() {
    assert_eq!(
        condition::references("review.verdict != 'PASS' && review.runCount < 3").unwrap(),
        ["review", "review"]
    );
    for source in [
        "process.exit()",
        "review.runCount >= 2; bash x",
        "review.verdict == 'PASS' garbage",
        &format!(
            "{}review.verdict == 'PASS'{}",
            "(".repeat(40),
            ")".repeat(40)
        ),
    ] {
        assert!(condition::references(source).is_err(), "{source}");
    }
}
