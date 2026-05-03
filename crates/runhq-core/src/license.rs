//! License & Compliance Scanner.
//!
//! Scans project dependencies for copyleft / restrictive licenses
//! (GPL, AGPL, LGPL, SSPL, etc.) that could contaminate a
//! proprietary codebase. Also generates a THIRD-PARTY-NOTICES.md
//! attribution file for compliance.
//!
//! Supports Node.js (via installed `node_modules` metadata), Rust
//! (via `cargo metadata`), and Go (via `go list -m -json`).

mod cargo;
mod classifier;
mod go;
mod notices;
mod npm;
mod runner;
mod scan;
mod types;

pub use notices::generate_third_party_notices;
pub use scan::scan_licenses;
pub use types::{
    summarize, ContaminationWarning, LicenseEntry, LicenseRisk, LicenseScanResult,
    LicenseScanSummary,
};
