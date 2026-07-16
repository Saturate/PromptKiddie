use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct SnapLxdCheck;

impl Check for SnapLxdCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_snap_packages(&mut findings);
        check_lxd_containers(&mut findings);

        findings
    }
}

fn check_snap_packages(findings: &mut Vec<Finding>) {
    let output = match Command::new("snap").args(["list"]).output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 { continue; }

        let name = fields[0];
        let confinement = fields.get(4).unwrap_or(&"");

        if *confinement == "devmode" || *confinement == "classic" {
            findings.push(Finding {
                check: "snap_lxd",
                severity: Severity::Medium,
                title: format!("snap {name}: {confinement} confinement"),
                detail: "runs without sandbox restrictions".into(),
                path: None,
                exploit_hint: Some("snap run --shell <name> to get an unconfined shell".into()),
            });
        }
    }
}

fn check_lxd_containers(findings: &mut Vec<Finding>) {
    let output = match Command::new("lxc").args(["list", "--format", "csv"]).output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        if line.trim().is_empty() { continue; }
        let fields: Vec<&str> = line.split(',').collect();
        let name = fields.first().unwrap_or(&"");

        findings.push(Finding {
            check: "snap_lxd",
            severity: Severity::Info,
            title: format!("LXD container: {name}"),
            detail: line.to_string(),
            path: None,
            exploit_hint: None,
        });
    }

    if let Ok(output) = Command::new("lxc").args(["storage", "list", "--format", "csv"]).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.trim().is_empty() {
            if let Ok(id_out) = Command::new("id").output() {
                let groups = String::from_utf8_lossy(&id_out.stdout);
                if groups.contains("lxd") {
                    findings.push(Finding {
                        check: "snap_lxd",
                        severity: Severity::Critical,
                        title: "LXD not initialized, user in lxd group".into(),
                        detail: "can init LXD and mount host filesystem".into(),
                        path: None,
                        exploit_hint: Some("lxd init (all defaults) -> lxc launch ubuntu:latest test -c security.privileged=true -> lxc exec test -- /bin/bash".into()),
                    });
                }
            }
        }
    }
}
