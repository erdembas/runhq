use std::path::Path;

use super::super::{dir_name, ProjectCandidate, RuntimeProvider, Suggestion};

// ---- Go provider ---------------------------------------------------------

pub(super) struct GoProvider;

impl RuntimeProvider for GoProvider {
    fn label(&self) -> &'static str {
        "go"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        if !dir.join("go.mod").is_file() {
            return None;
        }

        let name = dir_name(dir);

        let mut suggestions = vec![
            Suggestion {
                label: "run".into(),
                cmd: "go run .".into(),
            },
            Suggestion {
                label: "build".into(),
                cmd: "go build".into(),
            },
            Suggestion {
                label: "test".into(),
                cmd: "go test ./...".into(),
            },
        ];

        if dir.join("main.go").is_file() {
            suggestions.insert(
                0,
                Suggestion {
                    label: "run main.go".into(),
                    cmd: "go run main.go".into(),
                },
            );
        }

        if dir.join("Makefile").is_file() {
            suggestions.push(Suggestion {
                label: "make".into(),
                cmd: "make".into(),
            });
        }

        if dir.join("air.toml").is_file() || dir.join(".air.toml").is_file() {
            suggestions.insert(
                0,
                Suggestion {
                    label: "air (live reload)".into(),
                    cmd: "air".into(),
                },
            );
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "go",
            suggestions,
            package_manager: None,
            project_name: None,
        })
    }
}

// ---- Rust provider -------------------------------------------------------

pub(super) struct RustProvider;

impl RuntimeProvider for RustProvider {
    fn label(&self) -> &'static str {
        "rust"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        if !dir.join("Cargo.toml").is_file() {
            return None;
        }

        let name = dir_name(dir);

        let mut suggestions = vec![
            Suggestion {
                label: "run".into(),
                cmd: "cargo run".into(),
            },
            Suggestion {
                label: "build".into(),
                cmd: "cargo build".into(),
            },
            Suggestion {
                label: "test".into(),
                cmd: "cargo test".into(),
            },
        ];

        if dir.join("Dockerfile").exists() {
            suggestions.push(Suggestion {
                label: "clippy".into(),
                cmd: "cargo clippy".into(),
            });
        }

        if dir.join("tailwind.config.js").exists() || dir.join("tailwind.config.ts").exists() {
            suggestions.push(Suggestion {
                label: "trunk serve".into(),
                cmd: "trunk serve".into(),
            });
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "rust",
            suggestions,
            package_manager: None,
            project_name: None,
        })
    }
}
