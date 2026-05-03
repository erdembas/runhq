use super::*;

#[test]
fn favorite_filter_returns_only_starred() {
    let db = temp_db();
    let plain = db
        .create_conversation(CreateConversationInput {
            title: "Plain".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    let starred = db
        .create_conversation(CreateConversationInput {
            title: "Starred".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    db.favorite_conversation(&starred, true).unwrap();

    let all = db.list_conversations(50, false, false, None).unwrap();
    assert_eq!(all.len(), 2);
    // The favorite must come first thanks to the secondary sort
    // key — same row's favorite=1 vs other's 0, recency tiebreaker
    // doesn't override.
    assert_eq!(all[0].id, starred);
    assert!(all[0].favorite);

    let only_favs = db.list_conversations(50, false, true, None).unwrap();
    assert_eq!(only_favs.len(), 1);
    assert_eq!(only_favs[0].id, starred);

    // Toggle off — favorites filter now returns nothing.
    db.favorite_conversation(&starred, false).unwrap();
    let after_unfav = db.list_conversations(50, false, true, None).unwrap();
    assert!(after_unfav.is_empty());
    // And the plain one is still there in the all-list.
    let all = db.list_conversations(50, false, false, None).unwrap();
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|c| c.id == plain));
}

#[test]
fn search_query_matches_title_and_message_content() {
    let db = temp_db();
    let alpha = db
        .create_conversation(CreateConversationInput {
            title: "Alpha deploy runbook".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    let beta = db
        .create_conversation(CreateConversationInput {
            title: "Daily standup".into(),
            origin: "standup".into(),
            context_json: None,
        })
        .unwrap();
    let gamma = db
        .create_conversation(CreateConversationInput {
            title: "Sprint planning".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    // Only `gamma` mentions deployment in a *message* body — its
    // title doesn't have "deploy", so this exercises the EXISTS
    // subquery on messages.
    db.append_message(AppendMessageInput {
        conversation_id: gamma.clone(),
        client_id: None,
        role: MessageRole::User,
        content: "Need to schedule a Friday deploy slot".into(),
        reasoning: None,
        provider_id: None,
        provider_name: None,
        model_name: None,
        finish_reason: None,
        partial: false,
        error: None,
    })
    .unwrap();

    let hits = db
        .list_conversations(50, false, false, Some("deploy"))
        .unwrap();
    let ids: Vec<&str> = hits.iter().map(|c| c.id.as_str()).collect();
    assert!(ids.contains(&alpha.as_str()));
    assert!(ids.contains(&gamma.as_str()));
    assert!(!ids.contains(&beta.as_str()));

    // Case-insensitive sanity check.
    let upper = db
        .list_conversations(50, false, false, Some("DEPLOY"))
        .unwrap();
    assert_eq!(upper.len(), 2);

    // Whitespace-only query is treated as no filter, not as
    // "match nothing" — otherwise an accidental space in the
    // search box would empty the drawer.
    let blank = db
        .list_conversations(50, false, false, Some("   "))
        .unwrap();
    assert_eq!(blank.len(), 3);
}

#[test]
fn pinned_outranks_favorite_in_sort() {
    // A pin is the strongest signal — a favorited but unpinned
    // conversation must NOT float above a pinned non-favorite.
    let db = temp_db();
    let pinned = db
        .create_conversation(CreateConversationInput {
            title: "Pinned not starred".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let starred = db
        .create_conversation(CreateConversationInput {
            title: "Starred not pinned".into(),
            origin: "free".into(),
            context_json: None,
        })
        .unwrap();
    db.pin_conversation(&pinned, true).unwrap();
    db.favorite_conversation(&starred, true).unwrap();

    let list = db.list_conversations(50, false, false, None).unwrap();
    assert_eq!(list[0].id, pinned);
    assert_eq!(list[1].id, starred);
}
