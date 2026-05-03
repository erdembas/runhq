use super::*;
use crate::error::AppError;
use std::fs::{self, File};
use std::io::Write;

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

#[tokio::test]
async fn discover_finds_readme_and_changelog() {
    let dir = tmp();
    File::create(dir.path().join("README.md"))
        .unwrap()
        .write_all(b"# Hello")
        .unwrap();
    File::create(dir.path().join("CHANGELOG.md"))
        .unwrap()
        .write_all(b"# 0.1")
        .unwrap();

    let docs = discover_docs(dir.path()).await.unwrap();
    assert_eq!(docs.len(), 2);
    assert_eq!(docs[0].kind, DocKind::Readme);
    assert_eq!(docs[1].kind, DocKind::Changelog);
}

#[tokio::test]
async fn discover_walks_docs_directory() {
    let dir = tmp();
    fs::create_dir_all(dir.path().join("docs/guides")).unwrap();
    File::create(dir.path().join("docs/intro.md"))
        .unwrap()
        .write_all(b"# Intro")
        .unwrap();
    File::create(dir.path().join("docs/guides/setup.md"))
        .unwrap()
        .write_all(b"# Setup")
        .unwrap();
    let docs = discover_docs(dir.path()).await.unwrap();
    let paths: Vec<_> = docs.iter().map(|d| d.relative_path.clone()).collect();
    assert!(paths.contains(&"docs/intro.md".to_string()));
    assert!(paths.contains(&"docs/guides/setup.md".to_string()));
}

#[tokio::test]
async fn read_doc_rejects_traversal() {
    let dir = tmp();
    let err = read_doc(dir.path(), "../etc/passwd").await.unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
}

#[tokio::test]
async fn read_doc_rejects_absolute() {
    let dir = tmp();
    let err = read_doc(dir.path(), "/etc/passwd").await.unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
}

#[tokio::test]
async fn read_doc_returns_base_dir() {
    let dir = tmp();
    fs::create_dir_all(dir.path().join("docs/guides")).unwrap();
    File::create(dir.path().join("docs/guides/setup.md"))
        .unwrap()
        .write_all(b"# Setup")
        .unwrap();
    let content = read_doc(dir.path(), "docs/guides/setup.md").await.unwrap();
    assert_eq!(content.base_dir, "docs/guides");
    assert_eq!(content.markdown, "# Setup");
}

#[tokio::test]
async fn resolve_image_inlines_png_as_data_uri() {
    let dir = tmp();
    let png: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    File::create(dir.path().join("logo.png"))
        .unwrap()
        .write_all(png)
        .unwrap();
    let uri = resolve_doc_image(dir.path(), "", "logo.png").await.unwrap();
    assert!(uri.starts_with("data:image/png;base64,"));
}

#[tokio::test]
async fn resolve_image_rejects_traversal() {
    let dir = tmp();
    let err = resolve_doc_image(dir.path(), "", "../secret.png")
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
}
