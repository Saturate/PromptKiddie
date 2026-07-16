use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct WinProcessCheck;

impl Check for WinProcessCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_system_processes(&mut findings);
        check_av_processes(&mut findings);

        findings
    }
}

fn check_system_processes(findings: &mut Vec<Finding>) {
    let output = match Command::new("wmic")
        .args([
            "process",
            "get",
            "Name,ExecutablePath,ProcessId",
            "/format:csv",
        ])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let user = std::env::var("USERNAME").unwrap_or_default().to_lowercase();
    let groups = ["everyone", "users", "authenticated users", user.as_str()];

    for line in stdout.lines() {
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() < 4 {
            continue;
        }

        let exe_path = fields[1].trim();
        let name = fields[2].trim();

        if exe_path.is_empty() {
            continue;
        }
        if exe_path.to_lowercase().starts_with("c:\\windows\\system32") {
            continue;
        }

        if let Ok(icacls) = Command::new("icacls").arg(exe_path).output() {
            let perms = String::from_utf8_lossy(&icacls.stdout).to_lowercase();
            if (perms.contains("(f)") || perms.contains("(m)") || perms.contains("(w)"))
                && groups.iter().any(|g| perms.contains(g))
            {
                findings.push(Finding {
                    check: "processes",
                    severity: Severity::High,
                    title: format!("writable process binary: {name}"),
                    detail: "running process has a writable executable".into(),
                    path: Some(exe_path.to_string()),
                    exploit_hint: Some("replace binary, wait for process restart".into()),
                });
            }
        }
    }
}

fn check_av_processes(findings: &mut Vec<Finding>) {
    let output = match Command::new("tasklist").arg("/v").output() {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();

    let av_products = [
        ("msmpeng.exe", "Windows Defender"),
        ("mssense.exe", "Microsoft Defender for Endpoint"),
        ("savservice.exe", "Sophos"),
        ("bdagent.exe", "Bitdefender"),
        ("avp.exe", "Kaspersky"),
        ("mcshield.exe", "McAfee"),
        ("coreserviceshell.exe", "Trend Micro"),
        ("cb.exe", "Carbon Black"),
        ("cbcomms.exe", "Carbon Black"),
        ("csfalconservice.exe", "CrowdStrike"),
        ("csagent.exe", "CrowdStrike"),
        ("cylancesvc.exe", "Cylance"),
        ("sentinelagent.exe", "SentinelOne"),
        ("sfc-agent.exe", "Cisco Secure Endpoint"),
        ("xagt.exe", "FireEye"),
        ("elastic-agent.exe", "Elastic Agent"),
        ("elastic-endpoint.exe", "Elastic Endpoint"),
        ("ossec-agent.exe", "OSSEC/Wazuh"),
        ("wazuh-agent.exe", "Wazuh"),
        ("sysmon.exe", "Sysmon"),
        ("sysmon64.exe", "Sysmon 64-bit"),
    ];

    let mut detected = Vec::new();

    for (proc, product) in &av_products {
        if stdout.contains(proc) {
            detected.push(*product);
        }
    }

    if detected.is_empty() {
        findings.push(Finding {
            check: "processes",
            severity: Severity::Medium,
            title: "no known AV/EDR detected".into(),
            detail: "no recognized security product processes found".into(),
            path: None,
            exploit_hint: Some("lower chance of payload detection".into()),
        });
    } else {
        for product in &detected {
            findings.push(Finding {
                check: "processes",
                severity: Severity::Info,
                title: format!("security product: {product}"),
                detail: "active protection detected".into(),
                path: None,
                exploit_hint: None,
            });
        }
    }
}
