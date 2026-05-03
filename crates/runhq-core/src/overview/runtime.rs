use std::path::Path;

// ---- Runtime detection ----------------------------------------------------

pub(super) fn detect_runtime(cwd: &Path) -> Option<String> {
    if cwd.join("package.json").exists() {
        if cwd.join("bun.lockb").exists() {
            Some("bun".into())
        } else if cwd.join("deno.lock").exists() {
            Some("deno".into())
        } else {
            Some("node".into())
        }
    } else if cwd.join("Cargo.toml").exists() {
        Some("rust".into())
    } else if cwd.join("go.mod").exists() {
        Some("go".into())
    } else if cwd.join("pom.xml").exists() || cwd.join("build.gradle").exists() {
        Some("java".into())
    } else if cwd.join("requirements.txt").exists() || cwd.join("pyproject.toml").exists() {
        Some("python".into())
    } else if cwd.join("Gemfile").exists() {
        Some("ruby".into())
    } else if cwd.join("composer.json").exists() {
        Some("php".into())
    } else {
        None
    }
}
