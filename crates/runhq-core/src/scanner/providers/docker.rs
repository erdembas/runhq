use std::path::Path;

use super::super::{dir_name, ProjectCandidate, RuntimeProvider, Suggestion};

// ---- Docker provider -----------------------------------------------------

pub(super) struct DockerProvider;

impl RuntimeProvider for DockerProvider {
    fn label(&self) -> &'static str {
        "docker"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        let has_compose = dir.join("docker-compose.yml").is_file()
            || dir.join("docker-compose.yaml").is_file()
            || dir.join("compose.yml").is_file()
            || dir.join("compose.yaml").is_file();
        let has_dockerfile = dir.join("Dockerfile").is_file();

        if !has_compose && !has_dockerfile {
            return None;
        }

        let name = dir_name(dir);
        let mut suggestions = Vec::new();

        if has_compose {
            suggestions.push(Suggestion {
                label: "compose up".into(),
                cmd: "docker compose up".into(),
            });
            suggestions.push(Suggestion {
                label: "compose up (build)".into(),
                cmd: "docker compose up --build".into(),
            });
            suggestions.push(Suggestion {
                label: "compose down".into(),
                cmd: "docker compose down".into(),
            });
        }

        if has_dockerfile {
            suggestions.push(Suggestion {
                label: "build".into(),
                cmd: format!("docker build -t {name} ."),
            });
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "docker",
            suggestions,
            package_manager: None,
            project_name: None,
        })
    }
}
