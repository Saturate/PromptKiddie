use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct CapCheck;

const DANGEROUS_CAPS: &[&str] = &[
    "cap_setuid",
    "cap_setgid",
    "cap_dac_override",
    "cap_dac_read_search",
    "cap_sys_admin",
    "cap_sys_ptrace",
    "cap_sys_module",
    "cap_net_raw",
    "cap_net_admin",
    "cap_chown",
    "cap_fowner",
    "cap_net_bind_service",
];

impl Check for CapCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        let output = match Command::new("getcap").args(["-r", "/"]).output() {
            Ok(o) => o,
            Err(_) => return findings,
        };

        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        for line in combined.lines() {
            if line.contains("Operation not permitted") || line.trim().is_empty() {
                continue;
            }

            let dangerous: Vec<&&str> = DANGEROUS_CAPS
                .iter()
                .filter(|cap| line.to_lowercase().contains(**cap))
                .collect();

            if dangerous.is_empty() {
                continue;
            }

            let severity = if dangerous
                .iter()
                .any(|c| **c == "cap_setuid" || **c == "cap_sys_admin")
            {
                Severity::Critical
            } else if dangerous
                .iter()
                .any(|c| **c == "cap_dac_override" || **c == "cap_sys_ptrace")
            {
                Severity::High
            } else {
                Severity::Medium
            };

            let path = line.split_whitespace().next().unwrap_or("").to_string();
            let caps_str = dangerous.iter().map(|c| **c).collect::<Vec<_>>().join(", ");

            findings.push(Finding {
                check: "capabilities",
                severity,
                title: format!("dangerous capabilities: {caps_str}"),
                detail: line.trim().to_string(),
                path: Some(path),
                exploit_hint: Some("check GTFOBins for capability abuse on this binary".into()),
            });
        }

        findings
    }
}
