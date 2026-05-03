use std::path::Path;

use super::super::{dir_name, ProjectCandidate, RuntimeProvider, Suggestion};

// ---- Java Maven provider -------------------------------------------------

pub(super) struct JavaMavenProvider;

impl RuntimeProvider for JavaMavenProvider {
    fn label(&self) -> &'static str {
        "java-maven"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        if !dir.join("pom.xml").is_file() {
            return None;
        }

        let name = dir_name(dir);

        let mut suggestions = vec![
            Suggestion {
                label: "spring-boot:run".into(),
                cmd: "mvn spring-boot:run".into(),
            },
            Suggestion {
                label: "compile".into(),
                cmd: "mvn compile".into(),
            },
            Suggestion {
                label: "test".into(),
                cmd: "mvn test".into(),
            },
            Suggestion {
                label: "package".into(),
                cmd: "mvn package -DskipTests".into(),
            },
        ];

        if dir.join("mvnw").exists() {
            for s in &mut suggestions {
                s.cmd = s.cmd.replace("mvn", "./mvnw");
            }
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "java",
            suggestions,
            package_manager: None,
            project_name: None,
        })
    }
}

// ---- Java Gradle provider ------------------------------------------------

pub(super) struct JavaGradleProvider;

impl RuntimeProvider for JavaGradleProvider {
    fn label(&self) -> &'static str {
        "java-gradle"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        let is_gradle =
            dir.join("build.gradle").is_file() || dir.join("build.gradle.kts").is_file();
        if !is_gradle {
            return None;
        }

        let name = dir_name(dir);

        let gradle = if dir.join("gradlew").exists() {
            "./gradlew"
        } else {
            "gradle"
        };

        let mut suggestions = vec![
            Suggestion {
                label: "bootRun".into(),
                cmd: format!("{gradle} bootRun"),
            },
            Suggestion {
                label: "build".into(),
                cmd: format!("{gradle} build"),
            },
            Suggestion {
                label: "test".into(),
                cmd: format!("{gradle} test"),
            },
        ];

        if dir.join("Dockerfile").exists() {
            suggestions.push(Suggestion {
                label: "dockerBuild".into(),
                cmd: format!("{gradle} dockerBuild"),
            });
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "java",
            suggestions,
            package_manager: None,
            project_name: None,
        })
    }
}
