//! Persisted user configuration.
//!
//! Layout: a single JSON file at `$RUNHQ_HOME/config.json`. Writes are atomic
//! (tmp-file + rename) so a crash mid-save cannot corrupt user data.

mod shortcuts;
mod store;
mod types;

pub use shortcuts::Shortcuts;
pub use store::Store;
pub use types::{CommandEntry, Config, Prefs, ServiceDef, StackDef, CONFIG_VERSION};
