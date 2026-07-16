use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct TokenCheck;

const DANGEROUS_PRIVS: &[(&str, Severity, &str)] = &[
    (
        "SeImpersonatePrivilege",
        Severity::Critical,
        "potato family (GodPotato, PrintSpoofer, JuicyPotato)",
    ),
    (
        "SeAssignPrimaryTokenPrivilege",
        Severity::Critical,
        "potato family or token manipulation",
    ),
    (
        "SeDebugPrivilege",
        Severity::Critical,
        "inject into any process, dump LSASS",
    ),
    (
        "SeBackupPrivilege",
        Severity::High,
        "read any file including SAM/SYSTEM",
    ),
    (
        "SeRestorePrivilege",
        Severity::High,
        "write any file, DLL hijack system services",
    ),
    (
        "SeTakeOwnershipPrivilege",
        Severity::High,
        "take ownership of any object",
    ),
    (
        "SeLoadDriverPrivilege",
        Severity::High,
        "load vulnerable kernel driver for LPE",
    ),
    (
        "SeManageVolumePrivilege",
        Severity::Medium,
        "read raw disk, access any file",
    ),
    (
        "SeTcbPrivilege",
        Severity::Critical,
        "act as part of the OS",
    ),
];

impl Check for TokenCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_privileges(&mut findings);
        check_groups(&mut findings);

        findings
    }
}

fn check_privileges(findings: &mut Vec<Finding>) {
    let output = match Command::new("whoami").arg("/priv").output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    for (priv_name, severity, hint) in DANGEROUS_PRIVS {
        if stdout.contains(priv_name) {
            let enabled = stdout
                .lines()
                .find(|l| l.contains(priv_name))
                .is_some_and(|l| l.contains("Enabled"));

            findings.push(Finding {
                check: "tokens",
                severity: *severity,
                title: format!(
                    "{priv_name} {}",
                    if enabled {
                        "(enabled)"
                    } else {
                        "(disabled, may be enableable)"
                    }
                ),
                detail: "current user holds this privilege".into(),
                path: None,
                exploit_hint: Some(hint.to_string()),
            });
        }
    }
}

fn check_groups(findings: &mut Vec<Finding>) {
    let output = match Command::new("whoami").arg("/groups").output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("S-1-5-32-544") {
        findings.push(Finding {
            check: "tokens",
            severity: Severity::High,
            title: "member of local Administrators group".into(),
            detail: "may be able to bypass UAC for full admin".into(),
            path: None,
            exploit_hint: Some("UAC bypass techniques (fodhelper, eventvwr, etc.)".into()),
        });
    }

    if stdout.contains("S-1-5-32-551") {
        findings.push(Finding {
            check: "tokens",
            severity: Severity::Medium,
            title: "member of Backup Operators group".into(),
            detail: "can read any file on the system".into(),
            path: None,
            exploit_hint: Some("extract SAM/SYSTEM hives".into()),
        });
    }

    if stdout.contains("BUILTIN\\Remote Desktop Users") || stdout.contains("S-1-5-32-555") {
        findings.push(Finding {
            check: "tokens",
            severity: Severity::Info,
            title: "member of Remote Desktop Users".into(),
            detail: "RDP access available".into(),
            path: None,
            exploit_hint: None,
        });
    }

    if stdout.contains("NT SERVICE") {
        findings.push(Finding {
            check: "tokens",
            severity: Severity::Medium,
            title: "running as a service account".into(),
            detail: "service accounts often have SeImpersonate".into(),
            path: None,
            exploit_hint: Some("check SeImpersonatePrivilege for potato attacks".into()),
        });
    }
}
