use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;
use std::os::unix::fs::MetadataExt;

pub struct PermsCheck;

const SENSITIVE_FILES: &[(&str, Severity)] = &[
    ("/etc/passwd", Severity::Info),
    ("/etc/shadow", Severity::Critical),
    ("/etc/sudoers", Severity::Critical),
    ("/root/.ssh/id_rsa", Severity::Critical),
    ("/root/.ssh/authorized_keys", Severity::High),
    ("/root/.bash_history", Severity::Medium),
];

const WRITABLE_CHECK: &[(&str, Severity, &str)] = &[
    ("/etc/passwd", Severity::Critical, "add a root-equivalent user: echo 'root2::0:0::/root:/bin/bash' >> /etc/passwd"),
    ("/etc/shadow", Severity::Critical, "overwrite root password hash"),
    ("/etc/sudoers", Severity::Critical, "add NOPASSWD ALL rule"),
    ("/etc/crontab", Severity::High, "inject cron job as root"),
    ("/root/.ssh/authorized_keys", Severity::High, "inject SSH public key"),
];

impl Check for PermsCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();
        let my_uid = nix::unistd::getuid().as_raw();

        for (path, base_severity) in SENSITIVE_FILES {
            if fs::metadata(path).is_ok() && fs::read_to_string(path).is_ok() {
                findings.push(Finding {
                    check: "perms",
                    severity: *base_severity,
                    title: format!("{path} is readable"),
                    detail: "current user can read this file".into(),
                    path: Some(path.to_string()),
                    exploit_hint: None,
                });
            }
        }

        for (path, severity, hint) in WRITABLE_CHECK {
            if let Ok(meta) = fs::metadata(path) {
                let mode = meta.mode();
                let owner = meta.uid();
                let writable = mode & 0o002 != 0 || (owner == my_uid && mode & 0o200 != 0);

                if writable {
                    findings.push(Finding {
                        check: "perms",
                        severity: *severity,
                        title: format!("{path} is writable"),
                        detail: format!("mode: {mode:o}, owner uid: {owner}"),
                        path: Some(path.to_string()),
                        exploit_hint: Some(hint.to_string()),
                    });
                }
            }
        }

        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(':') {
                if let Ok(meta) = fs::metadata(dir) {
                    let mode = meta.mode();
                    let owner = meta.uid();
                    if mode & 0o002 != 0 || (owner == my_uid && owner != 0) {
                        findings.push(Finding {
                            check: "perms",
                            severity: Severity::High,
                            title: format!("writable PATH directory: {dir}"),
                            detail: format!("mode: {mode:o}, owner uid: {owner}"),
                            path: Some(dir.to_string()),
                            exploit_hint: Some("place a trojan binary to hijack a root cron/service".into()),
                        });
                    }
                }
            }
        }

        if let Ok(exports) = fs::read_to_string("/etc/exports") {
            for line in exports.lines() {
                if line.contains("no_root_squash") {
                    findings.push(Finding {
                        check: "perms",
                        severity: Severity::High,
                        title: "NFS no_root_squash".into(),
                        detail: line.trim().to_string(),
                        path: Some("/etc/exports".into()),
                        exploit_hint: Some("mount the share remotely, create SUID binary as root".into()),
                    });
                }
            }
        }

        findings
    }
}
