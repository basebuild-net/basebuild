//! Native Devin/Cascade provider transport.
//!
//! Devin uses the Connect streaming protocol with protobuf payloads rather
//! than an OpenAI-compatible endpoint. This adapter keeps Basebuild's agent
//! loop in charge of tool execution while speaking that wire protocol
//! directly; credentials and provider response bodies are never logged.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::Value;

use super::provider_client::{
    ChatMsg, ProviderClient, ProviderRequest, ProviderResponse, ToolCallRequest, ToolSchema,
};

pub const DEVIN_API_URL: &str = "https://server.codeium.com";
const DEVIN_AUTH_PATH: &str = "/exa.auth_pb.AuthService/GetUserJwt";
const DEVIN_CHAT_PATH: &str = "/exa.api_server_pb.ApiServerService/GetChatMessage";
const DEVIN_SESSION_TOKEN_PREFIX: &str = "devin-session-token$";
const DEVIN_IDE_VERSION: &str = "3.2.23";
const DEVIN_EXTENSION_VERSION: &str = "1.48.2";
const MAX_CONNECT_FRAME_PAYLOAD: usize = 16 * 1024 * 1024;
const CONNECT_COMPRESSED_FLAG: u8 = 0x01;
const CONNECT_END_STREAM_FLAG: u8 = 0x02;
const DEFAULT_STOP_PATTERNS: [&str; 5] = [
    "<|user|>",
    "<|bot|>",
    "<|context_request|>",
    "<|endoftext|>",
    "<|end_of_turn|>",
];

/// Shared blocking HTTP client. Built lazily via [`http_client`] rather than
/// a `LazyLock` so a failed or panicking initialization (e.g. constructed in
/// a forbidden runtime context) is retried instead of poisoning the cell for
/// the rest of the process lifetime.
static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct DevinClient {
    base_url: String,
}

impl DevinClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }
}

impl ProviderClient for DevinClient {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str, &str),
    ) -> Result<ProviderResponse, String> {
        let started = Instant::now();
        let mut api_keys = Vec::with_capacity(2);
        let primary_api_key = normalize_session_token(req.api_key.as_deref().unwrap_or_default());
        if !primary_api_key.is_empty() {
            api_keys.push(primary_api_key);
            if let Some(fallback) =
                super::native_chat_service::NativeChatService::omp_api_key("devin")
            {
                let fallback = normalize_session_token(&fallback);
                if !fallback.is_empty() && !api_keys.contains(&fallback) {
                    api_keys.push(fallback);
                }
            }
        }
        if api_keys.is_empty() {
            return Err(
                "Devin authentication is missing. Reconnect Devin in Settings and retry."
                    .to_string(),
            );
        }

        let client = http_client()?;
        let mut authenticated = None;
        for api_key in api_keys {
            match fetch_auth(client, &self.base_url, &api_key) {
                Ok(auth) => {
                    authenticated = Some((api_key, auth));
                    break;
                }
                Err(DevinAuthError::Rejected) => continue,
                Err(DevinAuthError::Other(error)) => return Err(error),
            }
        }
        let Some((api_key, auth)) = authenticated else {
            return Err(
                "Devin authentication was rejected. Reconnect Devin in Settings and retry."
                    .to_string(),
            );
        };
        let chat_base_url =
            resolve_chat_base_url(auth.custom_api_server_url.as_deref(), &self.base_url)?;
        let request_bytes = build_chat_request(req, &api_key, &auth.user_jwt);
        let request_frame = encode_connect_frame(&request_bytes)?;
        let url = format!("{chat_base_url}{DEVIN_CHAT_PATH}");
        let mut response = client
            .post(url)
            .header("content-type", "application/connect+proto")
            .header("connect-protocol-version", "1")
            .header("connect-content-encoding", "gzip")
            .header("connect-accept-encoding", "gzip")
            .header("accept-encoding", "identity")
            .header("user-agent", "connect-go/1.18.1 (go1.26.3)")
            .body(request_frame)
            .send()
            .map_err(|error| safe_transport_error("Devin chat request", &error))?;
        if !response.status().is_success() {
            return Err(safe_status_error("Devin chat request", response.status()));
        }

        let mut content = String::new();
        let mut reasoning = String::new();
        let mut tool_calls: Vec<ToolCallRequest> = Vec::new();
        let mut active_tool_call_id = String::new();
        let mut input_tokens = None;
        let mut output_tokens = None;
        let mut ttft_ms = None;

        loop {
            let Some((flags, payload)) = read_connect_frame(&mut response)? else {
                break;
            };
            let payload = if flags & CONNECT_COMPRESSED_FLAG != 0 {
                gunzip(&payload)?
            } else {
                payload
            };
            if flags & CONNECT_END_STREAM_FLAG != 0 {
                if let Some(message) = connect_trailer_error(&payload) {
                    return Err(message);
                }
                continue;
            }

            let chunk = decode_chat_response(&payload)?;
            if !chunk.delta_thinking.is_empty() {
                mark_ttft(&mut ttft_ms, started);
                emit(&chunk.delta_thinking, "reasoning");
                reasoning.push_str(&chunk.delta_thinking);
            }
            if !chunk.delta_text.is_empty() {
                mark_ttft(&mut ttft_ms, started);
                emit(&chunk.delta_text, "content");
                content.push_str(&chunk.delta_text);
            }
            for delta in chunk.delta_tool_calls {
                let id = if delta.id.is_empty() {
                    active_tool_call_id.clone()
                } else {
                    active_tool_call_id.clone_from(&delta.id);
                    delta.id
                };
                if id.is_empty() {
                    continue;
                }
                mark_ttft(&mut ttft_ms, started);
                let call = if let Some(existing) = tool_calls.iter_mut().find(|call| call.id == id)
                {
                    existing
                } else {
                    if !delta.name.is_empty() {
                        // Announce the tool once so the UI can label the
                        // argument stream ("Writing propose_ideas…").
                        emit(&delta.name, "tool_call_name");
                    }
                    tool_calls.push(ToolCallRequest {
                        id: id.clone(),
                        name: delta.name.clone(),
                        arguments: String::new(),
                    });
                    tool_calls.last_mut().expect("tool call was just inserted")
                };
                if !delta.name.is_empty() {
                    if call.name.is_empty() {
                        emit(&delta.name, "tool_call_name");
                    }
                    call.name = delta.name;
                }
                if !delta.arguments.is_empty() {
                    let argument_delta = if delta.arguments.starts_with(&call.arguments) {
                        &delta.arguments[call.arguments.len()..]
                    } else {
                        delta.arguments.as_str()
                    };
                    emit(argument_delta, "tool_call");
                    if delta.arguments.starts_with(&call.arguments) {
                        call.arguments = delta.arguments;
                    } else {
                        call.arguments.push_str(&delta.arguments);
                    }
                }
            }
            if let Some(usage) = chunk.usage {
                input_tokens = Some(usage.input_tokens.min(i64::MAX as u64) as i64);
                output_tokens = Some(usage.output_tokens.min(i64::MAX as u64) as i64);
            }
        }

        let duration_ms = (started.elapsed().as_millis() as i64).max(1);
        Ok(ProviderResponse {
            content,
            reasoning: (!reasoning.is_empty()).then_some(reasoning),
            input_tokens,
            output_tokens,
            ttft_ms: ttft_ms.or(Some(duration_ms)),
            duration_ms,
            tool_calls,
        })
    }
}

fn http_client() -> Result<&'static Client, String> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Failed to initialize Devin HTTP transport: {error}"))?;
    Ok(HTTP_CLIENT.get_or_init(|| client))
}

fn normalize_session_token(api_key: &str) -> String {
    if api_key.is_empty() || api_key.starts_with(DEVIN_SESSION_TOKEN_PREFIX) {
        api_key.to_string()
    } else {
        format!("{DEVIN_SESSION_TOKEN_PREFIX}{api_key}")
    }
}

struct DevinAuth {
    user_jwt: String,
    custom_api_server_url: Option<String>,
}

enum DevinAuthError {
    Rejected,
    Other(String),
}

fn fetch_auth(client: &Client, base_url: &str, api_key: &str) -> Result<DevinAuth, DevinAuthError> {
    let metadata = encode_metadata(api_key, "");
    let mut body = Vec::with_capacity(metadata.len() + 8);
    field_message(1, &metadata, &mut body);
    let url = format!("{}{DEVIN_AUTH_PATH}", base_url.trim_end_matches('/'));
    let response = client
        .post(url)
        .header("content-type", "application/proto")
        .header("connect-protocol-version", "1")
        .header("accept", "*/*")
        .body(body)
        .send()
        .map_err(|error| {
            DevinAuthError::Other(safe_transport_error("Devin authentication", &error))
        })?;
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403) {
        return Err(DevinAuthError::Rejected);
    }
    if !status.is_success() {
        return Err(DevinAuthError::Other(safe_status_error(
            "Devin authentication",
            status,
        )));
    }
    let payload = response.bytes().map_err(|error| {
        DevinAuthError::Other(safe_transport_error(
            "Devin authentication response",
            &error,
        ))
    })?;
    let mut auth = decode_auth_response(&payload).map_err(DevinAuthError::Other)?;
    if auth.user_jwt.is_empty() {
        if let Ok(decoded) = gunzip(&payload) {
            auth = decode_auth_response(&decoded).map_err(DevinAuthError::Other)?;
        }
    }
    if auth.user_jwt.is_empty() {
        return Err(DevinAuthError::Other(
            "Devin authentication returned no user identity. Reconnect Devin and retry."
                .to_string(),
        ));
    }
    Ok(auth)
}

fn resolve_chat_base_url(custom: Option<&str>, configured: &str) -> Result<String, String> {
    let Some(custom) = custom.filter(|value| !value.trim().is_empty()) else {
        return Ok(configured.trim_end_matches('/').to_string());
    };
    let url = reqwest::Url::parse(custom)
        .map_err(|_| "Devin returned an invalid chat endpoint.".to_string())?;
    let domain = url.domain().unwrap_or_default();
    let trusted_domain = domain == "codeium.com" || domain.ends_with(".codeium.com");
    if url.scheme() != "https" || url.port_or_known_default() != Some(443) || !trusted_domain {
        return Err("Devin returned an untrusted chat endpoint.".to_string());
    }
    Ok(custom.trim_end_matches('/').to_string())
}

fn safe_transport_error(context: &str, error: &reqwest::Error) -> String {
    if error.is_timeout() {
        format!("{context} timed out. Retry when the provider is reachable.")
    } else if error.is_connect() {
        format!("{context} could not connect to the provider endpoint.")
    } else {
        format!("{context} failed before a valid provider response was received.")
    }
}

fn safe_status_error(context: &str, status: StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => format!("{context} was rejected. Reconnect Devin in Settings and retry."),
        429 => format!("{context} was rate limited. Wait briefly and retry."),
        code if code >= 500 => {
            format!("{context} failed because Devin is temporarily unavailable ({code}).")
        }
        code => format!("{context} failed with provider status {code}."),
    }
}

fn mark_ttft(ttft_ms: &mut Option<i64>, started: Instant) {
    if ttft_ms.is_none() {
        *ttft_ms = Some((started.elapsed().as_millis() as i64).max(1));
    }
}

fn build_chat_request(req: &ProviderRequest, api_key: &str, user_jwt: &str) -> Vec<u8> {
    let cascade_seed = req
        .messages
        .iter()
        .find(|message| message.role == "user")
        .map(|message| message.content.as_str())
        .unwrap_or(&req.model_id);
    let cascade_id = deterministic_uuid(&format!("{}\0{cascade_seed}", req.model_id));
    let execution_id = generated_uuid();
    let metadata = encode_metadata(api_key, user_jwt);
    let configuration = encode_completion_configuration();
    let tool_choice = encode_tool_choice();
    let cache_options = encode_prompt_cache_options();
    let mut out = Vec::new();

    field_message(1, &metadata, &mut out);
    field_string(2, req.system.as_deref().unwrap_or_default(), &mut out);
    for (index, message) in req.messages.iter().enumerate() {
        let prompt = encode_chat_message_prompt(message, &cascade_id, index);
        field_message(3, &prompt, &mut out);
    }
    field_string(21, &req.model_id, &mut out);
    field_varint(7, 5, &mut out); // CHAT_MESSAGE_REQUEST_TYPE_CASCADE
    field_message(8, &configuration, &mut out);
    for tool in &req.tools {
        field_message(10, &encode_tool_definition(tool), &mut out);
    }
    field_bool(11, true, &mut out);
    field_message(12, &tool_choice, &mut out);
    field_message(13, &cache_options, &mut out);
    field_string(16, &cascade_id, &mut out);
    field_varint(20, 1, &mut out); // CONVERSATIONAL_PLANNER_MODE_DEFAULT
    field_string(22, &execution_id, &mut out);
    out
}

fn encode_metadata(api_key: &str, user_jwt: &str) -> Vec<u8> {
    let mut out = Vec::new();
    field_string(1, "windsurf", &mut out);
    field_string(7, DEVIN_IDE_VERSION, &mut out);
    field_string(12, "windsurf", &mut out);
    field_string(2, DEVIN_EXTENSION_VERSION, &mut out);
    field_string(3, api_key, &mut out);
    field_string(4, "en", &mut out);
    field_string(21, user_jwt, &mut out);
    out
}

fn encode_chat_message_prompt(message: &ChatMsg, cascade_id: &str, index: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let source = match message.role.as_str() {
        "user" | "developer" => 1,
        "assistant" => 2,
        "tool" => 4,
        _ => 5,
    };
    let id_seed = format!("{cascade_id}\0{index}\0{}", message.role);
    let message_id = if message.role == "assistant" {
        format!("bot-{}", deterministic_uuid(&id_seed))
    } else {
        deterministic_uuid(&id_seed)
    };
    field_string(1, &message_id, &mut out);
    field_varint(2, source, &mut out);
    field_string(3, &message.content, &mut out);
    for call in &message.tool_calls {
        field_message(6, &encode_tool_call(call), &mut out);
    }
    field_string(
        7,
        message.tool_call_id.as_deref().unwrap_or_default(),
        &mut out,
    );
    out
}

fn encode_tool_call(call: &ToolCallRequest) -> Vec<u8> {
    let mut out = Vec::new();
    field_string(1, &call.id, &mut out);
    field_string(2, &call.name, &mut out);
    field_string(3, &call.arguments, &mut out);
    out
}

fn encode_tool_definition(tool: &ToolSchema) -> Vec<u8> {
    let mut out = Vec::new();
    field_string(1, &tool.name, &mut out);
    field_string(2, &tool.description, &mut out);
    field_string(3, &tool.parameters.to_string(), &mut out);
    out
}

fn encode_completion_configuration() -> Vec<u8> {
    let mut out = Vec::new();
    field_varint(1, 1, &mut out);
    field_varint(2, 64_000, &mut out);
    field_varint(3, 200, &mut out);
    field_double(5, 0.4, &mut out);
    field_double(6, 0.4, &mut out);
    field_varint(7, 50, &mut out);
    field_double(8, 1.0, &mut out);
    for pattern in DEFAULT_STOP_PATTERNS {
        field_string(9, pattern, &mut out);
    }
    field_double(11, 1.0, &mut out);
    out
}

fn encode_tool_choice() -> Vec<u8> {
    let mut out = Vec::new();
    field_string(1, "auto", &mut out);
    out
}

fn encode_prompt_cache_options() -> Vec<u8> {
    let mut out = Vec::new();
    field_varint(1, 1, &mut out);
    out
}

fn encode_connect_frame(payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(payload)
        .map_err(|_| "Failed to encode Devin request payload.".to_string())?;
    let compressed = encoder
        .finish()
        .map_err(|_| "Failed to encode Devin request payload.".to_string())?;
    if compressed.len() > MAX_CONNECT_FRAME_PAYLOAD {
        return Err("Devin request exceeds the provider frame size limit.".to_string());
    }
    let mut frame = Vec::with_capacity(compressed.len() + 5);
    frame.push(CONNECT_COMPRESSED_FLAG);
    frame.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
    frame.extend_from_slice(&compressed);
    Ok(frame)
}

fn read_connect_frame(reader: &mut impl Read) -> Result<Option<(u8, Vec<u8>)>, String> {
    let mut header = [0_u8; 5];
    match reader.read(&mut header[..1]) {
        Ok(0) => return Ok(None),
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::Interrupted => return read_connect_frame(reader),
        Err(_) => return Err("Failed while reading the Devin response stream.".to_string()),
    }
    reader
        .read_exact(&mut header[1..])
        .map_err(|_| "Devin returned an incomplete response frame.".to_string())?;
    let length = u32::from_be_bytes([header[1], header[2], header[3], header[4]]) as usize;
    if length > MAX_CONNECT_FRAME_PAYLOAD {
        return Err("Devin returned an oversized response frame.".to_string());
    }
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|_| "Devin returned an incomplete response frame.".to_string())?;
    Ok(Some((header[0], payload)))
}

fn gunzip(payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(payload);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|_| "Devin returned an invalid compressed response.".to_string())?;
    Ok(out)
}

fn connect_trailer_error(payload: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(payload).ok()?;
    let error = value.get("error")?;
    let code = error
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("The provider ended the stream with an error.");
    let message: String = message.chars().take(500).collect();
    Some(format!("Devin stream error ({code}): {message}"))
}

#[derive(Default)]
struct ChatResponseChunk {
    delta_text: String,
    delta_thinking: String,
    delta_tool_calls: Vec<ToolCallRequest>,
    usage: Option<Usage>,
}

#[derive(Default)]
struct Usage {
    input_tokens: u64,
    output_tokens: u64,
}

fn decode_auth_response(payload: &[u8]) -> Result<DevinAuth, String> {
    let mut reader = ProtoReader::new(payload);
    let mut auth = DevinAuth {
        user_jwt: String::new(),
        custom_api_server_url: None,
    };
    while let Some((field, wire)) = reader.next_key()? {
        match field {
            1 => auth.user_jwt = reader.string(wire)?,
            2 => auth.custom_api_server_url = Some(reader.string(wire)?),
            _ => reader.skip(wire)?,
        }
    }
    Ok(auth)
}

fn decode_chat_response(payload: &[u8]) -> Result<ChatResponseChunk, String> {
    let mut reader = ProtoReader::new(payload);
    let mut chunk = ChatResponseChunk::default();
    while let Some((field, wire)) = reader.next_key()? {
        match field {
            3 => chunk.delta_text = reader.string(wire)?,
            6 => chunk
                .delta_tool_calls
                .push(decode_tool_call(reader.bytes(wire)?)?),
            7 => chunk.usage = Some(decode_usage(reader.bytes(wire)?)?),
            9 => chunk.delta_thinking = reader.string(wire)?,
            _ => reader.skip(wire)?,
        }
    }
    Ok(chunk)
}

fn decode_tool_call(payload: &[u8]) -> Result<ToolCallRequest, String> {
    let mut reader = ProtoReader::new(payload);
    let mut call = ToolCallRequest::default();
    while let Some((field, wire)) = reader.next_key()? {
        match field {
            1 => call.id = reader.string(wire)?,
            2 => call.name = reader.string(wire)?,
            3 => call.arguments = reader.string(wire)?,
            _ => reader.skip(wire)?,
        }
    }
    Ok(call)
}

fn decode_usage(payload: &[u8]) -> Result<Usage, String> {
    let mut reader = ProtoReader::new(payload);
    let mut usage = Usage::default();
    while let Some((field, wire)) = reader.next_key()? {
        match field {
            2 => usage.input_tokens = reader.varint_for_wire(wire)?,
            3 => usage.output_tokens = reader.varint_for_wire(wire)?,
            _ => reader.skip(wire)?,
        }
    }
    Ok(usage)
}

struct ProtoReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> ProtoReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn next_key(&mut self) -> Result<Option<(u32, u8)>, String> {
        if self.position == self.bytes.len() {
            return Ok(None);
        }
        let key = self.varint()?;
        let field = (key >> 3) as u32;
        let wire = (key & 0x07) as u8;
        if field == 0 {
            return Err("Devin returned an invalid protobuf field.".to_string());
        }
        Ok(Some((field, wire)))
    }

    fn varint(&mut self) -> Result<u64, String> {
        let mut value = 0_u64;
        for shift in (0..70).step_by(7) {
            let byte = *self
                .bytes
                .get(self.position)
                .ok_or_else(|| "Devin returned a truncated protobuf value.".to_string())?;
            self.position += 1;
            if shift == 63 && byte > 1 {
                return Err("Devin returned an invalid protobuf value.".to_string());
            }
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err("Devin returned an invalid protobuf value.".to_string())
    }

    fn varint_for_wire(&mut self, wire: u8) -> Result<u64, String> {
        if wire != 0 {
            return Err("Devin returned an unexpected protobuf field type.".to_string());
        }
        self.varint()
    }

    fn bytes(&mut self, wire: u8) -> Result<&'a [u8], String> {
        if wire != 2 {
            return Err("Devin returned an unexpected protobuf field type.".to_string());
        }
        let length = self.varint()? as usize;
        let end = self
            .position
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| "Devin returned a truncated protobuf field.".to_string())?;
        let value = &self.bytes[self.position..end];
        self.position = end;
        Ok(value)
    }

    fn string(&mut self, wire: u8) -> Result<String, String> {
        String::from_utf8(self.bytes(wire)?.to_vec())
            .map_err(|_| "Devin returned invalid text encoding.".to_string())
    }

    fn skip(&mut self, wire: u8) -> Result<(), String> {
        match wire {
            0 => {
                self.varint()?;
            }
            1 => self.advance(8)?,
            2 => {
                let length = self.varint()? as usize;
                self.advance(length)?;
            }
            5 => self.advance(4)?,
            _ => return Err("Devin returned an unsupported protobuf field type.".to_string()),
        }
        Ok(())
    }

    fn advance(&mut self, length: usize) -> Result<(), String> {
        self.position = self
            .position
            .checked_add(length)
            .filter(|position| *position <= self.bytes.len())
            .ok_or_else(|| "Devin returned a truncated protobuf field.".to_string())?;
        Ok(())
    }
}

fn field_key(field: u32, wire: u8, out: &mut Vec<u8>) {
    encode_varint((u64::from(field) << 3) | u64::from(wire), out);
}

fn field_varint(field: u32, value: u64, out: &mut Vec<u8>) {
    if value == 0 {
        return;
    }
    field_key(field, 0, out);
    encode_varint(value, out);
}

fn field_bool(field: u32, value: bool, out: &mut Vec<u8>) {
    if value {
        field_varint(field, 1, out);
    }
}

fn field_double(field: u32, value: f64, out: &mut Vec<u8>) {
    if value == 0.0 {
        return;
    }
    field_key(field, 1, out);
    out.extend_from_slice(&value.to_le_bytes());
}

fn field_string(field: u32, value: &str, out: &mut Vec<u8>) {
    field_bytes(field, value.as_bytes(), out);
}

fn field_message(field: u32, value: &[u8], out: &mut Vec<u8>) {
    field_bytes(field, value, out);
}

fn field_bytes(field: u32, value: &[u8], out: &mut Vec<u8>) {
    if value.is_empty() {
        return;
    }
    field_key(field, 2, out);
    encode_varint(value.len() as u64, out);
    out.extend_from_slice(value);
}

fn encode_varint(mut value: u64, out: &mut Vec<u8>) {
    while value >= 0x80 {
        out.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn deterministic_uuid(seed: &str) -> String {
    let first = hash_seed(seed, 0x9e37_79b9_7f4a_7c15);
    let second = hash_seed(seed, 0xc2b2_ae3d_27d4_eb4f);
    format_uuid((u128::from(first) << 64) | u128::from(second))
}

fn generated_uuid() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let counter = u128::from(ID_COUNTER.fetch_add(1, Ordering::Relaxed));
    format_uuid(nanos ^ (counter << 64))
}

fn hash_seed(seed: &str, salt: u64) -> u64 {
    let mut hasher = DefaultHasher::new();
    salt.hash(&mut hasher);
    seed.hash(&mut hasher);
    hasher.finish()
}

fn format_uuid(mut value: u128) -> String {
    value = (value & !(0xf_u128 << 76)) | (5_u128 << 76);
    value = (value & !(0x3_u128 << 62)) | (0x2_u128 << 62);
    let hex = format!("{value:032x}");
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_token_is_prefixed_once() {
        assert_eq!(normalize_session_token("abc"), "devin-session-token$abc");
        assert_eq!(
            normalize_session_token("devin-session-token$abc"),
            "devin-session-token$abc"
        );
    }

    #[test]
    fn provider_redirect_accepts_only_codeium_https_endpoints() {
        assert_eq!(
            resolve_chat_base_url(
                Some("https://enterprise.server.codeium.com/"),
                DEVIN_API_URL
            )
            .unwrap(),
            "https://enterprise.server.codeium.com"
        );
        assert!(resolve_chat_base_url(Some("http://127.0.0.1:8080"), DEVIN_API_URL).is_err());
        assert!(
            resolve_chat_base_url(Some("https://codeium.com.evil.test"), DEVIN_API_URL).is_err()
        );
    }

    #[test]
    fn response_decoder_reads_text_thinking_tools_and_usage() {
        let mut tool = Vec::new();
        field_string(1, "call-1", &mut tool);
        field_string(2, "propose_ideas", &mut tool);
        field_string(3, "{\"ideas\":[]}", &mut tool);
        let mut usage = Vec::new();
        field_varint(2, 42, &mut usage);
        field_varint(3, 7, &mut usage);
        let mut payload = Vec::new();
        field_string(3, "hello", &mut payload);
        field_message(6, &tool, &mut payload);
        field_message(7, &usage, &mut payload);
        field_string(9, "thinking", &mut payload);

        let decoded = decode_chat_response(&payload).unwrap();
        assert_eq!(decoded.delta_text, "hello");
        assert_eq!(decoded.delta_thinking, "thinking");
        assert_eq!(decoded.delta_tool_calls[0].name, "propose_ideas");
        assert_eq!(decoded.usage.unwrap().output_tokens, 7);
    }

    #[test]
    fn request_encodes_model_messages_and_tool_schema() {
        let request = ProviderRequest {
            model_id: "glm-5-2".to_string(),
            effort_level: "high".to_string(),
            system: Some("Use the skill".to_string()),
            messages: vec![ChatMsg::text("user", "Generate ideas")],
            api_key: Some("token".to_string()),
            base_url: None,
            tools: vec![ToolSchema {
                name: "propose_ideas".to_string(),
                description: "Propose options".to_string(),
                parameters: serde_json::json!({"type": "object"}),
            }],
        };
        let encoded = build_chat_request(&request, "token", "jwt");
        assert!(encoded
            .windows("glm-5-2".len())
            .any(|window| window == b"glm-5-2"));
        assert!(encoded
            .windows("propose_ideas".len())
            .any(|window| window == b"propose_ideas"));
        assert!(encoded
            .windows("Generate ideas".len())
            .any(|window| window == b"Generate ideas"));
    }

    #[test]
    fn malformed_frame_and_protobuf_are_rejected() {
        assert!(read_connect_frame(&mut &b"\x01\x00\x00"[..]).is_err());
        assert!(decode_chat_response(&[0x1a, 0x04, b'a']).is_err());
    }
}
