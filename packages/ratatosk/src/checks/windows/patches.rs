use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct PatchCheck;

struct KnownVuln {
    cve: &'static str,
    name: &'static str,
    builds_before: &'static [u32],
    severity: Severity,
    hint: &'static str,
}

const KNOWN_VULNS: &[KnownVuln] = &[
    KnownVuln {
        cve: "CVE-2021-36934",
        name: "HiveNightmare/SeriousSAM",
        builds_before: &[19041, 19042, 19043, 19044],
        severity: Severity::High,
        hint: "read SAM via volume shadow copy: icacls C:\\Windows\\System32\\config\\SAM",
    },
    KnownVuln {
        cve: "CVE-2021-1675",
        name: "PrintNightmare",
        builds_before: &[19041, 19042, 19043, 20348],
        severity: Severity::Critical,
        hint: "RCE via print spooler, check if spooler is running",
    },
    KnownVuln {
        cve: "CVE-2020-1472",
        name: "Zerologon",
        builds_before: &[17763, 18363, 19041, 19042],
        severity: Severity::Critical,
        hint: "domain controller only: reset machine account password to empty",
    },
];

impl Check for PatchCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_os_version(&mut findings);
        check_installed_patches(&mut findings);
        check_print_spooler(&mut findings);

        findings
    }
}

fn check_os_version(findings: &mut Vec<Finding>) {
    let output = match Command::new("cmd")
        .args(["/c", "ver"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let version_line = stdout.trim().to_string();

    findings.push(Finding {
        check: "patches",
        severity: Severity::Info,
        title: format!("OS version: {version_line}"),
        detail: String::new(),
        path: None,
        exploit_hint: None,
    });

    if let Some(build) = extract_build(&version_line) {
        for vuln in KNOWN_VULNS {
            if vuln.builds_before.iter().any(|&b| build <= b) {
                findings.push(Finding {
                    check: "patches",
                    severity: vuln.severity,
                    title: format!("{}: {}", vuln.name, vuln.cve),
                    detail: format!("build {build} may be vulnerable"),
                    path: None,
                    exploit_hint: Some(vuln.hint.to_string()),
                });
            }
        }
    }
}

fn check_installed_patches(findings: &mut Vec<Finding>) {
    let output = match Command::new("wmic")
        .args(["qfe", "get", "HotfixID,InstalledOn"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let patches: Vec<&str> = stdout.lines()
        .filter(|l| l.contains("KB"))
        .map(|l| l.trim())
        .collect();

    let latest = patches.last().map(|l| l.to_string()).unwrap_or_default();

    findings.push(Finding {
        check: "patches",
        severity: Severity::Info,
        title: format!("{} patches installed", patches.len()),
        detail: format!("most recent: {latest}"),
        path: None,
        exploit_hint: None,
    });
}

fn check_print_spooler(findings: &mut Vec<Finding>) {
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-Service Spooler | Select-Object -ExpandProperty Status"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim() == "Running" {
        findings.push(Finding {
            check: "patches",
            severity: Severity::Medium,
            title: "Print Spooler service is running".into(),
            detail: "potential PrintNightmare / SpoolFool target".into(),
            path: None,
            exploit_hint: Some("check if CVE-2021-1675 / CVE-2021-34527 is patched".into()),
        });
    }
}

fn extract_build(ver: &str) -> Option<u32> {
    let start = ver.find('[')?;
    let end = ver.find(']')?;
    let inner = &ver[start + 1..end];
    let parts: Vec<&str> = inner.split('.').collect();
    parts.get(2)?.parse().ok()
}
