//! Per-project Markdown notes — multi-note edition.
//!
//! Notes live at `$RUNHQ_HOME/notes/<service-id>/<note-name>.md` and are
//! also concatenated into AI project context.

mod constants;
mod operations;
mod paths;
mod title;
mod types;

#[cfg(test)]
mod tests;

pub use operations::{
    create_note, delete_all_notes, delete_note, list_noted_services, list_notes, read_all_notes,
    read_note, write_note,
};
pub use types::NoteFile;
