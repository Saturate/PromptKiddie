use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct DllHijackCheck;

impl Check for DllHijackCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_writable_path_dirs(&mut findings);
        check_missing_dlls(&mut findings);

        findings
    }
}

fn check_writable_path_dirs(findings: &mut Vec<Finding>) {
    let path_var = match std::env::var("PATH") {
        Ok(p) => p,
        Err(_) => return,
    };

    let user = std::env::var("USERNAME").unwrap_or_default().to_lowercase();
    let groups = ["everyone", "users", "authenticated users", user.as_str()];

    for dir in path_var.split(';') {
        let dir = dir.trim();
        if dir.is_empty() { continue; }

        if dir.to_lowercase().starts_with("c:\\windows") { continue; }

        if let Ok(icacls) = Command::new("icacls").arg(dir).output() {
            let perms = String::from_utf8_lossy(&icacls.stdout).to_lowercase();
            if (perms.contains("(f)") || perms.contains("(m)") || perms.contains("(w)") || perms.contains("(oi)(ci)(f)"))
                && groups.iter().any(|g| perms.contains(g))
            {
                findings.push(Finding {
                    check: "dll_hijack",
                    severity: Severity::High,
                    title: "writable PATH directory".into(),
                    detail: "can plant DLLs that privileged processes will load".into(),
                    path: Some(dir.to_string()),
                    exploit_hint: Some("place malicious DLL matching a missing import".into()),
                });
            }
        }
    }
}

fn check_missing_dlls(findings: &mut Vec<Finding>) {
    let known_hijackable = [
        ("wlbsctrl.dll", "IKEEXT service", "net start IKEEXT"),
        ("wlanapi.dll", "WLAN AutoConfig", "common on servers without WiFi"),
        ("CRYPTBASE.dll", "various services via KnownDLLs bypass", "place in app directory"),
        ("profapi.dll", "various services", "place in writable PATH"),
    ];

    for (dll, service, hint) in &known_hijackable {
        let system32_path = format!(r"C:\Windows\System32\{dll}");
        if !std::path::Path::new(&system32_path).exists() {
            findings.push(Finding {
                check: "dll_hijack",
                severity: Severity::Medium,
                title: format!("potentially hijackable DLL missing: {dll}"),
                detail: format!("used by: {service}"),
                path: None,
                exploit_hint: Some(hint.to_string()),
            });
        }
    }
}
