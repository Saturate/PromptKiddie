use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;

pub struct MountCheck;

impl Check for MountCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_mount_options(&mut findings);
        check_fstab_creds(&mut findings);
        check_dev_shm(&mut findings);

        findings
    }
}

fn check_mount_options(findings: &mut Vec<Finding>) {
    let mounts = match fs::read_to_string("/proc/mounts") {
        Ok(c) => c,
        Err(_) => return,
    };

    for line in mounts.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }

        let mountpoint = fields[1];
        let fstype = fields[2];
        let options = fields[3];

        if mountpoint == "/tmp" && !options.contains("noexec") {
            findings.push(Finding {
                check: "mounts",
                severity: Severity::Medium,
                title: "/tmp mounted without noexec".into(),
                detail: format!("options: {options}"),
                path: Some("/tmp".into()),
                exploit_hint: Some("can execute binaries from /tmp".into()),
            });
        }

        if mountpoint == "/dev/shm" && !options.contains("noexec") {
            findings.push(Finding {
                check: "mounts",
                severity: Severity::Low,
                title: "/dev/shm mounted without noexec".into(),
                detail: format!("options: {options}"),
                path: Some("/dev/shm".into()),
                exploit_hint: Some("can execute binaries from shared memory".into()),
            });
        }

        let unusual = ["nfs", "cifs", "smbfs", "fuse", "davfs"];
        if unusual.iter().any(|u| fstype.contains(u)) {
            findings.push(Finding {
                check: "mounts",
                severity: Severity::Low,
                title: format!("network mount: {mountpoint} ({fstype})"),
                detail: format!("device: {}, options: {options}", fields[0]),
                path: Some(mountpoint.to_string()),
                exploit_hint: None,
            });
        }
    }
}

fn check_fstab_creds(findings: &mut Vec<Finding>) {
    let fstab = match fs::read_to_string("/etc/fstab") {
        Ok(c) => c,
        Err(_) => return,
    };

    for line in fstab.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let lower = trimmed.to_lowercase();
        if lower.contains("password=")
            || lower.contains("credentials=")
            || lower.contains("username=")
        {
            if lower.contains("credentials=")
                && let Some(cred_start) = lower.find("credentials=")
            {
                let rest = &trimmed[cred_start + 12..];
                let cred_file = rest.split(',').next().unwrap_or("").trim();
                if fs::read_to_string(cred_file).is_ok() {
                    findings.push(Finding {
                        check: "mounts",
                        severity: Severity::High,
                        title: "readable mount credentials file".into(),
                        detail: "referenced from fstab".into(),
                        path: Some(cred_file.to_string()),
                        exploit_hint: Some("may contain plaintext mount credentials".into()),
                    });
                }
            }

            findings.push(Finding {
                check: "mounts",
                severity: Severity::High,
                title: "credentials in /etc/fstab".into(),
                detail: truncate(trimmed, 120).to_string(),
                path: Some("/etc/fstab".into()),
                exploit_hint: None,
            });
        }
    }
}

fn check_dev_shm(findings: &mut Vec<Finding>) {
    if let Ok(entries) = fs::read_dir("/dev/shm") {
        let files: Vec<String> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();

        if !files.is_empty() {
            findings.push(Finding {
                check: "mounts",
                severity: Severity::Info,
                title: format!("{} files in /dev/shm", files.len()),
                detail: files.into_iter().take(10).collect::<Vec<_>>().join(", "),
                path: Some("/dev/shm".into()),
                exploit_hint: None,
            });
        }
    }
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max { s } else { &s[..s.floor_char_boundary(max)] }
}
