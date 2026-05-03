use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shortcuts {
    #[serde(default = "default_quick_action")]
    pub quick_action: String,
    #[serde(default = "default_focus_main")]
    pub focus_main: String,
    #[serde(default = "default_toggle_left_sidebar")]
    pub toggle_left_sidebar: String,
    #[serde(default = "default_toggle_ai_panel")]
    pub toggle_ai_panel: String,
    #[serde(default = "default_toggle_activity_panel")]
    pub toggle_activity_panel: String,
    #[serde(default = "default_new_terminal")]
    pub new_terminal: String,
    #[serde(default = "default_next_main_tab")]
    pub next_main_tab: String,
    #[serde(default = "default_prev_main_tab")]
    pub prev_main_tab: String,
    #[serde(default = "default_close_main_tab")]
    pub close_main_tab: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            quick_action: default_quick_action(),
            focus_main: default_focus_main(),
            toggle_left_sidebar: default_toggle_left_sidebar(),
            toggle_ai_panel: default_toggle_ai_panel(),
            toggle_activity_panel: default_toggle_activity_panel(),
            new_terminal: default_new_terminal(),
            next_main_tab: default_next_main_tab(),
            prev_main_tab: default_prev_main_tab(),
            close_main_tab: default_close_main_tab(),
        }
    }
}

fn default_quick_action() -> String {
    "CmdOrCtrl+Shift+K".into()
}

fn default_focus_main() -> String {
    "CmdOrCtrl+Shift+L".into()
}

fn default_toggle_left_sidebar() -> String {
    "CmdOrCtrl+B".into()
}

fn default_toggle_ai_panel() -> String {
    "CmdOrCtrl+Shift+A".into()
}

fn default_toggle_activity_panel() -> String {
    "CmdOrCtrl+Shift+T".into()
}

fn default_new_terminal() -> String {
    "CmdOrCtrl+`".into()
}

fn default_next_main_tab() -> String {
    "Control+Tab".into()
}

fn default_prev_main_tab() -> String {
    "Control+Shift+Tab".into()
}

fn default_close_main_tab() -> String {
    "CmdOrCtrl+W".into()
}
