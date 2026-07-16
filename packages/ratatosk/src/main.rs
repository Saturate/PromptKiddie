mod checks;
mod output;

use clap::Parser;
use output::{Finding, Severity, ScanResult};
use rayon::prelude::*;
use std::time::Instant;

#[derive(Parser)]
#[command(name = "ratatosk", about = "Fast parallel privilege escalation scanner")]
struct Cli {
    /// Output format: json (default) or text
    #[arg(short, long, default_value = "json")]
    format: String,

    /// Only show findings at or above this severity
    #[arg(short, long, default_value = "low")]
    min_severity: Severity,
}

fn main() {
    let cli = Cli::parse();
    let start = Instant::now();

    let all_checks = checks::all();

    let findings: Vec<Finding> = all_checks
        .par_iter()
        .flat_map(|check| {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check.run()));
            match result {
                Ok(findings) => findings,
                Err(_) => vec![],
            }
        })
        .filter(|f| f.severity >= cli.min_severity)
        .collect();

    let result = ScanResult {
        hostname: hostname(),
        user: whoami(),
        identity: platform_identity(),
        duration_ms: start.elapsed().as_millis() as u64,
        finding_count: findings.len(),
        findings,
    };

    match cli.format.as_str() {
        "text" => print_text(&result),
        _ => println!("{}", serde_json::to_string(&result).unwrap()),
    }
}

fn hostname() -> String {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/hostname")
            .unwrap_or_default()
            .trim()
            .to_string()
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".into())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    { "unknown".into() }
}

fn whoami() -> String {
    #[cfg(not(target_os = "windows"))]
    { std::env::var("USER").unwrap_or_else(|_| "unknown".into()) }

    #[cfg(target_os = "windows")]
    { std::env::var("USERNAME").unwrap_or_else(|_| "unknown".into()) }
}

fn platform_identity() -> String {
    #[cfg(target_os = "linux")]
    { format!("uid={}", nix::unistd::getuid().as_raw()) }

    #[cfg(target_os = "windows")]
    {
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_default();
        format!("{domain}\\{user}")
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    { "unknown".into() }
}

fn print_text(result: &ScanResult) {
    println!("ratatosk scan: {} as {} ({})", result.hostname, result.user, result.identity);
    println!("found {} issues in {}ms\n", result.finding_count, result.duration_ms);

    for f in &result.findings {
        let sev = match f.severity {
            Severity::Critical => "\x1b[91mCRIT\x1b[0m",
            Severity::High => "\x1b[31mHIGH\x1b[0m",
            Severity::Medium => "\x1b[33mMED \x1b[0m",
            Severity::Low => "\x1b[36mLOW \x1b[0m",
            Severity::Info => "\x1b[90mINFO\x1b[0m",
        };
        println!("[{}] [{}] {}", sev, f.check, f.title);
        println!("       {}", f.detail);
        if let Some(ref path) = f.path {
            println!("       path: {}", path);
        }
        println!();
    }
}
