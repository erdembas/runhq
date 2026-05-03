use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use parking_lot::RwLock;

use crate::ai::AiProvider;
use crate::paths;

use super::{Config, Prefs, ServiceDef, StackDef};

/// Thread-safe, persisted store backed by `config.json`.
pub struct Store {
    inner: RwLock<Config>,
    path: PathBuf,
}

impl Store {
    pub fn open(home: &Path) -> Result<Self> {
        let path = paths::config_path().unwrap_or_else(|_| home.join(paths::CONFIG_FILE));
        let config = if path.exists() {
            let raw =
                fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
            let mut cfg = serde_json::from_str::<Config>(&raw).unwrap_or_else(|err| {
                tracing::warn!(
                    "config at {} is corrupt ({err}); starting with an empty config",
                    path.display()
                );
                Config::default()
            });
            for svc in &mut cfg.services {
                svc.migrate();
            }
            cfg
        } else {
            let cfg = Config::default();
            write_atomic(&path, &cfg)?;
            cfg
        };
        let needs_persist = config.services.iter().any(|s| !s.cmds.is_empty());
        let store = Self {
            inner: RwLock::new(config),
            path,
        };
        if needs_persist {
            let _ = store.persist();
        }
        Ok(store)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn snapshot(&self) -> Config {
        self.inner.read().clone()
    }

    pub fn services(&self) -> Vec<ServiceDef> {
        self.inner.read().services.clone()
    }

    pub fn service(&self, id: &str) -> Option<ServiceDef> {
        self.inner
            .read()
            .services
            .iter()
            .find(|s| s.id == id)
            .cloned()
    }

    pub fn upsert_service(&self, svc: ServiceDef) -> Result<()> {
        {
            let mut cfg = self.inner.write();
            if let Some(existing) = cfg.services.iter_mut().find(|s| s.id == svc.id) {
                *existing = svc;
            } else {
                cfg.services.push(svc);
            }
        }
        self.persist()
    }

    pub fn remove_service(&self, id: &str) -> Result<bool> {
        let removed = {
            let mut cfg = self.inner.write();
            let len_before = cfg.services.len();
            cfg.services.retain(|s| s.id != id);
            len_before != cfg.services.len()
        };
        self.persist()?;
        Ok(removed)
    }

    pub fn update_prefs(&self, mutate: impl FnOnce(&mut Prefs)) -> Result<()> {
        {
            let mut cfg = self.inner.write();
            mutate(&mut cfg.prefs);
        }
        self.persist()
    }

    pub fn stacks(&self) -> Vec<StackDef> {
        self.inner.read().stacks.clone()
    }

    pub fn stack(&self, id: &str) -> Option<StackDef> {
        self.inner
            .read()
            .stacks
            .iter()
            .find(|s| s.id == id)
            .cloned()
    }

    pub fn upsert_stack(&self, stack: StackDef) -> Result<()> {
        {
            let mut cfg = self.inner.write();
            if let Some(existing) = cfg.stacks.iter_mut().find(|s| s.id == stack.id) {
                *existing = stack;
            } else {
                cfg.stacks.push(stack);
            }
        }
        self.persist()
    }

    pub fn remove_stack(&self, id: &str) -> Result<bool> {
        let removed = {
            let mut cfg = self.inner.write();
            let len_before = cfg.stacks.len();
            cfg.stacks.retain(|s| s.id != id);
            len_before != cfg.stacks.len()
        };
        self.persist()?;
        Ok(removed)
    }

    pub fn ai_providers(&self) -> Vec<AiProvider> {
        self.inner.read().ai_providers.clone()
    }

    pub fn ai_provider(&self, id: &str) -> Option<AiProvider> {
        self.inner
            .read()
            .ai_providers
            .iter()
            .find(|p| p.id == id)
            .cloned()
    }

    pub fn default_ai_provider(&self) -> Option<AiProvider> {
        let cfg = self.inner.read();
        cfg.ai_providers
            .iter()
            .find(|p| p.default)
            .cloned()
            .or_else(|| cfg.ai_providers.first().cloned())
    }

    pub fn upsert_ai_provider(&self, provider: AiProvider) -> Result<()> {
        {
            let mut cfg = self.inner.write();
            if provider.default {
                for p in &mut cfg.ai_providers {
                    p.default = false;
                }
            }
            if let Some(existing) = cfg.ai_providers.iter_mut().find(|p| p.id == provider.id) {
                *existing = provider;
            } else {
                cfg.ai_providers.push(provider);
            }
            if !cfg.ai_providers.is_empty() && !cfg.ai_providers.iter().any(|p| p.default) {
                cfg.ai_providers[0].default = true;
            }
        }
        self.persist()
    }

    pub fn remove_ai_provider(&self, id: &str) -> Result<bool> {
        let removed = {
            let mut cfg = self.inner.write();
            let len_before = cfg.ai_providers.len();
            cfg.ai_providers.retain(|p| p.id != id);
            if !cfg.ai_providers.is_empty() && !cfg.ai_providers.iter().any(|p| p.default) {
                cfg.ai_providers[0].default = true;
            }
            len_before != cfg.ai_providers.len()
        };
        self.persist()?;
        Ok(removed)
    }

    pub fn set_default_ai_provider(&self, id: &str) -> Result<bool> {
        let found = {
            let mut cfg = self.inner.write();
            let mut found = false;
            for p in &mut cfg.ai_providers {
                if p.id == id {
                    p.default = true;
                    found = true;
                } else {
                    p.default = false;
                }
            }
            found
        };
        self.persist()?;
        Ok(found)
    }

    fn persist(&self) -> Result<()> {
        write_atomic(&self.path, &self.snapshot())
    }
}

fn write_atomic(path: &Path, config: &Config) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(config)?;
    fs::write(&tmp, body).with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, path).with_context(|| format!("renaming into {}", path.display()))?;
    Ok(())
}
