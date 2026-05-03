use super::*;

#[test]
fn create_then_get_round_trips() {
    let db = temp_db();
    let id = db
        .create_conversation(CreateConversationInput {
            title: "Test conv".into(),
            origin: "free".into(),
            context_json: Some(r#"{"foo":"bar"}"#.into()),
        })
        .unwrap();

    let conv = db.get_conversation(&id).unwrap();
    assert_eq!(conv.title, "Test conv");
    assert_eq!(conv.origin, "free");
    assert_eq!(conv.context_json.as_deref(), Some(r#"{"foo":"bar"}"#));
    assert!(!conv.pinned);
    assert!(!conv.archived);
    assert!(conv.messages.is_empty());
}

#[test]
fn append_messages_assigns_monotonic_seq() {
    let db = temp_db();
    let id = db
        .create_conversation(CreateConversationInput {
            title: "Seq test".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();

    for i in 0..5 {
        db.append_message(AppendMessageInput {
            conversation_id: id.clone(),
            client_id: None,
            role: if i % 2 == 0 {
                MessageRole::User
            } else {
                MessageRole::Assistant
            },
            content: format!("msg {i}"),
            reasoning: None,
            provider_id: None,
            provider_name: None,
            model_name: None,
            finish_reason: None,
            partial: false,
            error: None,
        })
        .unwrap();
    }

    let conv = db.get_conversation(&id).unwrap();
    assert_eq!(conv.messages.len(), 5);
    // Seq is the contract the panel uses to order messages on
    // rehydrate; if it ever drifts the conversation reads as
    // garbled. Lock it down.
    for (i, m) in conv.messages.iter().enumerate() {
        assert_eq!(m.seq, i as i64);
        assert_eq!(m.content, format!("msg {i}"));
    }
}

#[test]
fn list_conversations_orders_by_pin_then_recency() {
    let db = temp_db();
    let a = db
        .create_conversation(CreateConversationInput {
            title: "Old".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    // Tiny sleep so updated_at_ms differs deterministically.
    std::thread::sleep(std::time::Duration::from_millis(5));
    let b = db
        .create_conversation(CreateConversationInput {
            title: "Newer".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let c = db
        .create_conversation(CreateConversationInput {
            title: "Pinned but oldest update".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    // Pin C explicitly. Without the pin, C would sit on top by
    // recency anyway; we deliberately bump A's update so C is
    // older-by-update but pinned, validating the pin sort.
    db.pin_conversation(&c, true).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    db.append_message(AppendMessageInput {
        conversation_id: a.clone(),
        client_id: None,
        role: MessageRole::User,
        content: "bumping a".into(),
        reasoning: None,
        provider_id: None,
        provider_name: None,
        model_name: None,
        finish_reason: None,
        partial: false,
        error: None,
    })
    .unwrap();

    let list = db.list_conversations(50, false, false, None).unwrap();
    assert_eq!(list.len(), 3);
    // Pinned first.
    assert_eq!(list[0].id, c);
    assert!(list[0].pinned);
    // Then by updated_at_ms desc — A was just bumped.
    assert_eq!(list[1].id, a);
    assert_eq!(list[2].id, b);
}

#[test]
fn delete_cascades_to_messages() {
    let db = temp_db();
    let id = db
        .create_conversation(CreateConversationInput {
            title: "T".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    db.append_message(AppendMessageInput {
        conversation_id: id.clone(),
        client_id: None,
        role: MessageRole::User,
        content: "hi".into(),
        reasoning: None,
        provider_id: None,
        provider_name: None,
        model_name: None,
        finish_reason: None,
        partial: false,
        error: None,
    })
    .unwrap();
    db.delete_conversation(&id).unwrap();
    // Conversation gone.
    assert!(matches!(
        db.get_conversation(&id).unwrap_err(),
        AppError::NotFound(_)
    ));
    // Messages should also be gone — orphan rows would keep growing
    // the DB over time and confuse `list_conversations`'s
    // `last_preview` subquery on a recreated id.
    let count: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
            params![&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn archive_excludes_from_default_list() {
    let db = temp_db();
    let visible = db
        .create_conversation(CreateConversationInput {
            title: "Visible".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    let hidden = db
        .create_conversation(CreateConversationInput {
            title: "Archived".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    db.archive_conversation(&hidden, true).unwrap();

    let default_list = db.list_conversations(50, false, false, None).unwrap();
    assert_eq!(default_list.len(), 1);
    assert_eq!(default_list[0].id, visible);

    let with_archived = db.list_conversations(50, true, false, None).unwrap();
    assert_eq!(with_archived.len(), 2);
}
