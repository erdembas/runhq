use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::ai::AiProvider;

use super::Shortcuts;

pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommandEntry {
    pub name: String,
    pub cmd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDef {
    pub id: String,
    pub name: String,
    pub cwd: PathBuf,
    #[serde(default)]
    pub cmds: Vec<CommandEntry>,
    #[serde(default, skip_serializing)]
    pub cmd: Option<String>,
    #[serde(default, skip_serializing)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    #[serde(default)]
    pub path_override: Option<String>,
    #[serde(default)]
    pub pre_command: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub open_browser: bool,
    #[serde(default)]
    pub hide_dashboard: bool,
    #[serde(default = "default_grace_ms")]
    pub grace_ms: u64,
}

impl ServiceDef {
    pub fn migrate(&mut self) {
        if self.cmds.is_empty() {
            if let Some(cmd) = self.cmd.take() {
                self.cmds.push(CommandEntry {
                    name: "default".into(),
                    cmd,
                });
            }
        }
    }
}

fn default_grace_ms() -> u64 {
    5_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub service_ids: Vec<String>,
    #[serde(default)]
    pub auto_start: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Prefs {
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub last_scanned_dir: Option<PathBuf>,
    #[serde(default)]
    pub shortcuts: Shortcuts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub version: u32,
    #[serde(default)]
    pub services: Vec<ServiceDef>,
    #[serde(default)]
    pub stacks: Vec<StackDef>,
    #[serde(default)]
    pub prefs: Prefs,
    #[serde(default)]
    pub ai_providers: Vec<AiProvider>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            services: Vec::new(),
            stacks: Vec::new(),
            prefs: Prefs::default(),
            ai_providers: Vec::new(),
        }
    }
}
