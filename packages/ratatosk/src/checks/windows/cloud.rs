use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct CloudCheck;

impl Check for CloudCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        check_aws_metadata(&mut findings);
        check_azure_metadata(&mut findings);
        check_gcp_metadata(&mut findings);
        check_cloud_creds_files(&mut findings);

        findings
    }
}

fn check_aws_metadata(findings: &mut Vec<Finding>) {
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "try { $r = Invoke-WebRequest -Uri 'http://169.254.169.254/latest/meta-data/' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; $r.StatusCode } catch { 'error' }"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim() == "200" {
        findings.push(Finding {
            check: "cloud",
            severity: Severity::High,
            title: "AWS IMDS accessible (IMDSv1)".into(),
            detail: "instance metadata service reachable without token".into(),
            path: None,
            exploit_hint: Some("curl http://169.254.169.254/latest/meta-data/iam/security-credentials/".into()),
        });
    }
}

fn check_azure_metadata(findings: &mut Vec<Finding>) {
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "try { $r = Invoke-WebRequest -Uri 'http://169.254.169.254/metadata/instance?api-version=2021-02-01' -Headers @{Metadata='true'} -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; $r.StatusCode } catch { 'error' }"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim() == "200" {
        findings.push(Finding {
            check: "cloud",
            severity: Severity::High,
            title: "Azure IMDS accessible".into(),
            detail: "instance metadata service reachable".into(),
            path: None,
            exploit_hint: Some("fetch managed identity token: /metadata/identity/oauth2/token?resource=https://management.azure.com/".into()),
        });
    }
}

fn check_gcp_metadata(findings: &mut Vec<Finding>) {
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "try { $r = Invoke-WebRequest -Uri 'http://metadata.google.internal/computeMetadata/v1/' -Headers @{'Metadata-Flavor'='Google'} -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; $r.StatusCode } catch { 'error' }"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim() == "200" {
        findings.push(Finding {
            check: "cloud",
            severity: Severity::High,
            title: "GCP metadata service accessible".into(),
            detail: "instance metadata reachable".into(),
            path: None,
            exploit_hint: Some("fetch service account token: /computeMetadata/v1/instance/service-accounts/default/token".into()),
        });
    }
}

fn check_cloud_creds_files(findings: &mut Vec<Finding>) {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    if user_profile.is_empty() { return; }

    let cloud_files = [
        (format!("{user_profile}\\.aws\\credentials"), "AWS credentials", Severity::Critical),
        (format!("{user_profile}\\.aws\\config"), "AWS config", Severity::Medium),
        (format!("{user_profile}\\.azure\\accessTokens.json"), "Azure access tokens", Severity::Critical),
        (format!("{user_profile}\\.azure\\azureProfile.json"), "Azure profile", Severity::Medium),
        (format!("{user_profile}\\.config\\gcloud\\credentials.db"), "GCP credentials DB", Severity::Critical),
        (format!("{user_profile}\\.config\\gcloud\\application_default_credentials.json"), "GCP default credentials", Severity::Critical),
        (format!("{user_profile}\\.kube\\config"), "Kubernetes config", Severity::High),
    ];

    for (path, desc, severity) in &cloud_files {
        if std::path::Path::new(path).exists() {
            findings.push(Finding {
                check: "cloud",
                severity: *severity,
                title: format!("{desc} found"),
                detail: "readable by current user".into(),
                path: Some(path.clone()),
                exploit_hint: None,
            });
        }
    }
}
