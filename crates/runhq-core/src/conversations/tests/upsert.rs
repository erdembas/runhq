use super::*;

#[test]
fn append_with_client_id_upserts_in_place() {
    // Critical for the chat panel: a single Turn that gets
    // continued/cancelled/retried must collapse to ONE row, not a
    // pile of half-overlapping bubbles on reload. We simulate the
    // sequence "stream first → partial → continue → complete" via
    // three appends sharing a client_id; the final state of the
    // single resulting row must reflect the last write.
    let db = temp_db();
    let id = db
        .create_conversation(CreateConversationInput {
            title: "Upsert".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    let client_id = Some("a-12345".to_string());

    let first = db
        .append_message(AppendMessageInput {
            conversation_id: id.clone(),
            client_id: client_id.clone(),
            role: MessageRole::Assistant,
            content: "first half".into(),
            reasoning: None,
            provider_id: None,
            provider_name: None,
            model_name: None,
            finish_reason: Some("length".into()),
            partial: true,
            error: None,
        })
        .unwrap();

    let second = db
        .append_message(AppendMessageInput {
            conversation_id: id.clone(),
            client_id: client_id.clone(),
            role: MessageRole::Assistant,
            content: "first half AND second half".into(),
            reasoning: None,
            provider_id: None,
            provider_name: None,
            model_name: None,
            finish_reason: Some("stop".into()),
            partial: false,
            error: None,
        })
        .unwrap();

    // Same row id round-trip — we updated in place, didn't insert.
    assert_eq!(first, second);

    let conv = db.get_conversation(&id).unwrap();
    assert_eq!(conv.messages.len(), 1);
    let m = &conv.messages[0];
    assert_eq!(m.content, "first half AND second half");
    assert_eq!(m.finish_reason.as_deref(), Some("stop"));
    assert!(!m.partial);
    assert_eq!(m.client_id.as_deref(), Some("a-12345"));
}

#[test]
fn append_with_unique_client_ids_inserts_separate_rows() {
    // Mirror of the upsert test — confirm we don't collapse rows
    // that *should* be distinct (different turns in the same
    // conversation).
    let db = temp_db();
    let id = db
        .create_conversation(CreateConversationInput {
            title: "Distinct".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    for i in 0..3 {
        db.append_message(AppendMessageInput {
            conversation_id: id.clone(),
            client_id: Some(format!("a-{i}")),
            role: MessageRole::Assistant,
            content: format!("turn {i}"),
            reasoning: None,
            provider_id: None,
            provider_name: None,
            model_name: None,
            finish_reason: Some("stop".into()),
            partial: false,
            error: None,
        })
        .unwrap();
    }
    let conv = db.get_conversation(&id).unwrap();
    assert_eq!(conv.messages.len(), 3);
    for (i, m) in conv.messages.iter().enumerate() {
        assert_eq!(m.client_id.as_deref(), Some(format!("a-{i}").as_str()));
    }
}

#[test]
fn last_preview_is_capped_at_200_chars() {
    let db = temp_db();
    let id = db
        .create_conversation(CreateConversationInput {
            title: "T".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    let long = "a".repeat(500);
    db.append_message(AppendMessageInput {
        conversation_id: id.clone(),
        client_id: None,
        role: MessageRole::Assistant,
        content: long.clone(),
        reasoning: None,
        provider_id: None,
        provider_name: None,
        model_name: None,
        finish_reason: None,
        partial: false,
        error: None,
    })
    .unwrap();
    let list = db.list_conversations(10, false, false, None).unwrap();
    let preview = list[0].last_preview.as_deref().unwrap();
    // 200 base chars + "…" terminator.
    assert!(preview.ends_with('…'));
    assert_eq!(preview.chars().count(), 201);
}
