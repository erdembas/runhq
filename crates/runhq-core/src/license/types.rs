use serde::{Deserialize, Serialize};

// ---- Public types ---------------------------------------------------------

/// Risk classification for a single dependency's license.
///
/// Wire format is `snake_case` (`weak_copyleft`, `network_copyleft`, …) —
/// the desktop frontend's `LicenseRisk` TS union and the human-readable
/// `as_str()` output both rely on this exact spelling, so the
/// `rename_all` attribute is load-bearing. Default-derive serde would
/// emit `WeakCopyleft` etc., which silently breaks every TS lookup
/// table keyed on the lowercase form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseRisk {
    Safe,
    Permissive,
    WeakCopyleft,
    StrongCopyleft,
    NetworkCopyleft,
    Proprietary,
    Unknown,
}

impl LicenseRisk {
    pub fn as_str(&self) -> &'static str {
        match self {
            LicenseRisk::Safe => "safe",
            LicenseRisk::Permissive => "permissive",
            LicenseRisk::WeakCopyleft => "weak_copyleft",
            LicenseRisk::StrongCopyleft => "strong_copyleft",
            LicenseRisk::NetworkCopyleft => "network_copyleft",
            LicenseRisk::Proprietary => "proprietary",
            LicenseRisk::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseEntry {
    pub name: String,
    pub version: String,
    pub license: String,
    pub risk: LicenseRisk,
    pub homepage: Option<String>,
    pub repository: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseScanResult {
    pub entries: Vec<LicenseEntry>,
    pub safe_count: usize,
    pub permissive_count: usize,
    pub weak_copyleft_count: usize,
    pub strong_copyleft_count: usize,
    pub network_copyleft_count: usize,
    pub proprietary_count: usize,
    pub unknown_count: usize,
    pub has_contamination: bool,
    /// Packages that pose the highest risk (strong copyleft + network copyleft).
    pub contamination_warnings: Vec<ContaminationWarning>,
    /// Detected runtime (`node`, `rust`, `go`, `python`, …) or `None`
    /// when the project's runtime can't be identified.
    pub runtime: Option<String>,
    /// `true` only when RunHQ has a working license parser for this
    /// runtime AND the underlying tool produced parseable output.
    /// `false` for Python (no implementation), Go (license metadata
    /// not exposed by `go list`), or when the package manager's CLI
    /// timed out / errored. The frontend uses this to avoid showing
    /// a false-confidence "✅ no contamination" badge on a project
    /// that simply wasn't analysed.
    pub scan_supported: bool,
    /// Human-readable explanation when `scan_supported = false`. Drives
    /// the frontend's "License scanning not supported for this
    /// runtime" banner.
    pub scan_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContaminationWarning {
    pub package: String,
    pub version: String,
    pub license: String,
    pub risk: LicenseRisk,
    pub message: String,
}

/// Slim cross-project summary used by the dashboard's workspace
/// pipeline.
///
/// Why not just ship `LicenseScanResult` everywhere? The full result
/// carries `entries: Vec<LicenseEntry>`, which on a typical npm
/// project resolves to 3000+ rows. Persisting that to SQLite for
/// every project on every scan and round-tripping it through Tauri
/// IPC for the dashboard's `ServiceCard` chip would burn megabytes
/// per scan for data the card never reads — chips only need counts
/// plus the top 3 offenders for their tooltip. The full result is
/// still computed (and cached) per-service when the user opens the
/// `LicensePanel` drawer; this summary is the workspace-grade
/// projection of it.
///
/// `top_warnings` is capped at 3 because that's the maximum a card
/// tooltip can fit before becoming unreadable; the drawer shows the
/// authoritative full list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LicenseScanSummary {
    pub runtime: Option<String>,
    pub scan_supported: bool,
    pub total_entries: usize,
    pub permissive_count: usize,
    pub safe_count: usize,
    pub weak_copyleft_count: usize,
    pub strong_copyleft_count: usize,
    pub network_copyleft_count: usize,
    pub proprietary_count: usize,
    pub unknown_count: usize,
    pub has_contamination: bool,
    /// First 3 contamination warnings by risk severity. Used to drive
    /// the card chip tooltip and the AI "Why?" payload without
    /// having to round-trip the full entry list.
    pub top_warnings: Vec<ContaminationWarning>,
}

impl LicenseScanSummary {
    /// Total of strong + network + proprietary licenses — the card
    /// chip's "magnitude" number. Weak copyleft and unknown are
    /// deliberately excluded because they don't trigger the same
    /// "ship-tonight" risk class; they show up in the drawer but
    /// shouldn't push a project into the workspace's contamination
    /// tally.
    pub fn contamination_count(&self) -> usize {
        self.strong_copyleft_count + self.network_copyleft_count + self.proprietary_count
    }
}

/// Project a full `LicenseScanResult` into the slim summary the
/// workspace pipeline carries around. Keeps the contamination-ranking
/// logic in one place so the card chip and the worst-offenders band
/// can never disagree about what counts as "bad".
pub fn summarize(result: &LicenseScanResult) -> LicenseScanSummary {
    // Warnings already arrive ordered by discovery (strong copyleft
    // first, then network copyleft, then proprietary — see
    // `build_result`). Network copyleft (AGPL/SSPL) is the most
    // commercial-toxic class for a SaaS product, so promote it
    // ahead of strong copyleft in the top-3 surface even when both
    // exist. We deliberately don't sort by package name — a noisy
    // tooltip with three different risk classes is more honest than
    // alphabetical order across categories.
    let mut warnings = result.contamination_warnings.clone();
    warnings.sort_by_key(|w| match w.risk {
        LicenseRisk::NetworkCopyleft => 0,
        LicenseRisk::StrongCopyleft => 1,
        LicenseRisk::Proprietary => 2,
        // The remaining variants shouldn't appear in
        // `contamination_warnings` (build_result only pushes the
        // three above), but we keep the match exhaustive so a
        // future addition to `LicenseRisk` doesn't silently
        // misorder.
        LicenseRisk::WeakCopyleft
        | LicenseRisk::Permissive
        | LicenseRisk::Safe
        | LicenseRisk::Unknown => 3,
    });
    warnings.truncate(3);

    LicenseScanSummary {
        runtime: result.runtime.clone(),
        scan_supported: result.scan_supported,
        total_entries: result.entries.len(),
        permissive_count: result.permissive_count,
        safe_count: result.safe_count,
        weak_copyleft_count: result.weak_copyleft_count,
        strong_copyleft_count: result.strong_copyleft_count,
        network_copyleft_count: result.network_copyleft_count,
        proprietary_count: result.proprietary_count,
        unknown_count: result.unknown_count,
        has_contamination: result.has_contamination,
        top_warnings: warnings,
    }
}
