use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;
use std::os::unix::fs::MetadataExt;
use walkdir::WalkDir;

pub struct SystemdCheck;

const UNIT_DIRS: &[&str] = &[
    "/etc/systemd/system",
    "/lib/systemd/system",
    "/usr/lib/systemd/system",
    "/run/systemd/system",
];

impl Check for SystemdCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();
        let my_uid = nix::unistd::getuid().as_raw();

        for dir in UNIT_DIRS {
            for entry in WalkDir::new(dir).max_depth(2).into_iter().filter_map(|e| e.ok()) {
                if !entry.file_type().is_file() { continue; }

                let path = entry.path();
                let name = entry.file_name().to_string_lossy();

                if !name.ends_with(".service") && !name.ends_with(".timer") && !name.ends_with(".socket") {
                    continue;
                }

                let path_str = path.to_string_lossy().to_string();

                if let Ok(meta) = path.metadata() {
                    let mode = meta.mode();
                    let owner = meta.uid();
                    let writable = mode & 0o002 != 0 || (owner == my_uid && my_uid != 0);

                    if writable {
                        findings.push(Finding {
                            check: "systemd",
                            severity: Severity::Critical,
                            title: format!("writable unit file: {name}"),
                            detail: format!("mode: {mode:o}, owner uid: {owner}"),
                            path: Some(path_str.clone()),
                            exploit_hint: Some("modify ExecStart to run a payload, then systemctl daemon-reload && systemctl restart".into()),
                        });
                    }
                }

                if let Ok(content) = fs::read_to_string(path) {
                    for line in content.lines() {
                        let trimmed = line.trim();
                        if !trimmed.starts_with("ExecStart=") && !trimmed.starts_with("ExecStartPre=") {
                            continue;
                        }

                        let cmd = trimmed.split('=').nth(1).unwrap_or("").trim();
                        let cmd = cmd.trim_start_matches(['-', '+', '!', '@']);
                        let binary = cmd.split_whitespace().next().unwrap_or("");

                        if binary.is_empty() || !binary.starts_with('/') { continue; }

                        if let Ok(meta) = fs::metadata(binary) {
                            let mode = meta.mode();
                            let owner = meta.uid();
                            let writable = mode & 0o002 != 0 || (owner == my_uid && my_uid != 0);

                            if writable {
                                let runs_as_root = !content.contains("User=") || content.contains("User=root");

                                findings.push(Finding {
                                    check: "systemd",
                                    severity: if runs_as_root { Severity::Critical } else { Severity::High },
                                    title: format!("writable service binary in {name}"),
                                    detail: format!("{binary} (mode: {mode:o})"),
                                    path: Some(binary.to_string()),
                                    exploit_hint: Some("replace binary with payload, restart service".into()),
                                });
                            }
                        }
                    }

                    if content.contains("User=root") || !content.contains("User=") {
                        for line in content.lines() {
                            if line.trim().starts_with("WorkingDirectory=") {
                                let dir = line.split('=').nth(1).unwrap_or("").trim();
                                if let Ok(meta) = fs::metadata(dir) {
                                    let mode = meta.mode();
                                    if mode & 0o002 != 0 {
                                        findings.push(Finding {
                                            check: "systemd",
                                            severity: Severity::High,
                                            title: format!("world-writable working dir for {name}"),
                                            detail: format!("{dir} (mode: {mode:o})"),
                                            path: Some(dir.to_string()),
                                            exploit_hint: Some("place files in working directory for service to pick up".into()),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        findings
    }
}
