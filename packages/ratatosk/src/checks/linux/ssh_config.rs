use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;

pub struct SshConfigCheck;

impl Check for SshConfigCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_sshd_config(&mut findings);
        check_user_ssh_config(&mut findings);
        check_ssh_agents(&mut findings);

        findings
    }
}

fn check_sshd_config(findings: &mut Vec<Finding>) {
    let config_paths = ["/etc/ssh/sshd_config", "/etc/ssh/sshd_config.d"];

    for path in &config_paths {
        let content = if std::path::Path::new(path).is_dir() {
            let mut combined = String::new();
            if let Ok(entries) = fs::read_dir(path) {
                for entry in entries.filter_map(|e| e.ok()) {
                    if let Ok(c) = fs::read_to_string(entry.path()) {
                        combined.push_str(&c);
                        combined.push('\n');
                    }
                }
            }
            combined
        } else {
            match fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            }
        };

        let checks = [
            ("PermitRootLogin", "yes", Severity::Medium, "root can SSH in directly"),
            ("PasswordAuthentication", "yes", Severity::Low, "password auth enabled (brute force possible)"),
            ("PermitEmptyPasswords", "yes", Severity::Critical, "empty passwords allowed for SSH"),
            ("AllowAgentForwarding", "yes", Severity::Medium, "agent forwarding can be hijacked if root"),
            ("X11Forwarding", "yes", Severity::Low, "X11 forwarding enabled"),
        ];

        for (key, bad_value, severity, detail) in &checks {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('#') { continue; }
                let lower = trimmed.to_lowercase();
                if lower.starts_with(&key.to_lowercase()) {
                    let value = trimmed.split_whitespace().nth(1).unwrap_or("");
                    if value.to_lowercase() == *bad_value {
                        findings.push(Finding {
                            check: "ssh_config",
                            severity: *severity,
                            title: format!("{key} {value}"),
                            detail: detail.to_string(),
                            path: Some(path.to_string()),
                            exploit_hint: None,
                        });
                    }
                }
            }
        }
    }
}

fn check_user_ssh_config(findings: &mut Vec<Finding>) {
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() { return; }

    let config_path = format!("{home}/.ssh/config");
    let content = match fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() { continue; }

        let lower = trimmed.to_lowercase();

        if lower.starts_with("proxycommand") {
            findings.push(Finding {
                check: "ssh_config",
                severity: Severity::Low,
                title: "ProxyCommand in SSH config".into(),
                detail: trimmed.to_string(),
                path: Some(config_path.clone()),
                exploit_hint: None,
            });
        }

        if lower.starts_with("hostname") || lower.starts_with("host ") {
            findings.push(Finding {
                check: "ssh_config",
                severity: Severity::Info,
                title: format!("SSH config entry: {trimmed}"),
                detail: "may indicate accessible hosts".into(),
                path: Some(config_path.clone()),
                exploit_hint: None,
            });
        }
    }
}

fn check_ssh_agents(findings: &mut Vec<Finding>) {
    if let Ok(agent_sock) = std::env::var("SSH_AUTH_SOCK") {
        if std::path::Path::new(&agent_sock).exists() {
            findings.push(Finding {
                check: "ssh_config",
                severity: Severity::Info,
                title: "SSH agent socket available".into(),
                detail: agent_sock.clone(),
                path: Some(agent_sock),
                exploit_hint: None,
            });
        }
    }

    if let Ok(entries) = fs::read_dir("/tmp") {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("ssh-") {
                let dir = entry.path();
                if let Ok(inner) = fs::read_dir(&dir) {
                    for sock in inner.filter_map(|e| e.ok()) {
                        let sock_path = sock.path().to_string_lossy().to_string();
                        if std::os::unix::net::UnixStream::connect(&sock_path).is_ok() {
                            let my_dir = std::env::var("SSH_AUTH_SOCK").unwrap_or_default();
                            if !sock_path.contains(&my_dir) {
                                findings.push(Finding {
                                    check: "ssh_config",
                                    severity: Severity::High,
                                    title: "accessible SSH agent socket (other user)".into(),
                                    detail: "can hijack forwarded agent to authenticate as that user".into(),
                                    path: Some(sock_path),
                                    exploit_hint: Some("SSH_AUTH_SOCK=<path> ssh target".into()),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
}
