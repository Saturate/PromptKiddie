use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct EventCheck;

impl Check for EventCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_powershell_scriptblock_logs(&mut findings);
        check_powershell_transcripts(&mut findings);
        check_recent_logons(&mut findings);

        findings
    }
}

fn check_powershell_scriptblock_logs(findings: &mut Vec<Finding>) {
    let output = match Command::new("reg")
        .args(["query", r"HKLM\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("EnableScriptBlockLogging") && stdout.contains("0x1") {
        findings.push(Finding {
            check: "events",
            severity: Severity::Info,
            title: "PowerShell script block logging enabled".into(),
            detail: "may contain credentials or sensitive commands in event logs".into(),
            path: None,
            exploit_hint: None,
        });

        if let Ok(ps_output) = Command::new("powershell")
            .args(["-NoProfile", "-Command",
                "try { Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-PowerShell/Operational';Id=4104} -MaxEvents 50 -ErrorAction Stop | ForEach-Object { $_.Message } | Select-String -Pattern 'password|credential|secret|token|key' -SimpleMatch | Select-Object -First 5 | ForEach-Object { $_.Line.Substring(0, [Math]::Min(200, $_.Line.Length)) } } catch {}"])
            .output()
        {
            let ps_stdout = String::from_utf8_lossy(&ps_output.stdout);
            for line in ps_stdout.lines().take(5) {
                let trimmed = line.trim();
                if trimmed.is_empty() { continue; }
                findings.push(Finding {
                    check: "events",
                    severity: Severity::High,
                    title: "credential reference in PS script block log".into(),
                    detail: truncate(trimmed, 150).to_string(),
                    path: None,
                    exploit_hint: None,
                });
            }
        }
    }
}

fn check_powershell_transcripts(findings: &mut Vec<Finding>) {
    let output = match Command::new("reg")
        .args(["query", r"HKLM\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("EnableTranscripting") && stdout.contains("0x1") {
        let output_dir = stdout.lines()
            .find(|l| l.contains("OutputDirectory"))
            .and_then(|l| l.split_whitespace().last())
            .unwrap_or("");

        findings.push(Finding {
            check: "events",
            severity: Severity::Medium,
            title: "PowerShell transcription enabled".into(),
            detail: format!("output dir: {output_dir}"),
            path: if output_dir.is_empty() { None } else { Some(output_dir.to_string()) },
            exploit_hint: Some("transcripts may contain credentials typed in PS sessions".into()),
        });

        if !output_dir.is_empty() {
            if let Ok(entries) = std::fs::read_dir(output_dir) {
                let count = entries.filter_map(|e| e.ok()).count();
                if count > 0 {
                    findings.push(Finding {
                        check: "events",
                        severity: Severity::High,
                        title: format!("{count} PowerShell transcript files accessible"),
                        detail: "may contain plaintext credentials from past sessions".into(),
                        path: Some(output_dir.to_string()),
                        exploit_hint: Some("search transcript files for password/credential strings".into()),
                    });
                }
            }
        }
    }
}

fn check_recent_logons(findings: &mut Vec<Finding>) {
    if let Ok(output) = Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "try { Get-WinEvent -FilterHashtable @{LogName='Security';Id=4648} -MaxEvents 10 -ErrorAction Stop | ForEach-Object { $xml = [xml]$_.ToXml(); $target = $xml.Event.EventData.Data | Where-Object {$_.Name -eq 'TargetUserName'} | Select-Object -ExpandProperty '#text'; $server = $xml.Event.EventData.Data | Where-Object {$_.Name -eq 'TargetServerName'} | Select-Object -ExpandProperty '#text'; \"$target@$server\" } | Sort-Object -Unique } catch {}"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed == "@" { continue; }
            findings.push(Finding {
                check: "events",
                severity: Severity::Low,
                title: format!("explicit credential logon: {trimmed}"),
                detail: "event ID 4648, credential used to access another resource".into(),
                path: None,
                exploit_hint: None,
            });
        }
    }
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max { s } else { &s[..max] }
}
