use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use serde_json::Value;

pub struct Client {
    base_url: String,
    http: reqwest::Client,
}

impl Client {
    pub fn new(base_url: &str) -> Self {
        let mut headers = HeaderMap::new();
        if let Ok(key) = std::env::var("GLEIPNIR_API_KEY")
            && !key.is_empty()
            && let Ok(val) = HeaderValue::from_str(&format!("Bearer {key}"))
        {
            headers.insert(AUTHORIZATION, val);
        }

        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::builder()
                .default_headers(headers)
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    pub async fn get(&self, path: &str) -> Result<Value, String> {
        let url = format!("{}{path}", self.base_url);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("invalid JSON response: {e}"))?;

        if !status.is_success() {
            let msg = body
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("{status}: {msg}"));
        }
        Ok(body)
    }

    pub async fn post(&self, path: &str, body: &Value) -> Result<Value, String> {
        let url = format!("{}{path}", self.base_url);
        let resp = self
            .http
            .post(&url)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?;

        let status = resp.status();
        let resp_body: Value = resp
            .json()
            .await
            .map_err(|e| format!("invalid JSON response: {e}"))?;

        if !status.is_success() {
            let msg = resp_body
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("{status}: {msg}"));
        }
        Ok(resp_body)
    }

    pub async fn delete(&self, path: &str) -> Result<Value, String> {
        let url = format!("{}{path}", self.base_url);
        let resp = self
            .http
            .delete(&url)
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("invalid JSON response: {e}"))?;

        if !status.is_success() {
            let msg = body
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("{status}: {msg}"));
        }
        Ok(body)
    }
}
