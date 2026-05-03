use super::*;

#[test]
fn language_directive_handles_known_codes_and_falls_back() {
    let p = |lang: Option<&str>| AiProvider {
        id: "x".into(),
        name: "x".into(),
        kind: AiProviderKind::Openai,
        base_url: "https://x".into(),
        api_key: String::new(),
        model: "m".into(),
        default: false,
        response_language: lang.map(|s| s.to_string()),
        commit_language: None,
        max_output_tokens: None,
        context_window: None,
        created_at_ms: 0,
    };
    assert!(p(None).language_directive().is_none());
    assert!(p(Some("auto")).language_directive().is_none());
    assert!(p(Some("")).language_directive().is_none());
    assert!(p(Some("en"))
        .language_directive()
        .unwrap()
        .contains("English"));
    assert!(p(Some("tr"))
        .language_directive()
        .unwrap()
        .contains("Türkçe"));
    assert!(p(Some("Klingon"))
        .language_directive()
        .unwrap()
        .contains("Klingon"));
}

#[test]
fn commit_language_directive_independent_of_response_language() {
    let make = |response: Option<&str>, commit: Option<&str>| AiProvider {
        id: "x".into(),
        name: "x".into(),
        kind: AiProviderKind::Openai,
        base_url: "https://x".into(),
        api_key: String::new(),
        model: "m".into(),
        default: false,
        response_language: response.map(|s| s.to_string()),
        commit_language: commit.map(|s| s.to_string()),
        max_output_tokens: None,
        context_window: None,
        created_at_ms: 0,
    };

    // Default behaviour: no commit-specific override falls back to
    // response_language.
    assert!(make(Some("tr"), None)
        .commit_language_directive()
        .unwrap()
        .contains("Türkçe"));
    assert!(make(Some("tr"), Some(""))
        .commit_language_directive()
        .unwrap()
        .contains("Türkçe"));
    assert!(make(Some("tr"), Some("inherit"))
        .commit_language_directive()
        .unwrap()
        .contains("Türkçe"));

    // `auto` on commit explicitly opts out of the directive even
    // when response_language is set — the team-English-commits
    // workflow.
    assert!(make(Some("tr"), Some("auto"))
        .commit_language_directive()
        .is_none());

    // Explicit override wins over response_language.
    assert!(make(Some("tr"), Some("en"))
        .commit_language_directive()
        .unwrap()
        .contains("English"));

    // No response_language and no commit_language → no directive.
    assert!(make(None, None).commit_language_directive().is_none());

    // No response_language but explicit commit_language → use it.
    assert!(make(None, Some("de"))
        .commit_language_directive()
        .unwrap()
        .contains("Deutsch"));
}

#[test]
fn resolve_max_tokens_picks_smaller_or_only_set() {
    let make = |provider_cap: Option<u32>| AiProvider {
        id: "x".into(),
        name: "x".into(),
        kind: AiProviderKind::Openai,
        base_url: "https://x".into(),
        api_key: String::new(),
        model: "m".into(),
        default: false,
        response_language: None,
        commit_language: None,
        max_output_tokens: provider_cap,
        context_window: None,
        created_at_ms: 0,
    };
    // Both `None` → no cap on the wire.
    assert_eq!(make(None).resolve_max_tokens(None), None);
    // Only the surface speaks → its value flows through unchanged.
    assert_eq!(make(None).resolve_max_tokens(Some(1500)), Some(1500));
    // Only the provider speaks → its cap applies even when the
    // surface deliberately said "no opinion" (this is the new
    // behaviour we just shipped: previously surfaces silently won).
    assert_eq!(make(Some(2048)).resolve_max_tokens(None), Some(2048));
    // Both speak: smaller wins. Surface tighter than provider.
    assert_eq!(make(Some(8000)).resolve_max_tokens(Some(1500)), Some(1500));
    // Both speak: smaller wins. Provider tighter than surface.
    assert_eq!(make(Some(512)).resolve_max_tokens(Some(2000)), Some(512));
    // Equal values → either, the min is unambiguous.
    assert_eq!(make(Some(2000)).resolve_max_tokens(Some(2000)), Some(2000));
}

#[test]
fn apply_language_directive_appends_to_existing_system() {
    let mut msgs = vec![
        ChatMessage::system("You are helpful."),
        ChatMessage::user("hi"),
    ];
    apply_language_directive(&mut msgs, "Respond in Turkish.");
    assert!(msgs[0].content.contains("You are helpful."));
    assert!(msgs[0].content.contains("Respond in Turkish."));
    assert_eq!(msgs[1].content, "hi");
}

#[test]
fn apply_language_to_vec_inserts_when_missing() {
    let mut msgs = vec![ChatMessage::user("hi")];
    apply_language_to_vec(&mut msgs, "Respond in Turkish.");
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].role, "system");
    assert!(msgs[0].content.contains("Respond in Turkish."));
}
