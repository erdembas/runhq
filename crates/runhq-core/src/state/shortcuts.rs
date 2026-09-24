use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shortcuts {
    #[serde(default = "default_send_message")]
    pub send_message: String,
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
            send_message: default_send_message(),
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

fn default_send_message() -> String {
    "Enter".into()
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

#[cfg(test)]
mod tests {
    use super::Shortcuts;

    #[test]
    fn older_preferences_default_message_sending_to_enter() {
        let shortcuts: Shortcuts =
            serde_json::from_str(r#"{"quick_action":"CmdOrCtrl+Shift+J"}"#).unwrap();

        assert_eq!(shortcuts.send_message, "Enter");
        assert_eq!(shortcuts.quick_action, "CmdOrCtrl+Shift+J");
        assert_eq!(Shortcuts::default().send_message, "Enter");
    }

    #[test]
    fn message_sending_preference_survives_serialization() {
        let shortcuts = Shortcuts {
            send_message: "CmdOrCtrl+Enter".into(),
            ..Shortcuts::default()
        };
        let saved = serde_json::to_string(&shortcuts).unwrap();
        let reloaded: Shortcuts = serde_json::from_str(&saved).unwrap();

        assert_eq!(reloaded.send_message, "CmdOrCtrl+Enter");
        assert_eq!(reloaded.close_main_tab, shortcuts.close_main_tab);
    }
}
