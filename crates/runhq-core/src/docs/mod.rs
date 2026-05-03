//! Project documentation surface.
//!
//! Discovers Markdown documentation that lives inside a project and serves
//! the contents to the desktop frontend's Docs tab.

mod discovery;
mod images;
mod limits;
mod path;
mod read;
mod types;

#[cfg(test)]
mod tests;

pub use discovery::discover_docs;
pub use images::resolve_doc_image;
pub use read::read_doc;
pub use types::{DocContent, DocKind, ProjectDoc};
