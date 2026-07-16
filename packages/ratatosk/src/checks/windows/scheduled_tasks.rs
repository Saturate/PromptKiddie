use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct TaskCheck;

impl Check for TaskCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        let output = match Command::new("schtasks")
            .args(["/query", "/fo", "CSV", "/v", "/nh"])
            .output()
        {
            Ok(o) => o,
            Err(_) => return findings,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);

        for line in stdout.lines() {
            let fields: Vec<&str> = line.split(',').map(|f| f.trim_matches('"')).collect();

            if fields.len() < 9 {
                continue;
            }

            let task_name = fields[1];
            let task_to_run = fields[8];

            if task_name.starts_with("\\Microsoft\\") {
                continue;
            }
            if task_to_run == "Task To Run" {
                continue;
            }

            let run_as = fields
                .iter()
                .find(|f| {
                    f.contains("SYSTEM") || f.contains("Administrator") || f.contains("LOCAL")
                })
                .copied()
                .unwrap_or("");

            let runs_as_system = run_as.contains("SYSTEM") || run_as.contains("LOCALSERVICE");

            if !runs_as_system {
                continue;
            }

            let exe_path = task_to_run
                .trim_matches('"')
                .split(" /")
                .next()
                .unwrap_or(task_to_run)
                .split(" -")
                .next()
                .unwrap_or(task_to_run)
                .trim();

            if exe_path.starts_with("C:\\Windows\\System32")
                || exe_path.starts_with("%SystemRoot%")
                || exe_path.starts_with("COM handler")
            {
                continue;
            }

            if let Ok(icacls) = Command::new("icacls").arg(exe_path).output() {
                let perms = String::from_utf8_lossy(&icacls.stdout).to_lowercase();
                let user = std::env::var("USERNAME").unwrap_or_default().to_lowercase();
                let groups = ["everyone", "users", "authenticated users", &user];

                if (perms.contains("(f)") || perms.contains("(m)") || perms.contains("(w)"))
                    && groups.iter().any(|g| perms.contains(g))
                {
                    findings.push(Finding {
                        check: "scheduled_tasks",
                        severity: Severity::Critical,
                        title: "writable SYSTEM scheduled task binary".into(),
                        detail: format!("task: {task_name}"),
                        path: Some(exe_path.to_string()),
                        exploit_hint: Some(
                            "replace binary, wait for task execution as SYSTEM".into(),
                        ),
                    });
                }
            }
        }

        findings
    }
}
