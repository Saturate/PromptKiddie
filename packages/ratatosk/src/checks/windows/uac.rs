use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct UacCheck;

const BYPASS_BINARIES: &[(&str, &str)] = &[
    ("fodhelper.exe", "registry hijack via ms-settings"),
    ("eventvwr.exe", "registry hijack via mscfile"),
    ("computerdefaults.exe", "registry hijack via ms-settings"),
    ("sdclt.exe", "registry hijack via exefile or App Paths"),
    ("slui.exe", "file handler hijack"),
    ("wsreset.exe", "AppX package bypass"),
    ("cmstp.exe", "INF file sideloading"),
];

impl Check for UacCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_uac_settings(&mut findings);
        check_auto_elevate_binaries(&mut findings);
        check_is_admin_but_filtered(&mut findings);

        findings
    }
}

fn check_uac_settings(findings: &mut Vec<Finding>) {
    let output = match Command::new("reg")
        .args(["query", r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    let enable_lua = extract_reg_dword(&stdout, "EnableLUA");
    let consent_admin = extract_reg_dword(&stdout, "ConsentPromptBehaviorAdmin");
    let prompt_secure = extract_reg_dword(&stdout, "PromptOnSecureDesktop");
    let filter_admin = extract_reg_dword(&stdout, "FilterAdministratorToken");

    if enable_lua == Some(0) {
        findings.push(Finding {
            check: "uac",
            severity: Severity::Critical,
            title: "UAC fully disabled (EnableLUA=0)".into(),
            detail: "all admin users run with full token, no elevation prompt".into(),
            path: None,
            exploit_hint: Some("every admin process is already elevated".into()),
        });
    }

    if consent_admin == Some(0) {
        findings.push(Finding {
            check: "uac",
            severity: Severity::High,
            title: "UAC auto-elevates for admins (ConsentPromptBehaviorAdmin=0)".into(),
            detail: "admin elevation happens silently".into(),
            path: None,
            exploit_hint: Some("any auto-elevate binary can be abused without a prompt".into()),
        });
    }

    if prompt_secure == Some(0) && consent_admin.is_some_and(|v| v > 0) {
        findings.push(Finding {
            check: "uac",
            severity: Severity::Medium,
            title: "UAC prompt not on secure desktop".into(),
            detail: "PromptOnSecureDesktop=0, prompt can be spoofed or automated".into(),
            path: None,
            exploit_hint: None,
        });
    }

    if filter_admin == Some(0) {
        findings.push(Finding {
            check: "uac",
            severity: Severity::Medium,
            title: "built-in Administrator not filtered".into(),
            detail: "FilterAdministratorToken=0, RID-500 runs with full token".into(),
            path: None,
            exploit_hint: Some("if you can auth as Administrator, no UAC bypass needed".into()),
        });
    }
}

fn check_auto_elevate_binaries(findings: &mut Vec<Finding>) {
    for (binary, method) in BYPASS_BINARIES {
        let full_path = format!(r"C:\Windows\System32\{binary}");
        if std::path::Path::new(&full_path).exists() {
            findings.push(Finding {
                check: "uac",
                severity: Severity::Info,
                title: format!("UAC bypass candidate: {binary}"),
                detail: method.to_string(),
                path: Some(full_path),
                exploit_hint: Some(format!("auto-elevates: {method}")),
            });
        }
    }
}

fn check_is_admin_but_filtered(findings: &mut Vec<Finding>) {
    let groups = match Command::new("whoami").arg("/groups").output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return,
    };

    let priv_output = match Command::new("whoami").arg("/priv").output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return,
    };

    let is_admin_group = groups.contains("S-1-5-32-544");
    let has_limited_privs = !priv_output.contains("SeDebugPrivilege") && !priv_output.contains("SeTakeOwnershipPrivilege");

    if is_admin_group && has_limited_privs {
        findings.push(Finding {
            check: "uac",
            severity: Severity::High,
            title: "admin user with filtered token (UAC bypass target)".into(),
            detail: "member of Administrators but running with restricted privileges".into(),
            path: None,
            exploit_hint: Some("UAC bypass will give full admin token".into()),
        });
    }
}

fn extract_reg_dword(output: &str, name: &str) -> Option<u32> {
    output.lines()
        .find(|l| l.contains(name))
        .and_then(|l| {
            l.split_whitespace()
                .last()
                .and_then(|v| u32::from_str_radix(v.trim_start_matches("0x"), 16).ok())
        })
}
