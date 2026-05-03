use std::path::Path;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::header::{CONTENT_TYPE, USER_AGENT};
use tokio::fs;

use crate::error::{AppError, AppResult};

use super::limits::MAX_INLINE_IMAGE_BYTES;
use super::path::safe_join;

pub async fn resolve_doc_image(cwd: &Path, base_dir: &str, src: &str) -> AppResult<String> {
    if src.is_empty() {
        return Err(AppError::Invalid("image src is empty".into()));
    }
    if let Some(scheme_end) = src.find(':') {
        let scheme = &src[..scheme_end];
        match scheme {
            "data" => return Ok(src.to_string()),
            "http" | "https" => return resolve_remote_image(src).await,
            _ => {
                return Err(AppError::Invalid(format!(
                    "unsupported image scheme: {scheme}"
                )));
            }
        }
    }

    let mut cleaned = src;
    if let Some(rest) = cleaned.strip_prefix("./") {
        cleaned = rest;
    }
    let anchored_at_root = cleaned.starts_with('/');
    if anchored_at_root {
        cleaned = &cleaned[1..];
    }
    let joined_str: String = if anchored_at_root || base_dir.is_empty() {
        cleaned.to_string()
    } else {
        format!("{base_dir}/{cleaned}")
    };
    let abs = safe_join(cwd, &joined_str)?;
    let metadata = fs::metadata(&abs)
        .await
        .map_err(|e| AppError::NotFound(format!("image {src}: {e}")))?;
    if !metadata.is_file() {
        return Err(AppError::Invalid(format!("{src} is not a regular file")));
    }
    if metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return Err(AppError::Invalid(format!(
            "{src} is {} bytes — larger than the {MAX_INLINE_IMAGE_BYTES}-byte inline cap",
            metadata.len()
        )));
    }
    let mime = mime_for_extension(&abs)
        .ok_or_else(|| AppError::Invalid(format!("{src} is not a recognised image type")))?;
    let bytes = fs::read(&abs)
        .await
        .map_err(|e| AppError::Other(format!("read image {src}: {e}")))?;
    let encoded = STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

async fn resolve_remote_image(src: &str) -> AppResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| AppError::Other(format!("remote image client init failed: {e}")))?;
    let resp = client
        .get(src)
        .header(USER_AGENT, "RunHQ docs image resolver")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("fetch image {src}: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Other(format!("image {src} returned {status}")));
    }
    if let Some(len) = resp.content_length() {
        if len > MAX_INLINE_IMAGE_BYTES {
            return Err(AppError::Invalid(format!(
                "{src} is {len} bytes — larger than the {MAX_INLINE_IMAGE_BYTES}-byte inline cap"
            )));
        }
    }
    let header_mime = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .and_then(normalise_image_mime);
    let fallback_mime = reqwest::Url::parse(src)
        .ok()
        .and_then(|url| mime_for_extension(Path::new(url.path())));
    let mime = header_mime
        .or(fallback_mime)
        .ok_or_else(|| AppError::Invalid(format!("{src} is not a recognised image type")))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("read image {src}: {e}")))?;
    if bytes.len() as u64 > MAX_INLINE_IMAGE_BYTES {
        return Err(AppError::Invalid(format!(
            "{src} is {} bytes — larger than the {MAX_INLINE_IMAGE_BYTES}-byte inline cap",
            bytes.len()
        )));
    }
    let encoded = STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

fn normalise_image_mime(value: &str) -> Option<&'static str> {
    let mime = value.split(';').next()?.trim().to_ascii_lowercase();
    Some(match mime.as_str() {
        "image/png" => "image/png",
        "image/jpeg" | "image/jpg" => "image/jpeg",
        "image/gif" => "image/gif",
        "image/webp" => "image/webp",
        "image/svg+xml" => "image/svg+xml",
        "image/bmp" => "image/bmp",
        "image/x-icon" | "image/vnd.microsoft.icon" => "image/x-icon",
        "image/avif" => "image/avif",
        _ => return None,
    })
}

fn mime_for_extension(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())?
        .to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalise_image_mime_accepts_badge_svg_headers() {
        assert_eq!(
            normalise_image_mime("image/svg+xml; charset=utf-8"),
            Some("image/svg+xml")
        );
    }

    #[test]
    fn normalise_image_mime_rejects_non_images() {
        assert_eq!(normalise_image_mime("text/html; charset=utf-8"), None);
    }
}
