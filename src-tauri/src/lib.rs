// Smart desktop: every call to the Worker goes through here.
//
// The Worker refuses POSTs that carry a different Origin header, and a webview always
// sends one, so the page never talks to the Worker itself. That also keeps the admin
// token out of the page: it lives in the OS keychain and only this file reads it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const KEYRING_SERVICE: &str = "Smart desktop";
const KEYRING_USER: &str = "admin-token";
pub const DEFAULT_BASE: &str = "https://smart.mattshosted.com";

struct Http(reqwest::Client);

/// IMDb id -> title, learned from Cinemeta and kept in titles.json next to config.json.
/// An empty name means Cinemeta has no entry, so it isn't asked again.
struct Names(Mutex<Option<HashMap<String, String>>>);

#[derive(Serialize, Deserialize, Default, Clone)]
struct StoredConfig {
    base_url: Option<String>,
}

#[derive(Serialize)]
struct ConfigView {
    base_url: String,
    connected: bool,
    default_base: &'static str,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No config folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make the config folder: {e}"))?;
    Ok(dir.join("config.json"))
}

fn load_config(app: &AppHandle) -> StoredConfig {
    config_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &StoredConfig) -> Result<(), String> {
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path(app)?, text).map_err(|e| format!("Could not save settings: {e}"))
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn read_token() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

/// "smart.example.com/" or "https://smart.example.com/app" -> "https://smart.example.com"
fn clean_base(raw: &str) -> Result<String, String> {
    let mut s = raw.trim().trim_end_matches('/').to_string();
    if s.is_empty() {
        s = DEFAULT_BASE.to_string();
    }
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("https://{s}");
    }
    let url = reqwest::Url::parse(&s).map_err(|_| "That web address doesn't look right.".to_string())?;
    let host = url.host_str().ok_or("That web address has no host.")?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{}://{}{}", url.scheme(), host, port))
}

fn current(app: &AppHandle) -> Result<(String, String), String> {
    let base = load_config(app).base_url.unwrap_or_else(|| DEFAULT_BASE.to_string());
    let token = read_token().ok_or("NOT_CONNECTED")?;
    Ok((base, token))
}

async fn read_json(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if status.as_u16() == 403 || status.as_u16() == 401 {
        return Err("BAD_TOKEN".into());
    }
    if !status.is_success() {
        let msg = body.get("error").and_then(Value::as_str).unwrap_or("The server said no");
        return Err(format!("{msg} ({})", status.as_u16()));
    }
    Ok(body)
}

async fn get_summary(http: &reqwest::Client, base: &str, token: &str) -> Result<Value, String> {
    let resp = http
        .get(format!("{base}/app/api/summary"))
        .header("X-Admin-Token", token)
        .send()
        .await
        .map_err(|e| net_err(&e))?;
    read_json(resp).await
}

fn net_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "OFFLINE: Smart took too long to answer.".into()
    } else if e.is_connect() {
        "OFFLINE: Can't reach Smart. Check the internet connection.".into()
    } else {
        format!("OFFLINE: {e}")
    }
}

#[tauri::command]
fn get_config(app: AppHandle) -> ConfigView {
    ConfigView {
        base_url: load_config(&app).base_url.unwrap_or_else(|| DEFAULT_BASE.to_string()),
        connected: read_token().is_some(),
        default_base: DEFAULT_BASE,
    }
}

/// Checks the address and token against the live summary before keeping either.
#[tauri::command]
async fn save_connection(app: AppHandle, http: State<'_, Http>, base_url: String, token: String) -> Result<Value, String> {
    let base = clean_base(&base_url)?;
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Paste the admin token first.".into());
    }
    let summary = match get_summary(&http.0, &base, &token).await {
        Err(e) if e == "BAD_TOKEN" => return Err("Smart answered, but didn't accept that token.".into()),
        Err(e) => return Err(e.trim_start_matches("OFFLINE: ").to_string()),
        Ok(v) => v,
    };
    if summary.get("routing").is_none() {
        return Err("That address answered, but it isn't a Smart server.".into());
    }
    entry()?.set_password(&token).map_err(|e| format!("Couldn't save to the keychain: {e}"))?;
    save_config(&app, &StoredConfig { base_url: Some(base) })?;
    Ok(summary)
}

#[tauri::command]
async fn summary(app: AppHandle, http: State<'_, Http>) -> Result<Value, String> {
    let (base, token) = current(&app)?;
    get_summary(&http.0, &base, &token).await
}

#[tauri::command]
async fn action(app: AppHandle, http: State<'_, Http>, body: Value) -> Result<Value, String> {
    if body.get("action").and_then(Value::as_str).is_none() {
        return Err("No action given.".into());
    }
    let (base, token) = current(&app)?;
    let resp = http
        .0
        .post(format!("{base}/app/api/action"))
        .header("X-Admin-Token", token)
        .json(&body)
        .send()
        .await
        .map_err(|e| net_err(&e))?;
    read_json(resp).await
}

/// Signs out: removes the token from the keychain. The address stays for next time.
#[tauri::command]
fn forget() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove the token: {e}")),
    }
}

fn names_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_path(app)?.with_file_name("titles.json"))
}

fn names_load(app: &AppHandle, names: &Names) -> HashMap<String, String> {
    let mut g = names.0.lock().unwrap();
    if g.is_none() {
        let m: HashMap<String, String> = names_path(app)
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        *g = Some(m);
    }
    g.as_ref().unwrap().clone()
}

#[derive(Deserialize)]
struct TitleAsk {
    id: String,
    kind: String,
}

fn is_imdb_id(id: &str) -> bool {
    id.len() > 2 && id.len() <= 12 && id.starts_with("tt") && id[2..].chars().all(|c| c.is_ascii_digit())
}

/// Ok(None) when Cinemeta has no such title; Err when it couldn't be asked (try again later).
async fn cinemeta(http: &reqwest::Client, kind: &str, id: &str) -> Result<Option<String>, ()> {
    let url = format!("https://v3-cinemeta.strem.io/meta/{kind}/{id}.json");
    let resp = http.get(url).timeout(Duration::from_secs(6)).send().await.map_err(|_| ())?;
    let status = resp.status();
    if status.as_u16() == 404 {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(());
    }
    let v: Value = resp.json().await.map_err(|_| ())?;
    Ok(v.get("meta")
        .and_then(|m| m.get("name"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(80).collect()))
}

/// Names for the IMDb ids the search log couldn't name. Looks each id up once.
#[tauri::command]
async fn titles(app: AppHandle, http: State<'_, Http>, names: State<'_, Names>, ids: Vec<TitleAsk>) -> Result<HashMap<String, String>, String> {
    let known = names_load(&app, &names);
    let mut out = HashMap::new();
    let mut tasks = Vec::new();
    for ask in ids.into_iter().take(60) {
        let id = ask.id.trim().to_string();
        if !is_imdb_id(&id) {
            continue;
        }
        if let Some(n) = known.get(&id) {
            if !n.is_empty() {
                out.insert(id, n.clone());
            }
            continue;
        }
        let client = http.0.clone();
        let first = if ask.kind == "series" { "series" } else { "movie" };
        let second = if first == "series" { "movie" } else { "series" };
        tasks.push(tauri::async_runtime::spawn(async move {
            let mut res = cinemeta(&client, first, &id).await;
            if let Ok(None) = res {
                res = cinemeta(&client, second, &id).await;
            }
            (id, res)
        }));
    }
    let mut learned: Vec<(String, String)> = Vec::new();
    for t in tasks {
        if let Ok((id, res)) = t.await {
            match res {
                Ok(Some(name)) => {
                    out.insert(id.clone(), name.clone());
                    learned.push((id, name));
                }
                Ok(None) => learned.push((id, String::new())),
                Err(()) => {}
            }
        }
    }
    if !learned.is_empty() {
        let snapshot = {
            let mut g = names.0.lock().unwrap();
            let m = g.get_or_insert_with(HashMap::new);
            if m.len() > 5000 {
                m.clear();
            }
            for (id, n) in learned {
                m.insert(id, n);
            }
            serde_json::to_string(&*m).unwrap_or_default()
        };
        if let Ok(p) = names_path(&app) {
            let _ = std::fs::write(p, snapshot);
        }
    }
    Ok(out)
}

/// The page calls this after its first paint, so the window never opens on an empty frame.
#[tauri::command]
fn ready(window: tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent(concat!("Smart-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("http client");
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(Http(client))
        .manage(Names(Mutex::new(None)))
        .setup(|app| {
            // If the page never says it's ready, show the window anyway.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2500));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, save_connection, summary, action, forget, ready, titles])
        .run(tauri::generate_context!())
        .expect("error while running Smart");
}
