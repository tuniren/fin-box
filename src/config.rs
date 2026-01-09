use crate::model::{AppConfig, Position, StockConfig};
use directories::ProjectDirs;
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

pub struct ConfigManager {
    config_path: PathBuf,
    last_modified: Option<SystemTime>,
}

impl ConfigManager {
    pub fn new() -> Self {
        let config_path = if let Some(proj_dirs) = ProjectDirs::from("", "", "fin-box") {
            proj_dirs.config_dir().join("config.yaml")
        } else {
            PathBuf::from("config.yaml") // Fallback to current dir
        };
        
        Self { 
            config_path,
            last_modified: None,
        }
    }

    pub fn load_or_default(&mut self) -> AppConfig {
        if let Ok(metadata) = fs::metadata(&self.config_path) {
             self.last_modified = metadata.modified().ok();
        }

        if let Ok(content) = fs::read_to_string(&self.config_path) {
            if let Ok(config) = serde_yaml::from_str(&content) {
                return config;
            }
        }
        
        // 默认配置
        let default_config = AppConfig {
            total_investment: Some(100000.0),
            cash: Some(50000.0),
            stocks: vec![
                StockConfig {
                    code: "sz002594".to_string(),
                    alias: Some("BYD".to_string()),
                    positions: vec![
                        Position {
                            account: Some("Account A".to_string()),
                            shares: 100,
                            cost: 250.0,
                        },
                    ],
                }
            ],
        };

        let _ = self.save(&default_config);
        default_config
    }

    /// 强制重新加载配置（忽略时间戳检查）
    pub fn force_reload(&mut self) -> Option<AppConfig> {
        if let Ok(metadata) = fs::metadata(&self.config_path) {
             self.last_modified = metadata.modified().ok();
        }
        
        if let Ok(content) = fs::read_to_string(&self.config_path) {
            if let Ok(config) = serde_yaml::from_str(&content) {
                return Some(config);
            }
        }
        None
    }

    /// 检查配置文件是否更新，如果更新则重新加载
    pub fn reload_if_changed(&mut self) -> Option<AppConfig> {
        if let Ok(metadata) = fs::metadata(&self.config_path) {
            if let Ok(modified) = metadata.modified() {
                if Some(modified) != self.last_modified {
                    self.last_modified = Some(modified);
                    if let Ok(content) = fs::read_to_string(&self.config_path) {
                        if let Ok(config) = serde_yaml::from_str(&content) {
                            return Some(config);
                        }
                    }
                }
            }
        }
        None
    }

    pub fn save(&self, config: &AppConfig) -> anyhow::Result<()> {
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let yaml = serde_yaml::to_string(config)?;
        fs::write(&self.config_path, yaml)?;
        Ok(())
    }

    pub fn config_path(&self) -> PathBuf {
        self.config_path.clone()
    }
}
