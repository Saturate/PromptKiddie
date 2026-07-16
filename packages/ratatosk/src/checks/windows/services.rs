use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::path::Path;
use std::process::Command;

pub struct ServiceCheck;

impl Check for ServiceCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_unquoted_paths(&mut findings);
        check_writable_service_binaries(&mut findings);
        check_modifiable_services(&mut findings);

        findings
    }
}

fn check_unquoted_paths(findings: &mut Vec<Finding>) {
    let output = match Command::new("wmic")
        .args(["service", "get", "name,displayname,pathname,startmode"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("DisplayName")
            || trimmed.starts_with("Name")
        {
            continue;
        }

        if let Some(path_start) = trimmed.find("C:\\") {
            let path_portion = &trimmed[path_start..];
            let exe_path = path_portion.split("  ").next().unwrap_or(path_portion);

            if exe_path.contains(' ') && !exe_path.starts_with('"') {
                if exe_path.starts_with("C:\\Windows\\") { continue; }

                findings.push(Finding {
                    check: "services",
                    severity: Severity::High,
                    title: "unquoted service path with spaces".into(),
                    detail: trimmed.to_string(),
                    path: Some(exe_path.to_string()),
                    exploit_hint: Some("place a binary at the truncated path to hijack service start".into()),
                });
            }
        }
    }
}

fn check_writable_service_binaries(findings: &mut Vec<Finding>) {
    let output = match Command::new("wmic")
        .args(["service", "get", "name,pathname"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines().skip(1) {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        if let Some(path_start) = trimmed.find("C:\\") {
            let path_portion = &trimmed[path_start..];
            let exe_path = path_portion
                .trim_matches('"')
                .split(" /").next()
                .unwrap_or(path_portion)
                .split(" -").next()
                .unwrap_or(path_portion)
                .trim();

            if exe_path.starts_with("C:\\Windows\\System32") { continue; }

            let path = Path::new(exe_path);
            if !path.exists() { continue; }

            if let Ok(icacls) = Command::new("icacls").arg(exe_path).output() {
                let perms = String::from_utf8_lossy(&icacls.stdout).to_lowercase();
                if perms.contains("(f)") || perms.contains("(m)") || perms.contains("(w)") {
                    let user = std::env::var("USERNAME").unwrap_or_default().to_lowercase();
                    let groups = ["everyone", "users", "authenticated users", &user];
                    if groups.iter().any(|g| perms.contains(g)) {
                        findings.push(Finding {
                            check: "services",
                            severity: Severity::Critical,
                            title: "writable service binary".into(),
                            detail: perms.lines().take(3).collect::<Vec<_>>().join(" | "),
                            path: Some(exe_path.to_string()),
                            exploit_hint: Some("replace binary with payload, restart service for SYSTEM shell".into()),
                        });
                    }
                }
            }
        }
    }
}

fn check_modifiable_services(findings: &mut Vec<Finding>) {
    let output = match Command::new("sc").args(["query", "type=", "service", "state=", "all"]).output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let service_names: Vec<&str> = stdout
        .lines()
        .filter(|l| l.starts_with("SERVICE_NAME:"))
        .filter_map(|l| l.split(':').nth(1).map(|s| s.trim()))
        .collect();

    for svc in service_names.iter().take(50) {
        if let Ok(qc) = Command::new("sc").args(["qc", svc]).output() {
            let config = String::from_utf8_lossy(&qc.stdout);

            if config.contains("LocalSystem") {
                if let Ok(sdshow) = Command::new("sc").args(["sdshow", svc]).output() {
                    let sd = String::from_utf8_lossy(&sdshow.stdout);
                    if sd.contains("(A;;RPWP") || sd.contains("(A;;GA") {
                        findings.push(Finding {
                            check: "services",
                            severity: Severity::High,
                            title: format!("modifiable SYSTEM service: {svc}"),
                            detail: "service runs as LocalSystem and may be reconfigurable".into(),
                            path: None,
                            exploit_hint: Some("sc config <svc> binpath= \"cmd /c payload.exe\"".into()),
                        });
                    }
                }
            }
        }
    }
}
