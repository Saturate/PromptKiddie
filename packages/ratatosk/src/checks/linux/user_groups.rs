use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;

pub struct UserGroupCheck;

impl Check for UserGroupCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_passwd_users(&mut findings);
        check_sudoers(&mut findings);
        check_other_ssh_keys(&mut findings);
        check_uid_collisions(&mut findings);

        findings
    }
}

fn check_passwd_users(findings: &mut Vec<Finding>) {
    let passwd = match fs::read_to_string("/etc/passwd") {
        Ok(c) => c,
        Err(_) => return,
    };

    for line in passwd.lines() {
        let fields: Vec<&str> = line.split(':').collect();
        if fields.len() < 7 { continue; }

        let user = fields[0];
        let uid: u32 = fields[2].parse().unwrap_or(u32::MAX);
        let shell = fields[6];

        if uid == 0 && user != "root" {
            findings.push(Finding {
                check: "user_groups",
                severity: Severity::Critical,
                title: format!("uid 0 account: {user}"),
                detail: format!("non-root user with uid 0, shell: {shell}"),
                path: Some("/etc/passwd".into()),
                exploit_hint: Some(format!("su {user} for root shell")),
            });
        }

        if fields[1].is_empty() {
            findings.push(Finding {
                check: "user_groups",
                severity: Severity::High,
                title: format!("no password set for: {user}"),
                detail: "empty password field in /etc/passwd".into(),
                path: Some("/etc/passwd".into()),
                exploit_hint: Some(format!("su {user} (no password needed)")),
            });
        }
    }

    if let Ok(shadow) = fs::read_to_string("/etc/shadow") {
        for line in shadow.lines() {
            let fields: Vec<&str> = line.split(':').collect();
            if fields.len() < 2 { continue; }
            let user = fields[0];
            let hash = fields[1];
            if hash.is_empty() {
                findings.push(Finding {
                    check: "user_groups",
                    severity: Severity::Critical,
                    title: format!("empty password hash: {user}"),
                    detail: "user has no password set in /etc/shadow".into(),
                    path: Some("/etc/shadow".into()),
                    exploit_hint: Some(format!("su {user} with empty password")),
                });
            }
        }
    }
}

fn check_sudoers(findings: &mut Vec<Finding>) {
    for path in &["/etc/sudoers"] {
        if let Ok(content) = fs::read_to_string(path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') { continue; }

                if trimmed.contains("NOPASSWD") {
                    findings.push(Finding {
                        check: "user_groups",
                        severity: Severity::High,
                        title: "NOPASSWD rule in sudoers".into(),
                        detail: trimmed.to_string(),
                        path: Some(path.to_string()),
                        exploit_hint: None,
                    });
                }

                if trimmed.contains("!authenticate") {
                    findings.push(Finding {
                        check: "user_groups",
                        severity: Severity::High,
                        title: "!authenticate in sudoers".into(),
                        detail: trimmed.to_string(),
                        path: Some(path.to_string()),
                        exploit_hint: None,
                    });
                }
            }
        }
    }

    if let Ok(entries) = fs::read_dir("/etc/sudoers.d") {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if let Ok(content) = fs::read_to_string(&path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') { continue; }
                    if trimmed.contains("NOPASSWD") {
                        findings.push(Finding {
                            check: "user_groups",
                            severity: Severity::High,
                            title: "NOPASSWD rule in sudoers.d".into(),
                            detail: trimmed.to_string(),
                            path: Some(path.to_string_lossy().to_string()),
                            exploit_hint: None,
                        });
                    }
                }
            }
        }
    }
}

fn check_other_ssh_keys(findings: &mut Vec<Finding>) {
    let my_uid = nix::unistd::getuid().as_raw();

    let home_dirs: Vec<String> = fs::read_to_string("/etc/passwd")
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let fields: Vec<&str> = l.split(':').collect();
            if fields.len() < 6 { return None; }
            let uid: u32 = fields[2].parse().ok()?;
            if uid == my_uid { return None; }
            Some(fields[5].to_string())
        })
        .collect();

    for home in &home_dirs {
        let auth_keys = format!("{home}/.ssh/authorized_keys");
        if let Ok(content) = fs::read_to_string(&auth_keys) {
            let key_count = content.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')).count();
            if key_count > 0 {
                findings.push(Finding {
                    check: "user_groups",
                    severity: Severity::Medium,
                    title: format!("readable authorized_keys ({key_count} keys)"),
                    detail: "can see which SSH keys are authorized for this user".into(),
                    path: Some(auth_keys),
                    exploit_hint: None,
                });
            }
        }

        for key_file in ["id_rsa", "id_ed25519", "id_ecdsa"] {
            let key_path = format!("{home}/.ssh/{key_file}");
            if fs::read_to_string(&key_path).is_ok() {
                findings.push(Finding {
                    check: "user_groups",
                    severity: Severity::Critical,
                    title: format!("readable private key: {key_file}"),
                    detail: format!("belongs to user with home {home}"),
                    path: Some(key_path),
                    exploit_hint: Some("ssh -i <key> user@target".into()),
                });
            }
        }
    }
}

fn check_uid_collisions(findings: &mut Vec<Finding>) {
    let mut uid_map: std::collections::HashMap<u32, Vec<String>> = std::collections::HashMap::new();
    if let Ok(passwd) = fs::read_to_string("/etc/passwd") {
        for line in passwd.lines() {
            let fields: Vec<&str> = line.split(':').collect();
            if fields.len() < 7 { continue; }
            let uid: u32 = match fields[2].parse() {
                Ok(u) => u,
                Err(_) => continue,
            };
            uid_map.entry(uid).or_default().push(fields[0].to_string());
        }
    }

    for (uid, users) in &uid_map {
        if users.len() > 1 {
            findings.push(Finding {
                check: "user_groups",
                severity: Severity::High,
                title: format!("UID collision: uid {uid} shared by {} users", users.len()),
                detail: users.join(", "),
                path: Some("/etc/passwd".into()),
                exploit_hint: Some("multiple accounts with same uid share all file permissions".into()),
            });
        }
    }
}
