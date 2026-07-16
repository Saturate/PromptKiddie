use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::path::Path;
use std::process::Command;
use walkdir::WalkDir;

pub struct WinCredCheck;

impl Check for WinCredCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_saved_creds(&mut findings);
        check_sam_backup(&mut findings);
        check_unattend_files(&mut findings);
        check_dpapi_keys(&mut findings);
        check_wifi_passwords(&mut findings);
        check_interesting_files(&mut findings);

        findings
    }
}

fn check_saved_creds(findings: &mut Vec<Finding>) {
    let output = match Command::new("cmdkey").arg("/list").output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("Target:") {
        for line in stdout.lines() {
            if line.contains("Target:") {
                let target = line.trim();
                findings.push(Finding {
                    check: "credentials",
                    severity: Severity::High,
                    title: "saved credential".into(),
                    detail: target.to_string(),
                    path: None,
                    exploit_hint: Some("runas /savecred /user:<user> cmd.exe".into()),
                });
            }
        }
    }
}

fn check_sam_backup(findings: &mut Vec<Finding>) {
    let sam_paths = [
        r"C:\Windows\Repair\SAM",
        r"C:\Windows\System32\config\RegBack\SAM",
        r"C:\Windows\System32\config\RegBack\SYSTEM",
        r"C:\Windows\Repair\SYSTEM",
    ];

    for path in &sam_paths {
        if Path::new(path).exists() && std::fs::metadata(path).is_ok() {
            findings.push(Finding {
                check: "credentials",
                severity: Severity::Critical,
                title: "SAM/SYSTEM backup accessible".into(),
                detail: "extract hashes with secretsdump or mimikatz".into(),
                path: Some(path.to_string()),
                exploit_hint: Some("copy SAM + SYSTEM, run: secretsdump.py -sam SAM -system SYSTEM LOCAL".into()),
            });
        }
    }
}

fn check_unattend_files(findings: &mut Vec<Finding>) {
    let unattend_paths = [
        r"C:\unattend.xml",
        r"C:\Windows\Panther\unattend.xml",
        r"C:\Windows\Panther\Unattend\unattend.xml",
        r"C:\Windows\System32\sysprep\unattend.xml",
        r"C:\Windows\System32\sysprep\Panther\unattend.xml",
        r"C:\Windows\Panther\unattend\Unattend.xml",
    ];

    for path in &unattend_paths {
        if Path::new(path).exists() {
            let contains_password = std::fs::read_to_string(path)
                .map(|c| c.to_lowercase().contains("password"))
                .unwrap_or(false);

            findings.push(Finding {
                check: "credentials",
                severity: if contains_password { Severity::Critical } else { Severity::Medium },
                title: "unattend.xml found".into(),
                detail: if contains_password {
                    "contains password element (may be base64 encoded)".into()
                } else {
                    "no password elements found".into()
                },
                path: Some(path.to_string()),
                exploit_hint: if contains_password {
                    Some("decode base64 password from <Password> element".into())
                } else {
                    None
                },
            });
        }
    }
}

fn check_dpapi_keys(findings: &mut Vec<Finding>) {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    if appdata.is_empty() { return; }

    let cred_dir = format!(r"{}\Microsoft\Credentials", appdata);
    if let Ok(entries) = std::fs::read_dir(&cred_dir) {
        let count = entries.filter_map(|e| e.ok()).count();
        if count > 0 {
            findings.push(Finding {
                check: "credentials",
                severity: Severity::Medium,
                title: format!("{count} DPAPI credential blobs"),
                detail: "decrypt with user's master key or mimikatz".into(),
                path: Some(cred_dir),
                exploit_hint: Some("mimikatz: dpapi::cred /in:<file>".into()),
            });
        }
    }
}

fn check_wifi_passwords(findings: &mut Vec<Finding>) {
    let output = match Command::new("netsh")
        .args(["wlan", "show", "profiles"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let profiles: Vec<&str> = stdout.lines()
        .filter(|l| l.contains("All User Profile"))
        .filter_map(|l| l.split(':').nth(1))
        .map(|s| s.trim())
        .collect();

    for profile in profiles {
        let key_output = match Command::new("netsh")
            .args(["wlan", "show", "profile", profile, "key=clear"])
            .output()
        {
            Ok(o) => o,
            Err(_) => continue,
        };

        let key_stdout = String::from_utf8_lossy(&key_output.stdout);
        if let Some(key_line) = key_stdout.lines().find(|l| l.contains("Key Content")) {
            findings.push(Finding {
                check: "credentials",
                severity: Severity::Medium,
                title: format!("WiFi password: {profile}"),
                detail: key_line.trim().to_string(),
                path: None,
                exploit_hint: None,
            });
        }
    }
}

fn check_interesting_files(findings: &mut Vec<Finding>) {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    if user_profile.is_empty() { return; }

    let interesting = [
        (".git-credentials", Severity::High),
        (".aws\\credentials", Severity::High),
        (".azure\\accessTokens.json", Severity::High),
    ];

    for (file, severity) in &interesting {
        let path = format!("{user_profile}\\{file}");
        if Path::new(&path).exists() {
            findings.push(Finding {
                check: "credentials",
                severity: *severity,
                title: format!("interesting file: {file}"),
                detail: "readable by current user".into(),
                path: Some(path),
                exploit_hint: None,
            });
        }
    }

    // PowerShell history
    let ps_history = format!(r"{}\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt", user_profile);
    if Path::new(&ps_history).exists() {
        if let Ok(content) = std::fs::read_to_string(&ps_history) {
            let has_creds = content.lines().any(|l| {
                let lower = l.to_lowercase();
                lower.contains("password") || lower.contains("securestring") || lower.contains("credential") || lower.contains("-pass")
            });
            if has_creds {
                findings.push(Finding {
                    check: "credentials",
                    severity: Severity::High,
                    title: "PowerShell history contains credential references".into(),
                    detail: "password/credential keywords found in command history".into(),
                    path: Some(ps_history),
                    exploit_hint: None,
                });
            }
        }
    }

    // Web root configs
    let web_roots = [r"C:\inetpub\wwwroot", r"C:\xampp\htdocs"];
    for root in &web_roots {
        if !Path::new(root).exists() { continue; }
        for entry in WalkDir::new(root).max_depth(4).into_iter().filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy();
            if name == "web.config" || name == "appsettings.json" || name == ".env" {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    let lower = content.to_lowercase();
                    if lower.contains("password") || lower.contains("connectionstring") {
                        findings.push(Finding {
                            check: "credentials",
                            severity: Severity::High,
                            title: format!("web config with credentials: {name}"),
                            detail: "password or connection string found".into(),
                            path: Some(entry.path().to_string_lossy().to_string()),
                            exploit_hint: None,
                        });
                    }
                }
            }
        }
    }
}
