use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::fs;

pub struct NetworkCheck;

impl Check for NetworkCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_listening_services(&mut findings);
        check_arp_neighbors(&mut findings);

        findings
    }
}

fn check_listening_services(findings: &mut Vec<Finding>) {
    let tcp = fs::read_to_string("/proc/net/tcp").unwrap_or_default();
    let tcp6 = fs::read_to_string("/proc/net/tcp6").unwrap_or_default();

    for line in tcp.lines().chain(tcp6.lines()).skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 { continue; }

        if fields[3] != "0A" { continue; }

        let local = fields[1];
        let parts: Vec<&str> = local.split(':').collect();
        if parts.len() != 2 { continue; }

        let port = u16::from_str_radix(parts[1], 16).unwrap_or(0);
        let addr_hex = parts[0];

        let is_localhost = addr_hex == "0100007F" || addr_hex == "00000000000000000000000001000000";

        if is_localhost && port > 0 {
            findings.push(Finding {
                check: "network",
                severity: Severity::Low,
                title: format!("localhost-only service on port {port}"),
                detail: "bound to 127.0.0.1, not externally reachable".into(),
                path: None,
                exploit_hint: Some("may expose internal APIs, databases, or admin panels".into()),
            });
        }
    }
}

fn check_arp_neighbors(findings: &mut Vec<Finding>) {
    if let Ok(arp) = fs::read_to_string("/proc/net/arp") {
        let count = arp.lines().skip(1).filter(|l| !l.trim().is_empty()).count();
        if count > 0 {
            findings.push(Finding {
                check: "network",
                severity: Severity::Info,
                title: format!("{count} ARP neighbors visible"),
                detail: "other hosts on the local network".into(),
                path: None,
                exploit_hint: None,
            });
        }
    }
}
