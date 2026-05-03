use super::*;

#[test]
fn think_state_splits_clean_block() {
    let mut s = ThinkState::default();
    let parts = s.feed("Hello <think>I should be polite</think> world");
    assert_eq!(
        parts,
        vec![
            ThinkPart::Answer("Hello ".to_string()),
            ThinkPart::Reasoning("I should be polite".to_string()),
            ThinkPart::Answer(" world".to_string()),
        ]
    );
    assert!(s.flush().is_none());
}

/// Concatenate consecutive parts of the same kind so split-chunk
/// streams compare equal to single-shot streams. The streaming
/// API allows adjacent same-kind emits (frontend just appends),
/// but it makes the assertions in these tests noisy.
fn coalesce(parts: Vec<ThinkPart>) -> Vec<ThinkPart> {
    let mut out: Vec<ThinkPart> = Vec::new();
    for part in parts {
        match (out.last_mut(), &part) {
            (Some(ThinkPart::Answer(prev)), ThinkPart::Answer(s)) => prev.push_str(s),
            (Some(ThinkPart::Reasoning(prev)), ThinkPart::Reasoning(s)) => prev.push_str(s),
            _ => out.push(part),
        }
    }
    // Trim empty-string parts that the splitter sometimes
    // produces around tag boundaries. Helps the assertions stay
    // readable.
    out.retain(|p| match p {
        ThinkPart::Answer(s) | ThinkPart::Reasoning(s) => !s.is_empty(),
        ThinkPart::ReclassifyAsReasoning => true,
    });
    out
}

#[test]
fn think_state_handles_split_open_tag_across_chunks() {
    let mut s = ThinkState::default();
    let a = s.feed("Hello <thi");
    let b = s.feed("nk>secret</think> world");
    let mut all = a;
    all.extend(b);
    assert_eq!(
        coalesce(all),
        vec![
            ThinkPart::Answer("Hello ".to_string()),
            ThinkPart::Reasoning("secret".to_string()),
            ThinkPart::Answer(" world".to_string()),
        ]
    );
}

#[test]
fn think_state_handles_split_close_tag_across_chunks() {
    let mut s = ThinkState::default();
    let a = s.feed("<think>step 1</thi");
    let b = s.feed("nk>answer here");
    let mut all = a;
    all.extend(b);
    assert_eq!(
        coalesce(all),
        vec![
            ThinkPart::Reasoning("step 1".to_string()),
            ThinkPart::Answer("answer here".to_string()),
        ]
    );
}

#[test]
fn think_state_naked_close_emits_reclassify_marker() {
    // Reasoning model whose proxy stripped the opening tag.
    // Stream looks like: "step 1\nstep 2\n</think>actual answer".
    let mut s = ThinkState::default();
    let parts = s.feed("step 1\nstep 2\n</think>actual answer");
    assert_eq!(
        parts,
        vec![
            ThinkPart::Answer("step 1\nstep 2\n".to_string()),
            ThinkPart::ReclassifyAsReasoning,
            ThinkPart::Answer("actual answer".to_string()),
        ]
    );
}

#[test]
fn think_state_naked_close_split_across_chunks() {
    let mut s = ThinkState::default();
    let mut all = s.feed("step 1\nstep 2");
    all.extend(s.feed(" more thinking</thi"));
    all.extend(s.feed("nk>real answer"));
    let coalesced = coalesce(all);
    assert_eq!(
        coalesced,
        vec![
            ThinkPart::Answer("step 1\nstep 2 more thinking".to_string()),
            ThinkPart::ReclassifyAsReasoning,
            ThinkPart::Answer("real answer".to_string()),
        ]
    );
}

#[test]
fn think_state_naked_close_only_fires_once() {
    // Even if the model emits a second </think> later (unlikely
    // but possible), we shouldn't reclassify a second time.
    let mut s = ThinkState::default();
    let parts = s.feed("plan</think>answer with stray </think> in middle");
    let coalesced = coalesce(parts);
    assert_eq!(
        coalesced,
        vec![
            ThinkPart::Answer("plan".to_string()),
            ThinkPart::ReclassifyAsReasoning,
            ThinkPart::Answer("answer with stray  in middle".to_string()),
        ]
    );
}

#[test]
fn think_state_unclosed_block_flushes_as_reasoning() {
    let mut s = ThinkState::default();
    let parts = s.feed("<think>I never got to finish");
    assert_eq!(
        parts,
        vec![ThinkPart::Reasoning("I never got to finish".to_string())]
    );
    assert!(s.flush().is_none()); // already drained
}

#[test]
fn think_state_passes_through_plain_text() {
    let mut s = ThinkState::default();
    let parts = s.feed("plain answer with no tags");
    assert_eq!(
        parts,
        vec![ThinkPart::Answer("plain answer with no tags".to_string())]
    );
}

#[test]
fn think_state_does_not_swallow_lt_in_answer() {
    // "if x < 5" should pass through eventually even if `<` looks
    // like it could grow into `<think>`. We allow one chunk of
    // delay, but the content must arrive.
    let mut s = ThinkState::default();
    let mut all = s.feed("if x < ");
    all.extend(s.feed("5 then"));
    let combined: String = all
        .iter()
        .filter_map(|p| match p {
            ThinkPart::Answer(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(combined, "if x < 5 then");
}

#[test]
fn polish_standup_keeps_input_inline() {
    let raw = "## RunHQ\n\n### api-svc\n- 09:32 commit \"fix\"\n";
    let msgs = build_polish_standup_prompt(raw);
    assert_eq!(msgs.len(), 2);
    assert!(msgs[1].content.contains("api-svc"));
}

#[test]
fn think_state_scratchpad_marker_reclassifies_prefix() {
    // Mirrors the user's screenshot: model dumps numbered analysis
    // steps, then writes "Drafting the Response" as a header, then
    // the actual answer. Everything before "Drafting the Response"
    // (including the trailing parenthetical and colon) should be
    // moved to the reasoning bucket; only the body remains as the
    // answer.
    let mut s = ThinkState::default();
    let parts = s.feed(
        "1. Reading the diff...\n2. Identifying the change...\n\
             3. Drafting the Response (Internal Monologue/Drafting):\n\
             **Summary:** The comment changed.",
    );
    let coalesced = coalesce(parts);
    assert_eq!(
        coalesced,
        vec![
            ThinkPart::Answer(
                "1. Reading the diff...\n2. Identifying the change...\n3. ".to_string()
            ),
            ThinkPart::ReclassifyAsReasoning,
            ThinkPart::Answer("**Summary:** The comment changed.".to_string()),
        ]
    );
}

#[test]
fn think_state_scratchpad_marker_handles_final_answer_label() {
    let mut s = ThinkState::default();
    let parts = s.feed("Step 1: parse.\nStep 2: synthesise.\nFinal Answer:\nThe fix is X.");
    let coalesced = coalesce(parts);
    assert_eq!(
        coalesced,
        vec![
            ThinkPart::Answer("Step 1: parse.\nStep 2: synthesise.\n".to_string()),
            ThinkPart::ReclassifyAsReasoning,
            ThinkPart::Answer("The fix is X.".to_string()),
        ]
    );
}

#[test]
fn think_state_scratchpad_marker_split_across_chunks() {
    // The marker straddles a chunk boundary — the splitter must
    // hold back the partial bytes rather than emit "Final Answ"
    // as answer text that the user briefly sees in the response.
    let mut s = ThinkState::default();
    let mut all = s.feed("scratchpad bullets\nFinal An");
    all.extend(s.feed("swer:\nthe answer"));
    let coalesced = coalesce(all);
    assert_eq!(
        coalesced,
        vec![
            ThinkPart::Answer("scratchpad bullets\n".to_string()),
            ThinkPart::ReclassifyAsReasoning,
            ThinkPart::Answer("the answer".to_string()),
        ]
    );
}

#[test]
fn think_state_scratchpad_marker_only_fires_once() {
    // Once a reclassify has fired, a second occurrence of the same
    // marker (e.g. the model later quotes "Final Answer:" as part
    // of a legitimate explanation) must pass through untouched.
    let mut s = ThinkState::default();
    let parts = s.feed(
        "plan\nFinal Answer:\nbody starts here.\n\
             Then I noted Final Answer: as a heading.",
    );
    let coalesced = coalesce(parts);
    assert_eq!(
        coalesced,
        vec![
            ThinkPart::Answer("plan\n".to_string()),
            ThinkPart::ReclassifyAsReasoning,
            ThinkPart::Answer(
                "body starts here.\nThen I noted Final Answer: as a heading.".to_string()
            ),
        ]
    );
}

#[test]
fn think_state_scratchpad_marker_drafting_variants() {
    // Smaller models swap the noun (Response → Content / Standup
    // / Answer …). All variants must trigger reclassification.
    for noun in [
        "content",
        "answer",
        "standup",
        "explanation",
        "triage",
        "output",
        "message",
    ] {
        let mut s = ThinkState::default();
        let input = format!(
            "1. Reading.\n2. Inference.\n3. Drafting the {noun} (Internal \
                 Monologue/Drafting):\n**Body** here."
        );
        let parts = s.feed(&input);
        let coalesced = coalesce(parts);
        // Must contain a reclassify followed by the answer body.
        let saw_reclassify = coalesced
            .iter()
            .any(|p| matches!(p, ThinkPart::ReclassifyAsReasoning));
        assert!(
            saw_reclassify,
            "expected reclassify for noun `{noun}`, got {coalesced:?}"
        );
        let answer_after: String = coalesced
            .iter()
            .skip_while(|p| !matches!(p, ThinkPart::ReclassifyAsReasoning))
            .skip(1)
            .filter_map(|p| match p {
                ThinkPart::Answer(s) => Some(s.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(
            answer_after, "**Body** here.",
            "answer-after-marker mismatch for noun `{noun}`"
        );
    }
}

#[test]
fn think_state_scratchpad_marker_case_insensitive() {
    let mut s = ThinkState::default();
    let parts = s.feed("noise\nDRAFTING THE RESPONSE\nthe answer");
    let coalesced = coalesce(parts);
    assert_eq!(
        coalesced,
        vec![
            ThinkPart::Answer("noise\n".to_string()),
            ThinkPart::ReclassifyAsReasoning,
            ThinkPart::Answer("the answer".to_string()),
        ]
    );
}

#[test]
fn think_state_no_marker_passes_clean_answer_through() {
    // Sanity: a normal answer that doesn't trip any marker keeps
    // its full content, including the literal substring "answer"
    // which is part of `final answer:` but not the full marker.
    let mut s = ThinkState::default();
    let parts = s.feed("Here is the answer to your question.");
    assert_eq!(
        coalesce(parts),
        vec![ThinkPart::Answer(
            "Here is the answer to your question.".to_string()
        )]
    );
}
