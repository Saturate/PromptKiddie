use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;
use walkdir::WalkDir;

pub struct CredCheck;

const INTERESTING_FILES: &[&str] = &[
    ".bash_history",
    ".zsh_history",
    ".mysql_history",
    ".psql_history",
    ".python_history",
    ".viminfo",
    ".gitconfig",
    ".git-credentials",
    ".ssh/id_rsa",
    ".ssh/id_ed25519",
    ".ssh/id_ecdsa",
    ".env",
    "wp-config.php",
    "config.php",
    "database.yml",
    ".pgpass",
    ".my.cnf",
    ".netrc",
    ".aws/credentials",
];

const PASSWORD_PATTERNS: &[&str] = &[
    "password",
    "passwd",
    "pwd=",
    "secret",
    "api_key",
    "apikey",
    "token",
    "db_pass",
    "mysql_pwd",
    "credentials",
];

impl Check for CredCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_home_dirs(&mut findings);
        check_config_files(&mut findings);
        check_backup_files(&mut findings);

        findings
    }
}

fn check_home_dirs(findings: &mut Vec<Finding>) {
    let home_dirs = ["/home", "/root"];

    for base in &home_dirs {
        let entries = match fs::read_dir(base) {
            Ok(e) => e.collect::<Vec<_>>(),
            Err(_) => {
                if *base == "/root" {
                    check_dir_for_creds(base, findings);
                }
                continue;
            }
        };

        if *base == "/root" {
            check_dir_for_creds(base, findings);
        } else {
            for entry in entries.into_iter().filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    check_dir_for_creds(&path.to_string_lossy(), findings);
                }
            }
        }
    }
}

fn check_dir_for_creds(dir: &str, findings: &mut Vec<Finding>) {
    for filename in INTERESTING_FILES {
        let path = format!("{dir}/{filename}");
        if let Ok(meta) = fs::metadata(&path) {
            if !meta.is_file() {
                continue;
            }

            let readable = fs::read_to_string(&path).is_ok();
            if !readable {
                continue;
            }

            let severity = if filename.contains("id_rsa")
                || filename.contains("id_ed25519")
                || filename.contains("id_ecdsa")
            {
                Severity::Critical
            } else if filename.contains("credentials")
                || filename.contains("password")
                || *filename == ".git-credentials"
                || *filename == ".pgpass"
                || *filename == ".my.cnf"
                || *filename == ".netrc"
            {
                Severity::High
            } else if filename.contains("history") {
                Severity::Medium
            } else {
                Severity::Low
            };

            findings.push(Finding {
                check: "credentials",
                severity,
                title: format!("readable: {filename}"),
                detail: format!("size: {} bytes", meta.len()),
                path: Some(path),
                exploit_hint: None,
            });
        }
    }
}

fn check_config_files(findings: &mut Vec<Finding>) {
    let config_dirs = ["/etc", "/opt", "/var/www", "/srv"];

    for dir in &config_dirs {
        for entry in WalkDir::new(dir)
            .max_depth(4)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let name = entry.file_name().to_string_lossy();

            let is_config = name.ends_with(".conf")
                || name.ends_with(".cfg")
                || name.ends_with(".ini")
                || name.ends_with(".yml")
                || name.ends_with(".yaml")
                || name.ends_with(".xml")
                || name.ends_with(".env")
                || name.ends_with(".properties");

            if !is_config {
                continue;
            }

            if let Ok(content) = fs::read_to_string(path) {
                for (line_num, line) in content.lines().enumerate() {
                    let lower = line.to_lowercase();
                    for pattern in PASSWORD_PATTERNS {
                        if lower.contains(pattern) && (line.contains('=') || line.contains(':')) {
                            let trimmed = line.trim();
                            if trimmed.starts_with('#')
                                || trimmed.starts_with("//")
                                || trimmed.starts_with("<!--")
                            {
                                continue;
                            }

                            findings.push(Finding {
                                check: "credentials",
                                severity: Severity::High,
                                title: "potential credential in config".into(),
                                detail: format!(
                                    "line {}: {}",
                                    line_num + 1,
                                    truncate(trimmed, 120)
                                ),
                                path: Some(path.to_string_lossy().to_string()),
                                exploit_hint: None,
                            });
                            break;
                        }
                    }
                }
            }
        }
    }
}

fn check_backup_files(findings: &mut Vec<Finding>) {
    let backup_patterns = ["*.bak", "*.old", "*.orig", "*.save", "*.swp", "*~"];
    let search_dirs = ["/etc", "/opt", "/var/www", "/tmp", "/var/tmp"];

    for dir in &search_dirs {
        for entry in WalkDir::new(dir)
            .max_depth(3)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }

            let name = entry.file_name().to_string_lossy();
            let is_backup = backup_patterns.iter().any(|p| {
                let suffix = p.trim_start_matches('*');
                name.ends_with(suffix)
            });

            if is_backup {
                findings.push(Finding {
                    check: "credentials",
                    severity: Severity::Low,
                    title: format!("backup file: {name}"),
                    detail: "may contain old credentials or config".into(),
                    path: Some(entry.path().to_string_lossy().to_string()),
                    exploit_hint: None,
                });
            }
        }
    }
}

fn truncate(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len {
        s
    } else {
        &s[..s.floor_char_boundary(max_len)]
    }
}
