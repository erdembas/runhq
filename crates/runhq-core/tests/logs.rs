use runhq_core::logs::{LogStore, Stream};

#[test]
fn push_assigns_monotonic_seqs() {
    let store = LogStore::new();
    let a = store.push("svc", Stream::Stdout, "one".into(), None);
    let b = store.push("svc", Stream::Stdout, "two".into(), None);
    assert_eq!(a.seq + 1, b.seq);
}

#[test]
fn tail_returns_only_after_since_seq() {
    let store = LogStore::new();
    for i in 0..5 {
        store.push("svc", Stream::Stdout, format!("line {i}"), None);
    }
    let tail = store.tail("svc", 2, 10);
    assert_eq!(tail.len(), 3);
    assert_eq!(tail[0].seq, 3);
}

#[test]
fn clear_wipes_buffer_but_keeps_seq_monotonic() {
    let store = LogStore::new();
    store.push("svc", Stream::Stdout, "a".into(), None);
    store.push("svc", Stream::Stdout, "b".into(), None);
    store.clear("svc");
    let c = store.push("svc", Stream::Stdout, "c".into(), None);
    assert!(c.seq > 2);
    let snap = store.snapshot("svc");
    assert_eq!(snap.len(), 1);
    assert_eq!(snap[0].text, "c");
}

#[test]
fn push_propagates_run_id_to_every_line() {
    let store = LogStore::new();
    let rid = Some("run-abc".to_string());
    let a = store.push("svc", Stream::Stdout, "$ yarn dev".into(), rid.clone());
    let b = store.push("svc", Stream::Stdout, "ready".into(), rid.clone());
    let c = store.push("svc", Stream::System, "[exited code 0]".into(), rid.clone());
    // Lines emitted outside a run must NOT inherit a stale run_id.
    let d = store.push("svc", Stream::Stdout, "orphan".into(), None);

    assert_eq!(a.run_id.as_deref(), Some("run-abc"));
    assert_eq!(b.run_id.as_deref(), Some("run-abc"));
    assert_eq!(c.run_id.as_deref(), Some("run-abc"));
    assert_eq!(d.run_id, None);
}
