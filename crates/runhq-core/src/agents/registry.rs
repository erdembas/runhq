use super::*;
use std::collections::BTreeMap;

pub(super) fn defaults() -> Vec<AgentTool> {
    [
        ("codex", "Codex", "codex", "codex", vec![]),
        ("opencode", "OpenCode", "opencode", "opencode", vec![]),
        ("claude", "Claude", "claude", "claude", vec![]),
        ("cursor", "Cursor", "acp", "agent", vec!["acp".into()]),
    ]
    .into_iter()
    .map(|(id, name, adapter, executable, args)| AgentTool {
        id: id.into(),
        name: name.into(),
        adapter: adapter.into(),
        executable: executable.into(),
        args,
        env: Default::default(),
        enabled: true,
    })
    .collect()
}
impl AgentManager {
    pub fn tools(&self) -> Vec<AgentTool> {
        let mut tools: Vec<_> = self.state.lock().tools.values().cloned().collect();
        tools.sort_by_key(|a| a.name.to_lowercase());
        tools
    }
    pub fn save_tool(&self, tool: AgentTool) -> AppResult<()> {
        if tool.id.is_empty()
            || tool.id.len() > 100
            || !tool
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err(invalid("Invalid tool ID"));
        }
        if tool.name.trim().is_empty()
            || tool.name.len() > 200
            || tool.executable.trim().is_empty()
            || tool.executable.len() > 4096
            || tool.executable.contains('\0')
        {
            return Err(invalid("A tool name and executable are required"));
        }
        if !["codex", "opencode", "claude", "acp", "terminal"].contains(&tool.adapter.as_str()) {
            return Err(invalid("Unsupported tool connection"));
        }
        if tool.args.len() > 128
            || tool
                .args
                .iter()
                .any(|arg| arg.len() > 8192 || arg.contains('\0'))
        {
            return Err(invalid("Invalid tool arguments"));
        }
        if defaults()
            .iter()
            .any(|d| d.id == tool.id && d.adapter != tool.adapter)
        {
            return Err(invalid("Built-in tool connections cannot be changed"));
        }
        if tool.adapter != "acp" && tool.adapter != "terminal" && !tool.args.is_empty() {
            return Err(invalid(
                "Arguments are supported for ACP and terminal tools",
            ));
        }
        validate_tool_env(&tool.env)?;
        let mut state = self.state.lock();
        state.db.conn.execute("INSERT INTO agent_tools(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", rusqlite::params![tool.id,serde_json::to_string(&tool)?]).map_err(|e| AppError::other(e.to_string()))?;
        state.tools.insert(tool.id.clone(), tool);
        Ok(())
    }
    pub fn tool(&self, id: &str) -> AppResult<AgentTool> {
        let state = self.state.lock();
        let tool = state
            .tools
            .get(id)
            .cloned()
            .ok_or_else(|| invalid("Unknown tool. Add it in Agent tools."))?;
        if !tool.enabled {
            return Err(invalid("This tool is disabled. Enable it in Agent tools."));
        }
        Ok(tool)
    }
    pub fn terminal_tool(&self, id: &str) -> AppResult<(String, Vec<String>)> {
        let tool = self.tool(id)?;
        if tool.adapter == "acp" {
            return Err(invalid(
                "Add a terminal connection to use this ACP tool interactively",
            ));
        }
        Ok((resolve_executable(&tool.executable, "")?, tool.args))
    }
}

/// A connection's environment selects which provider account its processes use. RunHQ resolves the
/// executable itself and owns its own bridge variables, so those names stay out of the user's hands
/// rather than failing confusingly at spawn time.
pub(super) fn validate_tool_env(env: &BTreeMap<String, String>) -> AppResult<()> {
    if env.len() > 32 {
        return Err(invalid(
            "A connection supports up to 32 environment variables",
        ));
    }
    for (key, value) in env {
        if key.is_empty()
            || key.len() > 256
            || key.as_bytes()[0].is_ascii_digit()
            || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        {
            return Err(invalid(format!(
                "Invalid environment variable name: {key}. Use letters, digits and underscores."
            )));
        }
        if key == "PATH" {
            return Err(invalid(
                "PATH is resolved by RunHQ. Set the executable path on the connection instead.",
            ));
        }
        if key.starts_with("RUNHQ_") {
            return Err(invalid(format!("{key} is reserved by RunHQ")));
        }
        if value.len() > 4096 || value.contains('\0') {
            return Err(invalid(format!("Invalid value for {key}")));
        }
    }
    Ok(())
}
