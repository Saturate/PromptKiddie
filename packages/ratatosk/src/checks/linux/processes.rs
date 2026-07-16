use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;
use std::os::unix::fs::MetadataExt;

pub struct ProcessCheck;

impl Check for ProcessCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        let entries = match fs::read_dir("/proc") {
            Ok(e) => e,
            Err(_) => return findings,
        };

        let my_uid = nix::unistd::getuid().as_raw();

        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name();
            let pid_str = name.to_string_lossy();
            if !pid_str.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }

            let status_path = format!("/proc/{pid_str}/status");
            let cmdline_path = format!("/proc/{pid_str}/cmdline");
            let exe_path = format!("/proc/{pid_str}/exe");

            let uid = match fs::read_to_string(&status_path) {
                Ok(status) => status
                    .lines()
                    .find(|l| l.starts_with("Uid:"))
                    .and_then(|l| l.split_whitespace().nth(1))
                    .and_then(|u| u.parse::<u32>().ok())
                    .unwrap_or(u32::MAX),
                Err(_) => continue,
            };

            if uid != 0 {
                continue;
            }

            let cmdline = fs::read_to_string(&cmdline_path)
                .unwrap_or_default()
                .replace('\0', " ")
                .trim()
                .to_string();

            if cmdline.is_empty() {
                continue;
            }

            let exe = fs::read_link(&exe_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            if !exe.is_empty()
                && let Ok(meta) = fs::metadata(&exe)
            {
                let mode = meta.mode();
                let owner = meta.uid();
                let writable = mode & 0o002 != 0 || (owner == my_uid && my_uid != 0);

                if writable {
                    findings.push(Finding {
                        check: "processes",
                        severity: Severity::Critical,
                        title: format!("writable root process binary: {exe}"),
                        detail: format!("pid {pid_str}: {}", truncate(&cmdline, 100)),
                        path: Some(exe),
                        exploit_hint: Some("replace binary, wait for process restart".into()),
                    });
                }
            }
        }

        findings
    }
}

fn truncate(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len { s } else { &s[..s.floor_char_boundary(max_len)] }
}
