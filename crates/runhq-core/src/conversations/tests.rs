use rusqlite::params;

use super::*;
use crate::error::AppError;

fn temp_db() -> ConversationsDb {
    // tempfile is a dev-dep but we don't actually need its
    // RAII cleanup here — tests are short-lived and the OS
    // tmpdir is fine. Random suffix prevents parallel-test
    // collisions.
    let path = std::env::temp_dir().join(format!(
        "runhq-conv-test-{}-{}.db",
        std::process::id(),
        uuid::Uuid::new_v4().simple(),
    ));
    ConversationsDb::open(&path).expect("open temp db")
}

mod lifecycle;
mod search_sort;
mod upsert;
