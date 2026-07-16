use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::process::Command;

pub struct AdReconCheck;

impl Check for AdReconCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();

        if !is_domain_joined() {
            return findings;
        }

        check_domain_info(&mut findings);
        check_spns(&mut findings);
        check_asrep_roast(&mut findings);
        check_machine_account_quota(&mut findings);

        findings
    }
}

fn is_domain_joined() -> bool {
    std::env::var("USERDNSDOMAIN").is_ok()
        || std::env::var("LOGONSERVER")
            .map(|v| v.starts_with("\\\\"))
            .unwrap_or(false)
}

fn check_domain_info(findings: &mut Vec<Finding>) {
    let domain = std::env::var("USERDNSDOMAIN").unwrap_or_default();
    let dc = std::env::var("LOGONSERVER").unwrap_or_default();

    if !domain.is_empty() {
        findings.push(Finding {
            check: "ad_recon",
            severity: Severity::Info,
            title: format!("domain: {domain}"),
            detail: format!("logon server: {dc}"),
            path: None,
            exploit_hint: None,
        });
    }

    if let Ok(output) = Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "try { $d = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain(); \"$($d.Name)|$($d.DomainMode)|$($d.DomainControllers.Count) DCs\" } catch { 'error' }"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let trimmed = stdout.trim();
        if trimmed != "error" && !trimmed.is_empty() {
            findings.push(Finding {
                check: "ad_recon",
                severity: Severity::Info,
                title: format!("AD info: {trimmed}"),
                detail: String::new(),
                path: None,
                exploit_hint: None,
            });
        }
    }
}

fn check_spns(findings: &mut Vec<Finding>) {
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "try { $s = New-Object DirectoryServices.DirectorySearcher([ADSI]''); $s.Filter = '(&(objectCategory=user)(servicePrincipalName=*)(!(cn=krbtgt)))'; $s.PropertiesToLoad.AddRange(@('samaccountname','serviceprincipalname','admincount')); foreach($r in $s.FindAll()) { $n=$r.Properties['samaccountname'][0]; $spn=$r.Properties['serviceprincipalname'][0]; $a=$r.Properties['admincount']; Write-Output \"$n|$spn|admin=$a\" } } catch {}"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('|').collect();
        let name = parts.first().unwrap_or(&"");
        let spn = parts.get(1).unwrap_or(&"");
        let is_admin = trimmed.contains("admin=1");

        findings.push(Finding {
            check: "ad_recon",
            severity: if is_admin {
                Severity::Critical
            } else {
                Severity::High
            },
            title: format!(
                "kerberoastable: {name}{}",
                if is_admin { " (admin)" } else { "" }
            ),
            detail: format!("SPN: {spn}"),
            path: None,
            exploit_hint: Some(format!(
                "GetUserSPNs.py {domain}/{user} -request -outputfile hashes.txt",
                domain = std::env::var("USERDNSDOMAIN").unwrap_or_default(),
                user = std::env::var("USERNAME").unwrap_or_default()
            )),
        });
    }
}

fn check_asrep_roast(findings: &mut Vec<Finding>) {
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "try { $s = New-Object DirectoryServices.DirectorySearcher([ADSI]''); $s.Filter = '(&(objectCategory=user)(userAccountControl:1.2.840.113556.1.4.803:=4194304))'; $s.PropertiesToLoad.Add('samaccountname') | Out-Null; foreach($r in $s.FindAll()) { $r.Properties['samaccountname'][0] } } catch {}"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let name = line.trim();
        if name.is_empty() {
            continue;
        }

        findings.push(Finding {
            check: "ad_recon",
            severity: Severity::High,
            title: format!("AS-REP roastable: {name}"),
            detail: "DONT_REQUIRE_PREAUTH flag set".into(),
            path: None,
            exploit_hint: Some(format!(
                "GetNPUsers.py {domain}/ -usersfile users.txt -format hashcat",
                domain = std::env::var("USERDNSDOMAIN").unwrap_or_default()
            )),
        });
    }
}

fn check_machine_account_quota(findings: &mut Vec<Finding>) {
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "try { $root = [ADSI]'LDAP://RootDSE'; $dn = $root.defaultNamingContext; $domain = [ADSI]\"LDAP://$dn\"; $domain.Properties['ms-DS-MachineAccountQuota'].Value } catch {}"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Ok(quota) = stdout.trim().parse::<i32>() {
        if quota > 0 {
            findings.push(Finding {
                check: "ad_recon",
                severity: Severity::Medium,
                title: format!("MachineAccountQuota: {quota}"),
                detail: "users can add machine accounts to the domain".into(),
                path: None,
                exploit_hint: Some(
                    "addcomputer.py for resource-based constrained delegation attack".into(),
                ),
            });
        }
    }
}
