use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;

pub struct EnvCheck;

impl Check for EnvCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_ld_preload(&mut findings);
        check_ld_library_path(&mut findings);
        check_path_order(&mut findings);
        check_env_file_leaks(&mut findings);
        check_histfile(&mut findings);

        findings
    }
}

fn check_ld_preload(findings: &mut Vec<Finding>) {
    if let Ok(val) = std::env::var("LD_PRELOAD")
        && !val.is_empty()
    {
        findings.push(Finding {
            check: "env",
            severity: Severity::High,
            title: "LD_PRELOAD is set".into(),
            detail: format!("value: {val}"),
            path: None,
            exploit_hint: Some("injected shared library loaded into every process".into()),
        });
    }

    if let Ok(content) = fs::read_to_string("/etc/ld.so.preload") {
        let libs: Vec<&str> = content
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
            .collect();
        if !libs.is_empty() {
            findings.push(Finding {
                check: "env",
                severity: Severity::Medium,
                title: format!("/etc/ld.so.preload: {} libraries", libs.len()),
                detail: libs.join(", "),
                path: Some("/etc/ld.so.preload".into()),
                exploit_hint: None,
            });
        }

        if let Ok(meta) = fs::metadata("/etc/ld.so.preload") {
            use std::os::unix::fs::MetadataExt;
            let mode = meta.mode();
            let my_uid = nix::unistd::getuid().as_raw();
            if mode & 0o002 != 0 || (meta.uid() == my_uid && my_uid != 0) {
                findings.push(Finding {
                    check: "env",
                    severity: Severity::Critical,
                    title: "writable /etc/ld.so.preload".into(),
                    detail: format!("mode: {mode:o}"),
                    path: Some("/etc/ld.so.preload".into()),
                    exploit_hint: Some(
                        "add a malicious .so to intercept all dynamically linked programs".into(),
                    ),
                });
            }
        }
    }
}

fn check_ld_library_path(findings: &mut Vec<Finding>) {
    if let Ok(val) = std::env::var("LD_LIBRARY_PATH")
        && !val.is_empty()
    {
        for dir in val.split(':') {
            if let Ok(meta) = fs::metadata(dir) {
                use std::os::unix::fs::MetadataExt;
                let mode = meta.mode();
                let my_uid = nix::unistd::getuid().as_raw();
                if mode & 0o002 != 0 || (meta.uid() == my_uid && my_uid != 0) {
                    findings.push(Finding {
                        check: "env",
                        severity: Severity::High,
                        title: format!("writable LD_LIBRARY_PATH dir: {dir}"),
                        detail: format!("mode: {mode:o}"),
                        path: Some(dir.to_string()),
                        exploit_hint: Some(
                            "place malicious shared library to hijack dynamic linking".into(),
                        ),
                    });
                }
            }
        }
    }
}

fn check_path_order(findings: &mut Vec<Finding>) {
    if let Ok(path) = std::env::var("PATH") {
        let mut seen_system = false;
        for dir in path.split(':') {
            if dir == "/usr/bin" || dir == "/bin" || dir == "/usr/sbin" || dir == "/sbin" {
                seen_system = true;
                continue;
            }

            if !seen_system && let Ok(meta) = fs::metadata(dir) {
                use std::os::unix::fs::MetadataExt;
                let mode = meta.mode();
                let my_uid = nix::unistd::getuid().as_raw();
                if mode & 0o002 != 0 || (meta.uid() == my_uid && my_uid != 0) {
                    findings.push(Finding {
                        check: "env",
                        severity: Severity::High,
                        title: format!("writable dir before system PATH: {dir}"),
                        detail: "place binary here to shadow system commands".into(),
                        path: Some(dir.to_string()),
                        exploit_hint: Some(
                            "if root runs a command without full path, your binary executes".into(),
                        ),
                    });
                }
            }
        }

        if path.contains("::") || path.starts_with(':') || path.ends_with(':') {
            findings.push(Finding {
                check: "env",
                severity: Severity::Medium,
                title: "empty entry in PATH (current directory included)".into(),
                detail: "running commands from CWD as a PATH lookup".into(),
                path: None,
                exploit_hint: Some(
                    "place trojan in a directory where root might cd and run commands".into(),
                ),
            });
        }
    }
}

fn check_env_file_leaks(findings: &mut Vec<Finding>) {
    if let Ok(entries) = fs::read_dir("/proc") {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name();
            let pid = name.to_string_lossy();
            if !pid.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }

            let environ_path = format!("/proc/{pid}/environ");
            if let Ok(content) = fs::read_to_string(&environ_path) {
                let lower = content.to_lowercase();
                if lower.contains("password=")
                    || lower.contains("secret=")
                    || lower.contains("api_key=")
                    || lower.contains("token=")
                {
                    let cmdline = fs::read_to_string(format!("/proc/{pid}/cmdline"))
                        .unwrap_or_default()
                        .replace('\0', " ");

                    findings.push(Finding {
                        check: "env",
                        severity: Severity::High,
                        title: format!("secrets in environment of pid {pid}"),
                        detail: truncate(&cmdline, 80).to_string(),
                        path: Some(environ_path),
                        exploit_hint: None,
                    });
                }
            }
        }
    }
}

fn check_histfile(findings: &mut Vec<Finding>) {
    if let Ok(val) = std::env::var("HISTFILE")
        && val == "/dev/null"
    {
        findings.push(Finding {
            check: "env",
            severity: Severity::Info,
            title: "HISTFILE set to /dev/null".into(),
            detail: "shell history is not being recorded".into(),
            path: None,
            exploit_hint: None,
        });
    }

    if std::env::var("HISTSIZE").map(|v| v == "0").unwrap_or(false) {
        findings.push(Finding {
            check: "env",
            severity: Severity::Info,
            title: "HISTSIZE=0, shell history disabled".into(),
            detail: String::new(),
            path: None,
            exploit_hint: None,
        });
    }
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max { s } else { &s[..s.floor_char_boundary(max)] }
}
