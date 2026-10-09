//! AI 分析：调用 OpenAI 兼容接口（可配置 base_url / model / key），
//! 服务端代理请求，密钥只存本机 ~/.codeview/ai.json。

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AiConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

fn cfg_file() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(|h| PathBuf::from(h).join(".codeview").join("ai.json"))
}

pub fn load_config() -> AiConfig {
    cfg_file()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_config(cfg: &AiConfig) -> Result<()> {
    let Some(f) = cfg_file() else { bail!("无法定位用户目录") };
    if let Some(parent) = f.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&f, serde_json::to_string_pretty(cfg)?)?;
    Ok(())
}

/// 对外暴露的配置（不回传密钥本体）
pub fn public_config(cfg: &AiConfig) -> Value {
    json!({
        "base_url": cfg.base_url,
        "model": cfg.model,
        "has_key": !cfg.api_key.is_empty(),
    })
}

#[derive(Deserialize)]
pub struct AskReq {
    pub question: String,
    #[serde(default)]
    pub file: Option<FileCtx>,
    #[serde(default)]
    pub include_tree: bool,
    #[serde(default)]
    pub include_git: bool,
}

#[derive(Deserialize)]
pub struct FileCtx {
    pub path: String,
    pub content: String,
}

pub fn ask(req: &AskReq, project_tree: Option<String>, git_digest: Option<String>) -> Result<String> {
    let cfg = load_config();
    if cfg.api_key.is_empty() {
        bail!("尚未配置 AI：点击「配置」填写接口地址、模型与 API Key");
    }
    if cfg.base_url.is_empty() || cfg.model.is_empty() {
        bail!("AI 配置不完整：需要 base_url 与 model");
    }
    if req.question.trim().is_empty() {
        bail!("请输入问题");
    }

    let mut context = String::new();
    if let Some(t) = project_tree {
        context.push_str(&format!("<项目结构>\n{}\n</项目结构>\n\n", t));
    }
    if let Some(g) = git_digest {
        context.push_str(&format!("<git 摘要>\n{}\n</git 摘要>\n\n", g));
    }
    if let Some(f) = &req.file {
        let content = if f.content.chars().count() > 120_000 {
            let head: String = f.content.chars().take(120_000).collect();
            format!("{head}\n…（已截断）")
        } else {
            f.content.clone()
        };
        context.push_str(&format!("<当前文件 path=\"{}\">\n{}\n</当前文件>\n\n", f.path, content));
    }

    let system = "你是 CodeView 的编程助手，服务于一个代码查看器。回答要求：使用中文；结构清晰（可用小标题与列表）；结论先行；涉及代码时给出具体文件路径与行号；不确定的内容明确说明。";
    let user = format!("{context}问题：{}", req.question.trim());

    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let payload = json!({
        "model": cfg.model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    });

    let resp: Value = ureq::post(&url)
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {}", cfg.api_key))
        .timeout(std::time::Duration::from_secs(120))
        .send_json(payload)
        .map_err(|e| anyhow::anyhow!("请求失败: {e}"))?
        .into_json()
        .context("响应不是有效 JSON")?;

    let answer = resp
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .or_else(|| resp.pointer("/error/message").and_then(|v| v.as_str()))
        .ok_or_else(|| anyhow::anyhow!("响应中没有结果字段"))?;
    Ok(answer.to_string())
}