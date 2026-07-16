use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;
use std::os::unix::fs::MetadataExt;

pub struct CronCheck;

const CRON_DIRS: &[&str] = &[
    "/etc/cron.d",
    "/etc/cron.daily",
    "/etc/cron.hourly",
    "/etc/cron.weekly",
    "/etc/cron.monthly",
    "/var/spool/cron",
    "/var/spool/cron/crontabs",
];

impl Check for CronCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_crontab(&mut findings);
        check_cron_dirs(&mut findings);
        check_systemd_timers(&mut findings);

        findings
    }
}

fn check_crontab(findings: &mut Vec<Finding>) {
    if let Ok(content) = fs::read_to_string("/etc/crontab") {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            check_cron_line(trimmed, "/etc/crontab", findings);
        }
    }
}

fn check_cron_dirs(findings: &mut Vec<Finding>) {
    for dir in CRON_DIRS {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let path_str = path.to_string_lossy().to_string();

            if let Ok(meta) = path.metadata() {
                let mode = meta.mode();
                if mode & 0o002 != 0 {
                    findings.push(Finding {
                        check: "cron",
                        severity: Severity::Critical,
                        title: "world-writable cron file".into(),
                        detail: format!("mode: {mode:o}"),
                        path: Some(path_str.clone()),
                        exploit_hint: Some("inject a reverse shell into this cron file".into()),
                    });
                }
            }

            if let Ok(content) = fs::read_to_string(&path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    check_cron_line(trimmed, &path_str, findings);
                }
            }
        }
    }
}

fn check_cron_line(line: &str, source: &str, findings: &mut Vec<Finding>) {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 6 {
        return;
    }

    let cmd_start = if parts.len() > 6 { 6 } else { 5 };
    let cmd = parts[cmd_start..].join(" ");

    for part in &parts[cmd_start..] {
        let path = part.trim_matches(|c: char| !c.is_ascii() || c == '"' || c == '\'');
        if !path.starts_with('/') {
            continue;
        }

        if let Ok(meta) = fs::metadata(path) {
            let mode = meta.mode();
            let my_uid = nix::unistd::getuid().as_raw();
            let file_uid = meta.uid();

            if mode & 0o002 != 0 || (my_uid == file_uid && mode & 0o200 != 0) {
                findings.push(Finding {
                    check: "cron",
                    severity: Severity::High,
                    title: "writable script in cron job".into(),
                    detail: format!("cron cmd: {cmd} (from {source})"),
                    path: Some(path.to_string()),
                    exploit_hint: Some(
                        "modify this script to run a payload as the cron user".into(),
                    ),
                });
            }
        }
    }

    if cmd.contains('*') {
        findings.push(Finding {
            check: "cron",
            severity: Severity::Medium,
            title: "wildcard in cron command".into(),
            detail: format!("cmd: {cmd} (from {source})"),
            path: Some(source.into()),
            exploit_hint: Some("tar/chown/rsync wildcard injection may apply".into()),
        });
    }
}

fn check_systemd_timers(findings: &mut Vec<Finding>) {
    if let Ok(output) = std::process::Command::new("systemctl")
        .args(["list-timers", "--all", "--no-pager"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().skip(1) {
            if line.trim().is_empty() || line.contains("NEXT") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(unit) = parts.last()
                && unit.ends_with(".timer")
            {
                findings.push(Finding {
                    check: "cron",
                    severity: Severity::Info,
                    title: format!("systemd timer: {unit}"),
                    detail: line.trim().to_string(),
                    path: None,
                    exploit_hint: None,
                });
            }
        }
    }
}
