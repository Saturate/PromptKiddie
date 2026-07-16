use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;
use std::path::Path;

pub struct DockerCheck;

impl Check for DockerCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        if Path::new("/var/run/docker.sock").exists()
            && fs::metadata("/var/run/docker.sock")
                .map(|m| {
                    use std::os::unix::fs::MetadataExt;
                    let mode = m.mode();
                    mode & 0o006 != 0
                })
                .unwrap_or(false)
        {
            findings.push(Finding {
                check: "docker",
                severity: Severity::Critical,
                title: "docker socket is world-accessible".into(),
                detail: "/var/run/docker.sock readable/writable".into(),
                path: Some("/var/run/docker.sock".into()),
                exploit_hint: Some("docker run -v /:/mnt --rm -it alpine chroot /mnt sh".into()),
            });
        }

        if let Ok(groups_output) = std::process::Command::new("id").output() {
            let groups = String::from_utf8_lossy(&groups_output.stdout);
            if groups.contains("docker") {
                findings.push(Finding {
                    check: "docker",
                    severity: Severity::Critical,
                    title: "current user in docker group".into(),
                    detail: "docker group membership allows root-equivalent access".into(),
                    path: None,
                    exploit_hint: Some(
                        "docker run -v /:/mnt --rm -it alpine chroot /mnt sh".into(),
                    ),
                });
            }
            if groups.contains("lxd") || groups.contains("lxc") {
                findings.push(Finding {
                    check: "docker",
                    severity: Severity::Critical,
                    title: "current user in lxd/lxc group".into(),
                    detail: "lxd group membership allows container escape to root".into(),
                    path: None,
                    exploit_hint: Some("lxd init + mount host filesystem".into()),
                });
            }
        }

        if Path::new("/.dockerenv").exists() {
            findings.push(Finding {
                check: "docker",
                severity: Severity::Info,
                title: "running inside a Docker container".into(),
                detail: "/.dockerenv exists".into(),
                path: None,
                exploit_hint: None,
            });
        }

        if let Ok(cgroup) = fs::read_to_string("/proc/1/cgroup")
            && (cgroup.contains("docker") || cgroup.contains("lxc") || cgroup.contains("kubepods"))
        {
            findings.push(Finding {
                check: "docker",
                severity: Severity::Info,
                title: "containerized environment detected".into(),
                detail: "container runtime visible in /proc/1/cgroup".into(),
                path: None,
                exploit_hint: None,
            });
        }

        if let Ok(status) = fs::read_to_string("/proc/1/status") {
            for line in status.lines() {
                if line.starts_with("CapEff:") {
                    let cap_hex = line.split(':').nth(1).unwrap_or("").trim();
                    if cap_hex == "000001ffffffffff" || cap_hex == "0000003fffffffff" {
                        findings.push(Finding {
                            check: "docker",
                            severity: Severity::Critical,
                            title: "privileged container detected".into(),
                            detail: format!("CapEff: {cap_hex} (all capabilities)"),
                            path: None,
                            exploit_hint: Some("mount host disk: mount /dev/sda1 /mnt".into()),
                        });
                    }
                }
            }
        }

        findings
    }
}
