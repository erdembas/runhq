use std::fs;
use std::path::Path;

use super::super::{dir_name, has_file_pattern, ProjectCandidate, RuntimeProvider, Suggestion};

// ---- .NET provider -------------------------------------------------------

pub(super) struct DotnetProvider;

impl RuntimeProvider for DotnetProvider {
    fn label(&self) -> &'static str {
        "dotnet"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        let proj_file = fs::read_dir(dir)
            .ok()?
            .flatten()
            .find(|e| {
                let n = e.file_name();
                let n = n.to_string_lossy();
                n.ends_with(".csproj") || n.ends_with(".fsproj") || n.ends_with(".vbproj")
            })?
            .path();

        let name = dir_name(dir);
        let project_name = fs::read_to_string(&proj_file).ok().and_then(|raw| {
            let open = "<AssemblyName>";
            let close = "</AssemblyName>";
            let start = raw.find(open)?;
            let content_start = start + open.len();
            let end = raw[content_start..].find(close)?;
            Some(raw[content_start..content_start + end].trim().to_string())
        });

        let mut suggestions = vec![
            Suggestion {
                label: "run".into(),
                cmd: "dotnet run".into(),
            },
            Suggestion {
                label: "watch".into(),
                cmd: "dotnet watch".into(),
            },
        ];

        if dir.join("Program.cs").exists() || dir.join("Program.fs").exists() {
            suggestions.push(Suggestion {
                label: "build".into(),
                cmd: "dotnet build".into(),
            });
        }

        if dir
            .join("Tests") /*.csproj*/
            .is_dir()
            || has_file_pattern(dir, "*Tests.csproj")
        {
            suggestions.push(Suggestion {
                label: "test".into(),
                cmd: "dotnet test".into(),
            });
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "dotnet",
            suggestions,
            package_manager: None,
            project_name,
        })
    }
}
