use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct SudoCheck;

const DANGEROUS_SUDO: &[&str] = &[
    "ALL", "NOPASSWD", "env_keep",
    "bash", "sh", "dash", "zsh", "python", "python3", "perl", "ruby",
    "vim", "vi", "nano", "less", "more", "find", "awk",
    "cp", "mv", "dd", "tar", "zip",
    "wget", "curl", "nc", "ncat",
    "docker", "lxc", "env", "strace", "gdb",
    "nmap", "tee", "chmod", "chown",
    "systemctl", "journalctl", "apt", "apt-get", "yum", "dnf",
    "pip", "pip3", "npm", "node",
    "mysql", "psql", "sqlite3",
    "ssh", "scp", "rsync",
    "openssl", "base64",
];

impl Check for SudoCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        let output = Command::new("sudo")
            .args(["-l", "-n"])
            .output();

        let output = match output {
            Ok(o) => o,
            Err(_) => return findings,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        if stderr.contains("password is required") {
            return findings;
        }

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("Matching") || trimmed.starts_with("User") {
                continue;
            }

            let nopasswd = trimmed.contains("NOPASSWD");
            let has_dangerous = DANGEROUS_SUDO.iter().any(|&d| trimmed.contains(d));

            let severity = if nopasswd && trimmed.contains("ALL") {
                Severity::Critical
            } else if nopasswd && has_dangerous {
                Severity::High
            } else if has_dangerous {
                Severity::Medium
            } else {
                Severity::Low
            };

            let hint = if nopasswd && trimmed.contains("ALL") {
                Some("NOPASSWD ALL: sudo su or sudo bash for root shell".into())
            } else if nopasswd {
                Some(format!("NOPASSWD: check GTFOBins for {trimmed}"))
            } else {
                None
            };

            findings.push(Finding {
                check: "sudo",
                severity,
                title: format!("sudo rule: {trimmed}"),
                detail: "from sudo -l".into(),
                path: None,
                exploit_hint: hint,
            });
        }

        findings
    }
}
