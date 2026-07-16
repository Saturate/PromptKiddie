use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct WinNetworkCheck;

impl Check for WinNetworkCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_listening_ports(&mut findings);
        check_shares(&mut findings);
        check_firewall(&mut findings);

        findings
    }
}

fn check_listening_ports(findings: &mut Vec<Finding>) {
    let output = match Command::new("netstat").args(["-ano"]).output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if !line.contains("LISTENING") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        let local = parts[1];
        let pid = parts[4];

        if local.contains("127.0.0.1") || local.contains("[::1]") {
            let port = local.rsplit(':').next().unwrap_or("");
            findings.push(Finding {
                check: "network",
                severity: Severity::Low,
                title: format!("localhost-only listener: port {port} (pid {pid})"),
                detail: "internal service, not externally reachable".into(),
                path: None,
                exploit_hint: Some("may expose admin panels, databases, or dev tools".into()),
            });
        }
    }
}

fn check_shares(findings: &mut Vec<Finding>) {
    let output = match Command::new("net").args(["share"]).output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines().skip(4) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("The command") {
            continue;
        }

        if !trimmed.contains('$') {
            findings.push(Finding {
                check: "network",
                severity: Severity::Low,
                title: format!(
                    "non-default share: {}",
                    trimmed.split_whitespace().next().unwrap_or("")
                ),
                detail: trimmed.to_string(),
                path: None,
                exploit_hint: None,
            });
        }
    }
}

fn check_firewall(findings: &mut Vec<Finding>) {
    let output = match Command::new("netsh")
        .args(["advfirewall", "show", "allprofiles", "state"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("OFF") {
        findings.push(Finding {
            check: "network",
            severity: Severity::Medium,
            title: "Windows Firewall has disabled profile(s)".into(),
            detail: "one or more firewall profiles are OFF".into(),
            path: None,
            exploit_hint: None,
        });
    }
}
