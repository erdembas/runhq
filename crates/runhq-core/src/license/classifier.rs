use super::types::LicenseRisk;

// ---- License classification ------------------------------------------------

pub(super) fn classify_license(spdx: &str) -> LicenseRisk {
    let lower = spdx.to_ascii_lowercase();
    let s = lower.trim();

    if s.is_empty() || s == "unlicense" || s == "unlicensed" || s == "none" {
        return LicenseRisk::Unknown;
    }

    if is_strong_copyleft(s) {
        return LicenseRisk::StrongCopyleft;
    }
    if is_network_copyleft(s) {
        return LicenseRisk::NetworkCopyleft;
    }
    if is_weak_copyleft(s) {
        return LicenseRisk::WeakCopyleft;
    }
    if is_proprietary(s) {
        return LicenseRisk::Proprietary;
    }
    if is_permissive(s) {
        return LicenseRisk::Permissive;
    }

    LicenseRisk::Unknown
}

fn is_strong_copyleft(s: &str) -> bool {
    // We deliberately do NOT match `lgpl-*` here even though it
    // contains the substring `gpl-`. LGPL is *weak* copyleft (linking
    // is allowed without infecting the calling project) and gets its
    // own classification in `is_weak_copyleft`. The `lgpl_` guard
    // below short-circuits before any GPL substring check fires so
    // ordering between is_weak_copyleft and is_strong_copyleft
    // doesn't matter.
    if s.starts_with("lgpl") {
        return false;
    }
    s.starts_with("gpl-")
        || s.starts_with("gpl2")
        || s.starts_with("gpl3")
        || s == "gpl-2.0"
        || s == "gpl-3.0"
        || s == "gpl-2.0-only"
        || s == "gpl-3.0-only"
        || s == "gpl-2.0-or-later"
        || s == "gpl-3.0-or-later"
        || s.contains("gpl-2")
        || s.contains("gpl-3")
}

fn is_network_copyleft(s: &str) -> bool {
    s.starts_with("agpl-")
        || s == "agpl-3.0"
        || s == "agpl-1.0"
        || s == "agpl-3.0-only"
        || s == "agpl-3.0-or-later"
        || s.contains("agpl")
        || s.contains("sspl")
        || s == "sspl-1.0"
        || s.contains("commons-clause")
}

fn is_weak_copyleft(s: &str) -> bool {
    s.starts_with("lgpl-")
        || s == "lgpl-2.0"
        || s == "lgpl-2.1"
        || s == "lgpl-3.0"
        || s == "lgpl-2.0-only"
        || s == "lgpl-2.1-only"
        || s == "lgpl-3.0-only"
        || s.contains("lgpl")
        || s.contains("mpl")
        || s == "mpl-1.1"
        || s == "mpl-2.0"
        || s == "mpl-2.0-no-copyleft-exception"
        || s.contains("epl")
        || s == "epl-1.0"
        || s == "epl-2.0"
        || s.contains("cecill")
        || s.contains("ecl-")
        || s.contains("osl-")
}

fn is_proprietary(s: &str) -> bool {
    // Tightened from substring matches that overreached on permissive
    // identifiers ("apache-2.0 with non-commercial use clause"
    // shouldn't fall through to proprietary). We anchor on standalone
    // tokens — splitting on the SPDX combinator characters (`+ /
    // space and parens for compound expressions like
    // `"(MIT OR commercial)"`).
    let tokens: Vec<&str> = s
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '.')
        .filter(|t| !t.is_empty())
        .collect();
    for t in tokens {
        match t {
            "proprietary" | "commercial" | "see-license" | "see-license-in" | "unlicensed"
            | "cc-by-nc" | "cc-by-nc-2.0" | "cc-by-nc-3.0" | "cc-by-nc-4.0" | "cc-by-nc-sa-4.0"
            | "cc-by-nc-nd-4.0" => return true,
            _ => {}
        }
    }
    false
}

fn is_permissive(s: &str) -> bool {
    // OFL-1.1 sits here intentionally. The SIL Open Font License
    // restricts redistribution of the *font file* under specific
    // conditions, but for software (the only thing RunHQ scans)
    // shipping a font *as a dependency* is functionally permissive:
    // there's no copyleft on the consuming codebase. Classifying
    // OFL as strong-copyleft used to fire false-positive
    // contamination warnings on any project that pulled an icon
    // pack (Lucide, Phosphor, Iconoir all use OFL).
    s.starts_with("mit")
        || s == "mit"
        || s == "mit-0"
        || s.contains("apache")
        || s == "apache-2.0"
        || s == "bsd-2-clause"
        || s == "bsd-3-clause"
        || s == "bsd-2-clause-freebsd"
        || s == "bsd-3-clause-clear"
        || s == "0bsd"
        || s == "isc"
        || s == "artistic-2.0"
        || s == "zlib"
        || s == "psf-2.0"
        || s == "python-2.0"
        || s == "wtfpl"
        || s == "beerware"
        || s == "unlicense"
        || s == "cc0-1.0"
        || s == "ncsa"
        || s == "boost-1.0"
        || s == "ofl-1.1"
        || s == "ofl-1.0"
        || s.starts_with("ofl-")
}
