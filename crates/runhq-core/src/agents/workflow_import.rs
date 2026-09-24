//! Recipe files resolve promptFile against the selected manifest, never the process cwd.
use super::*;
use std::io::Read;

fn bounded_text(path: &Path, limit: usize) -> AppResult<String> {
    let file = std::fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(invalid("workflow.import_too_large"));
    }
    String::from_utf8(bytes).map_err(|_| invalid("workflow.import_encoding"))
}
/// Returns ordinary, portable recipes with resolved prompt text. Import never launches work.
pub fn import_workflow_recipes(path: &Path) -> AppResult<Value> {
    let path = path.canonicalize()?;
    let base = path
        .parent()
        .ok_or_else(|| invalid("workflow.invalid_directory"))?;
    let text = bounded_text(&path, 16 * 1024 * 1024)?;
    let mut data: Value =
        serde_json::from_str(&text).map_err(|_| invalid("workflow.invalid_import"))?;
    if data["version"] != 1 {
        return Err(invalid("workflow.invalid_import"));
    }
    let recipes = data["recipes"]
        .as_array_mut()
        .filter(|r| r.len() <= 100)
        .ok_or_else(|| invalid("workflow.invalid_import"))?;
    let mut total = text.len();
    for recipe in recipes {
        let Some(steps) = recipe.get_mut("workflowSteps") else {
            continue;
        };
        let steps = steps
            .as_array_mut()
            .filter(|s| s.len() <= MAX_WORKFLOW_STEPS)
            .ok_or_else(|| invalid("workflow.invalid_import"))?;
        for step in steps {
            for field in ["promptFile", "fixPromptFile"] {
                let Some(filename) = step.get(field) else {
                    continue;
                };
                let filename = filename
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| invalid("workflow.invalid_prompt_file"))?;
                let relative = Path::new(filename);
                if filename.contains('\\')
                    || relative.components().any(|c| {
                        !matches!(
                            c,
                            std::path::Component::Normal(_) | std::path::Component::CurDir
                        )
                    })
                {
                    return Err(invalid("workflow.invalid_prompt_file"));
                }
                let resolved = base.join(relative).canonicalize()?;
                if !resolved.starts_with(base) || !resolved.is_file() {
                    return Err(invalid("workflow.invalid_prompt_file"));
                }
                let prompt = bounded_text(&resolved, MAX_STEP_PROMPT)?;
                total += prompt.len();
                if total > 16 * 1024 * 1024 {
                    return Err(invalid("workflow.import_too_large"));
                }
                if field == "promptFile" {
                    step["prompt"] = json!(prompt);
                } else {
                    if step.get("execution").is_none() {
                        step["execution"] = json!({});
                    }
                    if !step["execution"].is_object() {
                        return Err(invalid("workflow.invalid_import"));
                    }
                    step["execution"]["fix_prompt"] = json!(prompt);
                }
                step.as_object_mut().unwrap().remove(field);
            }
        }
    }
    if serde_json::to_vec(&data)?.len() > 16 * 1024 * 1024 {
        return Err(invalid("workflow.import_too_large"));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn loads_relative_prompt_and_rejects_escape() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("bundle");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("impl.md"), "Implement the change").unwrap();
        let manifest = root.join("flow.json");
        let data = json!({"version":1,"recipes":[{"workflowSteps":[{"promptFile":"impl.md"}]}]});
        std::fs::write(&manifest, data.to_string()).unwrap();
        let loaded = import_workflow_recipes(&manifest).unwrap();
        assert_eq!(
            loaded["recipes"][0]["workflowSteps"][0]["prompt"],
            "Implement the change"
        );
        assert!(loaded["recipes"][0]["workflowSteps"][0]
            .get("promptFile")
            .is_none());
        std::fs::write(
            &manifest,
            data.to_string().replace("impl.md", "../secret.md"),
        )
        .unwrap();
        assert!(import_workflow_recipes(&manifest).is_err());
        #[cfg(unix)]
        {
            std::fs::write(temp.path().join("secret.md"), "outside").unwrap();
            std::os::unix::fs::symlink(temp.path().join("secret.md"), root.join("link.md"))
                .unwrap();
            std::fs::write(&manifest, data.to_string().replace("impl.md", "link.md")).unwrap();
            assert!(import_workflow_recipes(&manifest).is_err());
        }
    }
}
