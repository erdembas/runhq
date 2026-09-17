//! A minimal, isolated origin for interactive agent artifacts.
//!
//! `srcdoc` inherits the privileged app's CSP; registered Tauri protocols are
//! classified as local origins. A loopback HTTP response avoids both issues.
//! This server serves one static document only. Artifact content stays in the
//! browser's URL fragment and is never sent to this server or written to disk.

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::OnceLock,
    time::Duration,
};

static PREVIEW_URL: OnceLock<Result<String, String>> = OnceLock::new();
const BOOTSTRAP: &str = include_str!("agent_canvas_bootstrap.html");
const MAX_REQUEST_BYTES: usize = 8192;
const PREVIEW_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors tauri://localhost http://tauri.localhost https://tauri.localhost http://localhost:1420";

pub fn preview_url() -> Result<String, String> {
    PREVIEW_URL.get_or_init(start_server).clone()
}

fn start_server() -> Result<String, String> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("Could not start the canvas preview: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let host = format!("127.0.0.1:{port}");
    let path = format!("/{}/canvas", uuid::Uuid::new_v4());
    let url = format!("http://{host}{path}");
    std::thread::Builder::new()
        .name("agent-canvas-preview".into())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(mut stream) => serve_connection(&mut stream, &path, &host),
                    Err(error) => tracing::debug!(%error, "Canvas preview connection failed"),
                }
            }
        })
        .map_err(|error| format!("Could not start the canvas preview worker: {error}"))?;
    Ok(url)
}

fn allowed_request(request: &str, path: &str, host: &str) -> bool {
    let mut lines = request.split("\r\n");
    let Some(first) = lines.next() else {
        return false;
    };
    if first != format!("GET {path} HTTP/1.1") && first != format!("GET {path} HTTP/1.0") {
        return false;
    }
    let mut hosts = lines.filter_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("host").then_some(value.trim())
    });
    hosts.next() == Some(host) && hosts.next().is_none()
}

fn serve_connection(stream: &mut TcpStream, path: &str, host: &str) {
    let timeout = Some(Duration::from_secs(1));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);
    let mut buffer = [0_u8; MAX_REQUEST_BYTES];
    let mut used = 0;
    while used < buffer.len() {
        let Ok(read) = stream.read(&mut buffer[used..]) else {
            return;
        };
        if read == 0 {
            return;
        }
        used += read;
        if buffer[..used].windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            break;
        }
    }
    let request = std::str::from_utf8(&buffer[..used]).unwrap_or_default();
    let allowed = request.contains("\r\n\r\n") && allowed_request(request, path, host);
    let (status, body) = if allowed {
        ("200 OK", BOOTSTRAP)
    } else {
        ("404 Not Found", "Not found")
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nContent-Security-Policy: {PREVIEW_CSP}\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );
    let _ = stream.write_all(response.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_get_route_and_loopback_host_are_served() {
        let path = "/secret/canvas";
        let host = "127.0.0.1:43210";
        assert!(allowed_request(
            "GET /secret/canvas HTTP/1.1\r\nHost: 127.0.0.1:43210\r\n\r\n",
            path,
            host
        ));
        for request in [
            "GET /secret/canvas HTTP/1.1\r\nHost: attacker.example\r\n\r\n",
            "POST /secret/canvas HTTP/1.1\r\nHost: 127.0.0.1:43210\r\n\r\n",
            "GET /secret/canvas?file=/etc/passwd HTTP/1.1\r\nHost: 127.0.0.1:43210\r\n\r\n",
            "GET /etc/passwd HTTP/1.1\r\nHost: 127.0.0.1:43210\r\n\r\n",
            "GET /secret/canvas HTTP/1.1\r\nHost: 127.0.0.1:43210\r\nHost: attacker.example\r\n\r\n",
        ] {
            assert!(!allowed_request(request, path, host));
        }
    }

    #[test]
    fn response_is_static_sandboxed_and_cannot_access_files_or_ipc() {
        assert!(PREVIEW_CSP.contains("sandbox allow-scripts"));
        assert!(!PREVIEW_CSP.contains("allow-same-origin"));
        assert!(PREVIEW_CSP.contains("connect-src 'none'"));
        assert!(BOOTSTRAP.contains("location.hash"));
        assert!(!BOOTSTRAP.contains("__TAURI"));
        assert!(!BOOTSTRAP.contains("fetch("));
    }
}
