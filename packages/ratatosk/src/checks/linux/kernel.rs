use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;

pub struct KernelCheck;

struct KernelExploit {
    name: &'static str,
    cve: &'static str,
    min_version: (u32, u32, u32),
    max_version: (u32, u32, u32),
    severity: Severity,
}

const KNOWN_EXPLOITS: &[KernelExploit] = &[
    KernelExploit {
        name: "DirtyPipe",
        cve: "CVE-2022-0847",
        min_version: (5, 8, 0),
        max_version: (5, 16, 10),
        severity: Severity::Critical,
    },
    KernelExploit {
        name: "DirtyCow",
        cve: "CVE-2016-5195",
        min_version: (2, 6, 22),
        max_version: (4, 8, 2),
        severity: Severity::Critical,
    },
    KernelExploit {
        name: "PwnKit",
        cve: "CVE-2021-4034",
        min_version: (0, 0, 0),
        max_version: (99, 99, 99),
        severity: Severity::High,
    },
    KernelExploit {
        name: "Baron Samedit (sudo)",
        cve: "CVE-2021-3156",
        min_version: (0, 0, 0),
        max_version: (99, 99, 99),
        severity: Severity::High,
    },
    KernelExploit {
        name: "OverlayFS",
        cve: "CVE-2023-0386",
        min_version: (5, 11, 0),
        max_version: (6, 2, 0),
        severity: Severity::High,
    },
    KernelExploit {
        name: "Looney Tunables (glibc)",
        cve: "CVE-2023-4911",
        min_version: (0, 0, 0),
        max_version: (99, 99, 99),
        severity: Severity::High,
    },
    KernelExploit {
        name: "GameOver(lay)",
        cve: "CVE-2023-2640",
        min_version: (5, 15, 0),
        max_version: (6, 2, 0),
        severity: Severity::High,
    },
    KernelExploit {
        name: "DirtyPagedirectory",
        cve: "CVE-2024-1086",
        min_version: (5, 14, 0),
        max_version: (6, 7, 1),
        severity: Severity::Critical,
    },
];

impl Check for KernelCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        let version_str = fs::read_to_string("/proc/version").unwrap_or_default();
        let kernel_version = parse_kernel_version(&version_str);

        if let Some((major, minor, patch)) = kernel_version {
            findings.push(Finding {
                check: "kernel",
                severity: Severity::Info,
                title: format!("kernel version: {major}.{minor}.{patch}"),
                detail: version_str.trim().to_string(),
                path: None,
                exploit_hint: None,
            });

            for exploit in KNOWN_EXPLOITS {
                if exploit.cve == "CVE-2021-4034" {
                    if std::path::Path::new("/usr/bin/pkexec").exists() {
                        findings.push(Finding {
                            check: "kernel",
                            severity: exploit.severity,
                            title: format!("{}: {}", exploit.name, exploit.cve),
                            detail: "pkexec binary exists, may be vulnerable".into(),
                            path: Some("/usr/bin/pkexec".into()),
                            exploit_hint: Some("run PwnKit exploit".into()),
                        });
                    }
                    continue;
                }

                if exploit.cve == "CVE-2021-3156" {
                    if let Ok(output) = std::process::Command::new("sudo").arg("--version").output() {
                        let ver = String::from_utf8_lossy(&output.stdout);
                        findings.push(Finding {
                            check: "kernel",
                            severity: Severity::Info,
                            title: format!("{}: {} (check sudo version)", exploit.name, exploit.cve),
                            detail: ver.lines().next().unwrap_or("").to_string(),
                            path: None,
                            exploit_hint: Some("vulnerable if sudo < 1.9.5p2".into()),
                        });
                    }
                    continue;
                }

                if exploit.cve == "CVE-2023-4911" {
                    findings.push(Finding {
                        check: "kernel",
                        severity: Severity::Info,
                        title: format!("{}: {} (check glibc version)", exploit.name, exploit.cve),
                        detail: "run ldd --version to check".into(),
                        path: None,
                        exploit_hint: Some("vulnerable glibc 2.34-2.39, check GLIBC_TUNABLES".into()),
                    });
                    continue;
                }

                let v = (major, minor, patch);
                if v >= exploit.min_version && v <= exploit.max_version {
                    findings.push(Finding {
                        check: "kernel",
                        severity: exploit.severity,
                        title: format!("{}: {}", exploit.name, exploit.cve),
                        detail: format!("kernel {major}.{minor}.{patch} in range {}.{}.{}-{}.{}.{}",
                            exploit.min_version.0, exploit.min_version.1, exploit.min_version.2,
                            exploit.max_version.0, exploit.max_version.1, exploit.max_version.2),
                        path: None,
                        exploit_hint: Some(format!("search for {} exploit binary", exploit.name)),
                    });
                }
            }
        }

        findings
    }
}

fn parse_kernel_version(version_str: &str) -> Option<(u32, u32, u32)> {
    let version_part = version_str
        .split_whitespace()
        .nth(2)?;

    let nums: Vec<&str> = version_part.split(|c: char| !c.is_ascii_digit()).collect();
    if nums.len() < 3 { return None; }

    Some((
        nums[0].parse().ok()?,
        nums[1].parse().ok()?,
        nums[2].parse().ok()?,
    ))
}
