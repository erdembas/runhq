use super::super::ChatMessage;
use super::common::{MAX_ADVISORY_TRIAGE_CHARS, MAX_ADVISORY_TRIAGE_ROWS, NO_SCRATCHPAD_DIRECTIVE};

/// Compact representation of a security advisory for the triage
/// prompt. We deliberately don't reuse the dashboard's `Advisory`
/// type from `scanner` here — the prompt builder shouldn't depend
/// on the scanner crate, and frontend ships the rows over IPC anyway.
/// Field set is the union of "things the model needs to grade real
/// risk and propose a fix path": severity (importance), title (what
/// it actually does), package (where it sits in the dep graph),
/// vulnerable_range / fix_version (the upgrade math), id (so the
/// model can name the advisory in its answer).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AdvisoryBrief {
    /// `GHSA-…` / `CVE-…` identifier when the scanner has one.
    /// Optional because some pnpm/yarn scanners emit unidentified
    /// advisories — we still want to triage them.
    pub id: Option<String>,
    pub package: String,
    /// Lowercase severity (`critical`/`high`/`medium`/`low`/`info`),
    /// matching the dashboard's vocabulary. The prompt sorts on this.
    pub severity: String,
    pub title: String,
    pub vulnerable_range: Option<String>,
    pub fix_version: Option<String>,
}

impl AdvisoryBrief {
    /// One-line markdown rendering for the prompt body. Format pinned
    /// here so prompt + char-budget math stay aligned: changing the
    /// shape forces a corresponding `MAX_ADVISORY_TRIAGE_CHARS`
    /// recheck. Roughly 80–140 chars per row in practice.
    fn to_markdown_line(&self) -> String {
        let mut s = String::new();
        s.push_str("- ");
        s.push_str(&self.severity.to_uppercase());
        s.push_str(" · `");
        s.push_str(&self.package);
        s.push('`');
        if let Some(r) = self.vulnerable_range.as_deref() {
            if !r.is_empty() {
                s.push_str(" (vuln ");
                s.push_str(r);
                s.push(')');
            }
        }
        s.push_str(" — ");
        s.push_str(self.title.trim());
        let mut tail = Vec::<String>::new();
        if let Some(fv) = self.fix_version.as_deref() {
            if !fv.is_empty() {
                tail.push(format!("fix {fv}"));
            }
        }
        if let Some(id) = self.id.as_deref() {
            if !id.is_empty() {
                tail.push(id.to_string());
            }
        }
        if !tail.is_empty() {
            s.push_str(" [");
            s.push_str(&tail.join(", "));
            s.push(']');
        }
        s
    }
}

/// Severity rank for sorting. Returns a smaller number for "more
/// important" so the natural ascending sort puts criticals at the
/// top. Unknown severities sort last (5).
fn severity_rank(s: &str) -> u8 {
    match s.to_ascii_lowercase().as_str() {
        "critical" => 0,
        "high" => 1,
        "medium" | "moderate" => 2,
        "low" => 3,
        "info" | "informational" => 4,
        _ => 5,
    }
}

/// Prompt the model to triage a list of security advisories: which
/// ones are *actually* dangerous in this project's context, in what
/// order to fix them, and what to paste into the terminal. The user's
/// pain point with raw `npm audit` output is exactly the missing
/// signal-to-noise: a 64-row list with one CRITICAL buried under 41
/// HIGHs gives no actionable read. The model's job here is to rank
/// and group, not to invent CVE details — every fact in the answer
/// must come from the rows we send.
///
/// Trimming policy: when the rendered list exceeds either
/// [`MAX_ADVISORY_TRIAGE_ROWS`] or [`MAX_ADVISORY_TRIAGE_CHARS`], we
/// keep the highest-severity rows and drop the tail. The user
/// already filters by severity tile in the UI, so a "trimmed" payload
/// usually still contains the rows they cared about; the prompt
/// surfaces the trim explicitly so the model never claims to have
/// seen the whole list.
pub fn build_advisory_triage_prompt(
    advisories: &[AdvisoryBrief],
    project_name: Option<&str>,
    runtime: Option<&str>,
) -> Vec<ChatMessage> {
    let system_base = "You are a senior application-security engineer triaging a `npm audit`/`pip-audit`/`cargo audit` result for a working developer. \
                  Answer in GitHub-flavoured Markdown. Lead with **TL;DR** in one or two sentences naming the single most urgent action. \
                  Follow with a **Fix order** numbered list of at most six items; each item names the package, why it matters in plain English (DoS vs RCE vs prototype pollution vs path traversal — be specific to the advisory), and the exact upgrade or mitigation in backticks. \
                  Group multiple advisories on the same package into one item. \
                  If many advisories share a transitive parent, say so and recommend bumping the parent rather than each leaf. \
                  Add a final **Likely noise** section (one line) only when one or more rows are genuinely safe to defer (dev-only deps with no exposure, info-severity, etc.); otherwise omit the section. \
                  Never invent CVE details, packages, or fix versions that aren't in the supplied rows. \
                  When evidence is thin (no fix version, range unspecified) say so in one phrase rather than guessing. \
                  Keep total length under 300 words.";
    let system = format!("{system_base}{NO_SCRATCHPAD_DIRECTIVE}");

    // Sort by severity rank ascending (critical first) so when we
    // trim the tail, the dropped rows are the lowest-severity ones.
    // Stable sort preserves the scanner's original order within a
    // severity bucket — useful because `npm audit` already groups by
    // package and the model gets a slightly more coherent view.
    let mut sorted: Vec<AdvisoryBrief> = advisories.to_vec();
    sorted.sort_by_key(|a| severity_rank(&a.severity));

    // Apply the row cap before the char cap so a runaway scan
    // (1000+ advisories on a yarn-classic project) doesn't quadratic
    // its way through string allocation.
    let row_cap_hit = sorted.len() > MAX_ADVISORY_TRIAGE_ROWS;
    if row_cap_hit {
        sorted.truncate(MAX_ADVISORY_TRIAGE_ROWS);
    }

    // Render and apply char budget. We measure as we build so a
    // single oversized row (rare — title fields are usually short)
    // doesn't push us into a single-row payload that loses every
    // other CVE.
    let mut body = String::new();
    let mut included: usize = 0;
    let mut char_cap_hit = false;
    for adv in &sorted {
        let line = adv.to_markdown_line();
        if !body.is_empty() && body.len() + 1 + line.len() > MAX_ADVISORY_TRIAGE_CHARS {
            char_cap_hit = true;
            break;
        }
        if !body.is_empty() {
            body.push('\n');
        }
        body.push_str(&line);
        included += 1;
    }

    let total = advisories.len();
    let mut user = String::new();
    user.push_str("Triage these dependency advisories.\n\n");
    if let Some(p) = project_name {
        if !p.is_empty() {
            user.push_str(&format!("Project: `{p}`\n"));
        }
    }
    if let Some(rt) = runtime {
        if !rt.is_empty() {
            user.push_str(&format!("Runtime: `{rt}`\n"));
        }
    }
    user.push_str(&format!("Advisories: {included}"));
    if included < total {
        user.push_str(&format!(
            " of {total} (lower-severity rows trimmed for length — your \
             ranking should explicitly note that the trimmed tail wasn't reviewed)"
        ));
    }
    if row_cap_hit {
        user.push_str(" [row cap]");
    }
    if char_cap_hit {
        user.push_str(" [char cap]");
    }
    user.push_str("\n\n```\n");
    user.push_str(&body);
    user.push_str("\n```\n\nNow rank and recommend.");

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}
