use super::types::LicenseScanResult;

// ---- THIRD-PARTY-NOTICES.md generation ------------------------------------

/// Generate a THIRD-PARTY-NOTICES.md file from the scan results.
pub fn generate_third_party_notices(result: &LicenseScanResult) -> String {
    let mut out = String::new();
    out.push_str("# Third-Party Notices\n\n");
    out.push_str("This file contains the license information for third-party\n");
    out.push_str("dependencies used by this project.\n\n");
    out.push_str("## Summary\n\n");
    out.push_str(&format!(
        "- Permissive licenses: {}\n",
        result.permissive_count + result.safe_count
    ));
    out.push_str(&format!(
        "- Weak copyleft: {}\n",
        result.weak_copyleft_count
    ));
    out.push_str(&format!(
        "- Strong copyleft: {}\n",
        result.strong_copyleft_count
    ));
    out.push_str(&format!(
        "- Network copyleft: {}\n",
        result.network_copyleft_count
    ));
    out.push_str(&format!("- Proprietary: {}\n", result.proprietary_count));
    out.push_str(&format!("- Unknown: {}\n\n", result.unknown_count));

    if !result.contamination_warnings.is_empty() {
        out.push_str("## ⚠️ Contamination Warnings\n\n");
        for w in &result.contamination_warnings {
            out.push_str(&format!(
                "- **{}** v{} (`{}`): {}\n",
                w.package, w.version, w.license, w.message
            ));
        }
        out.push('\n');
    }

    out.push_str("## Dependencies\n\n");
    for e in &result.entries {
        out.push_str(&format!("### {} v{}\n\n", e.name, e.version));
        out.push_str(&format!("- **License**: {}\n", e.license));
        out.push_str(&format!("- **Risk level**: {}\n", e.risk.as_str()));
        if let Some(ref hp) = e.homepage {
            out.push_str(&format!("- **Homepage**: {}\n", hp));
        }
        if let Some(ref repo) = e.repository {
            out.push_str(&format!("- **Repository**: {}\n", repo));
        }
        out.push('\n');
    }

    out
}
