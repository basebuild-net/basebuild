//! `web_fetch`: fetch a public http(s) page and return readable text for the
//! model. Validation refuses anything that could reach the local machine or a
//! private network. HTML is reduced to text with plain regex passes, which is
//! enough for articles and docs and avoids pulling an HTML parser into the
//! dependency tree.

use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::redirect::Policy;
use reqwest::Url;

/// Largest response body read from the network.
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
/// Largest text handed back to the model.
pub const MAX_TEXT_BYTES: usize = 64 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: usize = 5;

/// Hostnames that always resolve to the local machine or a private zone.
const LOCAL_HOST_SUFFIXES: [&str; 4] = [".localhost", ".local", ".internal", ".lan"];

/// Parse and syntactically validate a URL without touching the network.
/// Accepts only http and https, no embedded credentials, and no literal
/// private, loopback, or link-local addresses.
pub fn parse_public_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    let url = Url::parse(trimmed).map_err(|error| format!("Invalid URL: {error}"))?;
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Unsupported URL scheme '{other}'; use http or https")),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs with embedded credentials are refused".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?
        .to_ascii_lowercase();
    if host == "localhost" || LOCAL_HOST_SUFFIXES.iter().any(|suffix| host.ends_with(suffix)) {
        return Err(format!("Refused: '{host}' is a local host name"));
    }
    if let Some(ip) = literal_ip(&host) {
        if !is_public_ip(ip) {
            return Err(format!("Refused: {ip} is a private or local address"));
        }
    }
    Ok(url)
}

/// Resolve a host name and refuse it when any address is private or local.
/// Literal IPs are checked directly. DNS failures are reported as errors.
fn ensure_resolves_publicly(url: &Url) -> Result<(), String> {
    let host = url.host_str().ok_or_else(|| "URL has no host".to_string())?;
    if literal_ip(host).is_some() {
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve '{host}': {error}"))?;
    let mut any = false;
    for address in addresses {
        any = true;
        if !is_public_ip(address.ip()) {
            return Err(format!(
                "Refused: '{host}' resolves to a private or local address"
            ));
        }
    }
    if any {
        Ok(())
    } else {
        Err(format!("Could not resolve '{host}'"))
    }
}

fn literal_ip(host: &str) -> Option<IpAddr> {
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
        .ok()
}

/// True for addresses that point at the public internet. Covers loopback,
/// private, link-local, carrier-grade NAT, documentation, multicast, and
/// unspecified ranges, including IPv4-mapped IPv6.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(mapped) => is_public_v4(mapped),
            None => is_public_v6(v6),
        },
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    let cgnat = a == 100 && (64..=127).contains(&b);
    let benchmarking = a == 198 && (b == 18 || b == 19);
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || ip.is_unspecified()
        || a == 0
        || cgnat
        || benchmarking)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    let unique_local = (first & 0xfe00) == 0xfc00;
    let link_local = (first & 0xffc0) == 0xfe80;
    !(ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() || unique_local || link_local)
}

/// Full pre-flight check for one URL: syntax, then DNS resolution.
fn check_target(url: &Url) -> Result<(), String> {
    parse_public_url(url.as_str())?;
    ensure_resolves_publicly(url)
}

/// Fetch `raw` and return the page as text, prefixed with the final URL after
/// redirects. Every redirect hop goes through the same checks.
pub fn fetch_text(raw: &str) -> Result<String, String> {
    let url = parse_public_url(raw)?;
    ensure_resolves_publicly(&url)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent("Basebuild web_fetch")
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error("Too many redirects");
            }
            match check_target(attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(error) => attempt.error(error),
            }
        }))
        .build()
        .map_err(|error| format!("Could not start HTTP client: {error}"))?;
    let response = client
        .get(url)
        .header(ACCEPT, "text/html, text/plain, application/json;q=0.9, */*;q=0.1")
        .send()
        .map_err(|error| format!("Fetch failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Fetch failed with HTTP {}", status.as_u16()));
    }
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase());
    if let Some(kind) = &content_type {
        let readable = kind.starts_with("text/")
            || kind.contains("json")
            || kind.contains("xml")
            || kind.contains("html");
        if !readable {
            return Err(format!("Unsupported content type for web_fetch: {kind}"));
        }
    }

    let mut buffer = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES as u64 + 1)
        .read_to_end(&mut buffer)
        .map_err(|error| format!("Failed to read response body: {error}"))?;
    let body_truncated = buffer.len() > MAX_RESPONSE_BYTES;
    buffer.truncate(MAX_RESPONSE_BYTES);
    let raw_text = String::from_utf8_lossy(&buffer).into_owned();
    let is_html = content_type
        .as_deref()
        .map(|kind| kind.contains("html"))
        .unwrap_or_else(|| {
            let head = raw_text.trim_start().to_ascii_lowercase();
            head.starts_with("<!doctype html") || head.starts_with("<html")
        });
    let text = if is_html {
        html_to_text(&raw_text)
    } else {
        raw_text.trim().to_string()
    };
    let (text, text_truncated) = cap_text(&text, MAX_TEXT_BYTES);
    let mut out = format!("Source: {final_url}\n\n{text}");
    if body_truncated || text_truncated {
        out.push_str("\n\n[truncated: response exceeded the web_fetch size limit]");
    }
    Ok(out)
}

fn cap_text(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_string(), true)
}

/// Element bodies whose text is never readable content.
static NON_CONTENT_BLOCKS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    ["script", "style", "noscript", "template", "svg", "head"]
        .iter()
        .map(|tag| {
            Regex::new(&format!(r"(?is)<{tag}\b.*?</{tag}\s*>"))
                .expect("static block pattern compiles")
        })
        .collect()
});
static COMMENTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<!--.*?-->").expect("static pattern compiles"));
static LINE_BREAKS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<br\s*/?>|</?(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|ul|ol|table|hr)\b[^>]*>")
        .expect("static pattern compiles")
});
static TAGS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<[^>]+>").expect("static pattern compiles"));
static NUMERIC_ENTITY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"&#(x[0-9a-fA-F]+|[0-9]+);").expect("static pattern compiles")
});
static SPACES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[ \t\u{a0}]+").expect("static pattern compiles"));

/// Reduce an HTML document to readable plain text. Scripts, styles, and the
/// head are dropped, block elements become line breaks, entities are decoded,
/// and runs of blank lines are collapsed.
pub fn html_to_text(html: &str) -> String {
    let mut text = html.to_string();
    for pattern in NON_CONTENT_BLOCKS.iter() {
        text = pattern.replace_all(&text, " ").into_owned();
    }
    text = COMMENTS.replace_all(&text, " ").into_owned();
    text = LINE_BREAKS.replace_all(&text, "\n").into_owned();
    text = TAGS.replace_all(&text, "").into_owned();
    text = decode_entities(&text);
    text = SPACES.replace_all(&text, " ").into_owned();

    let mut out = String::new();
    let mut blank_run = false;
    for line in text.lines().map(str::trim) {
        if line.is_empty() {
            if !out.is_empty() && !blank_run {
                out.push('\n');
            }
            blank_run = true;
        } else {
            out.push_str(line);
            out.push('\n');
            blank_run = false;
        }
    }
    out.trim().to_string()
}

fn decode_entities(text: &str) -> String {
    let named = [
        ("&nbsp;", " "),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&mdash;", "\u{2014}"),
        ("&ndash;", "\u{2013}"),
        ("&hellip;", "\u{2026}"),
    ];
    let mut out = text.to_string();
    for (entity, replacement) in named {
        out = out.replace(entity, replacement);
    }
    out = NUMERIC_ENTITY
        .replace_all(&out, |caps: &regex::Captures| {
            let digits = &caps[1];
            let code = match digits.strip_prefix('x').or_else(|| digits.strip_prefix('X')) {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => digits.parse::<u32>().ok(),
            };
            code.and_then(char::from_u32)
                .map(|ch| ch.to_string())
                .unwrap_or_default()
        })
        .into_owned();
    // `&amp;` last so `&amp;lt;` decodes to the literal text `&lt;`.
    out.replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_public_http_and_https_urls() {
        assert!(parse_public_url("https://example.com/docs?q=1").is_ok());
        assert!(parse_public_url("http://example.org").is_ok());
        assert!(parse_public_url("  https://8.8.8.8/  ").is_ok());
    }

    #[test]
    fn rejects_non_http_schemes_and_malformed_input() {
        assert!(parse_public_url("").is_err());
        assert!(parse_public_url("not a url").is_err());
        assert!(parse_public_url("file:///etc/passwd").is_err());
        assert!(parse_public_url("ftp://example.com/a").is_err());
        assert!(parse_public_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_embedded_credentials() {
        let error = parse_public_url("https://user:secret@example.com/").unwrap_err();
        assert!(error.contains("credentials"));
    }

    #[test]
    fn rejects_local_host_names_and_private_literals() {
        for raw in [
            "http://localhost:8080/",
            "http://app.localhost/",
            "http://printer.local/",
            "http://127.0.0.1/",
            "http://10.1.2.3/",
            "http://192.168.0.1/",
            "http://172.16.5.4/",
            "http://169.254.169.254/latest/meta-data",
            "http://0.0.0.0/",
            "http://100.64.0.1/",
            "http://[::1]/",
            "http://[fd00::1]/",
            "http://[fe80::1]/",
            "http://[::ffff:127.0.0.1]/",
        ] {
            assert!(parse_public_url(raw).is_err(), "expected refusal for {raw}");
        }
    }

    #[test]
    fn public_ip_classification() {
        assert!(is_public_ip("8.8.8.8".parse().unwrap()));
        assert!(is_public_ip("2606:4700::1111".parse().unwrap()));
        assert!(!is_public_ip("100.64.0.1".parse().unwrap()));
        assert!(!is_public_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(!is_public_ip("fc00::5".parse().unwrap()));
    }

    #[test]
    fn fetch_refuses_local_targets_before_any_request() {
        let error = fetch_text("http://127.0.0.1:9/").unwrap_err();
        assert!(error.contains("private or local"));
        assert!(fetch_text("file:///tmp/x").is_err());
    }

    #[test]
    fn html_to_text_strips_scripts_styles_and_tags() {
        let html = "<!doctype html><html><head><title>T</title><style>p{color:red}</style></head>\
            <body><script>var x = '<b>no</b>';</script><h1>Title</h1>\
            <p>First <b>bold</b> line.</p><!-- hidden --><p>Second</p></body></html>";
        let text = html_to_text(html);
        assert!(!text.contains("var x"));
        assert!(!text.contains("color:red"));
        assert!(!text.contains("hidden"));
        assert!(!text.contains("<b>"));
        assert!(text.contains("Title"));
        assert!(text.contains("First bold line."));
        assert!(text.contains("Second"));
        // Block elements keep their line breaks.
        assert!(text.lines().count() >= 3);
    }

    #[test]
    fn html_to_text_decodes_entities_and_collapses_whitespace() {
        let text = html_to_text("<p>Tom &amp; Jerry &lt;3 &#39;quoted&#39; &#x4F60;</p>\n\n\n\n<p>a    b</p>");
        assert!(text.contains("Tom & Jerry <3 'quoted' 你"));
        assert!(text.contains("a b"));
        assert!(!text.contains("\n\n\n"));
        // A double-escaped entity stays literal.
        assert_eq!(html_to_text("&amp;lt;"), "&lt;");
    }

    #[test]
    fn cap_text_stops_on_char_boundary() {
        let text = "界".repeat(10);
        let (capped, truncated) = cap_text(&text, 10);
        assert!(truncated);
        assert!(capped.len() <= 10);
        assert!(capped.is_char_boundary(capped.len()));
    }
}
