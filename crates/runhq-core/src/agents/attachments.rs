use super::{invalid, AgentAttachment};
use crate::AppResult;
use base64::{engine::general_purpose::STANDARD, Engine};

const MAX_IMAGE_BASE64_LENGTH: usize = 3 * 1024 * 1024;

/// Validate before reserving a turn or starting a provider so a failed upload is retryable.
pub(super) fn validate_attachments(
    attachments: &[AgentAttachment],
    adapter: &str,
) -> AppResult<()> {
    if attachments.is_empty() {
        return Ok(());
    }
    if !matches!(adapter, "codex" | "claude") {
        return Err(invalid("Image attachments are supported by Codex and Claude. Choose one of these agents or remove the images."));
    }
    if attachments.len() > 5 {
        return Err(invalid("Attach up to 5 images per message"));
    }
    let mut total = 0usize;
    for attachment in attachments {
        if attachment.name.trim().is_empty()
            || attachment.name.chars().count() > 255
            || attachment.name.chars().any(char::is_control)
        {
            return Err(invalid(
                "Every image must have a valid filename (up to 255 characters)",
            ));
        }
        if !matches!(
            attachment.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        ) {
            return Err(invalid("Choose PNG, JPEG, WebP or GIF images"));
        }
        total = total.saturating_add(attachment.data.len());
        if total > MAX_IMAGE_BASE64_LENGTH {
            return Err(invalid(
                "Images must total 2.25 MiB or less. Choose smaller images.",
            ));
        }
        if attachment.data.is_empty() || STANDARD.decode(&attachment.data).is_err() {
            return Err(invalid("Image data is invalid. Attach the file again."));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn image() -> AgentAttachment {
        AgentAttachment {
            name: "example.png".into(),
            mime_type: "image/png".into(),
            data: "aGVsbG8=".into(),
        }
    }
    #[test]
    fn validates_supported_images_and_keeps_plain_text_compatible() {
        assert!(validate_attachments(&[], "acp").is_ok());
        assert!(validate_attachments(&[image()], "codex").is_ok());
        assert!(validate_attachments(&[image()], "claude").is_ok());
        assert!(validate_attachments(&[image()], "opencode").is_err());
        assert!(validate_attachments(&[image()], "acp").is_err());
        assert!(validate_attachments(&[image()], "terminal").is_err());
    }
    #[test]
    fn bounds_images_and_rejects_invalid_content_before_provider_start() {
        assert!(validate_attachments(&vec![image(); 6], "codex").is_err());
        let mut invalid_image = image();
        invalid_image.mime_type = "application/javascript".into();
        assert!(validate_attachments(&[invalid_image], "codex").is_err());
        let mut invalid_image = image();
        invalid_image.data = "not base64".into();
        assert!(validate_attachments(&[invalid_image], "claude").is_err());
        let mut large = image();
        large.data = "A".repeat(MAX_IMAGE_BASE64_LENGTH);
        assert!(validate_attachments(&[large, image()], "codex").is_err());
    }
    #[test]
    fn deserializes_old_plain_text_turns_without_attachments() {
        let input: super::super::AgentTurnInput = serde_json::from_value(serde_json::json!({
            "session_id":"s", "request_id":"r", "prompt":"hello"
        }))
        .unwrap();
        assert!(input.attachments.is_empty());
    }
}
