use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct DbusCheck;

impl Check for DbusCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_system_bus_services(&mut findings);
        check_polkit(&mut findings);

        findings
    }
}

fn check_system_bus_services(findings: &mut Vec<Finding>) {
    let output = match Command::new("busctl")
        .args(["list", "--no-pager", "--no-legend"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    let interesting = [
        "org.freedesktop.PackageKit",
        "org.freedesktop.PolicyKit1",
        "org.freedesktop.systemd1",
        "org.freedesktop.login1",
        "org.freedesktop.UDisks2",
        "org.freedesktop.NetworkManager",
        "org.freedesktop.Accounts",
    ];

    for service in &interesting {
        if stdout.contains(service) {
            findings.push(Finding {
                check: "dbus",
                severity: Severity::Info,
                title: format!("D-Bus service: {service}"),
                detail: "accessible on the system bus".into(),
                path: None,
                exploit_hint: None,
            });
        }
    }
}

fn check_polkit(findings: &mut Vec<Finding>) {
    let output = match Command::new("pkexec").arg("--version").output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let version = String::from_utf8_lossy(&output.stdout);
    let version_str = version.trim();

    if !version_str.is_empty() {
        findings.push(Finding {
            check: "dbus",
            severity: Severity::Info,
            title: format!("polkit: {version_str}"),
            detail: "check for CVE-2021-4034 (PwnKit) if version < 0.120".into(),
            path: None,
            exploit_hint: None,
        });
    }

    let rule_dirs = [
        "/etc/polkit-1/rules.d",
        "/usr/share/polkit-1/rules.d",
        "/etc/polkit-1/localauthority.conf.d",
    ];

    for dir in &rule_dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if let Ok(content) = std::fs::read_to_string(&path) {
                    let lower = content.to_lowercase();
                    if lower.contains("return polkit.result.yes") || lower.contains("adminrule") {
                        findings.push(Finding {
                            check: "dbus",
                            severity: Severity::Medium,
                            title: format!("polkit rule: {}", entry.file_name().to_string_lossy()),
                            detail: "may grant elevated privileges without authentication".into(),
                            path: Some(path.to_string_lossy().to_string()),
                            exploit_hint: Some(
                                "review rule to see what actions are auto-authorized".into(),
                            ),
                        });
                    }
                }
            }
        }
    }
}
