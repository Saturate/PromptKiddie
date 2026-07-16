use crate::checks::Check;
use crate::output::{Finding, Severity};
use std::os::unix::fs::MetadataExt;
use walkdir::WalkDir;

pub struct SuidCheck;

const GTFOBINS_SUID: &[&str] = &[
    "bash",
    "sh",
    "dash",
    "zsh",
    "csh",
    "ksh",
    "python",
    "python2",
    "python3",
    "python3.8",
    "python3.9",
    "python3.10",
    "python3.11",
    "python3.12",
    "perl",
    "ruby",
    "node",
    "php",
    "vim",
    "vi",
    "nano",
    "ed",
    "less",
    "more",
    "find",
    "nmap",
    "awk",
    "gawk",
    "mawk",
    "env",
    "strace",
    "ltrace",
    "gdb",
    "cp",
    "mv",
    "dd",
    "tar",
    "zip",
    "unzip",
    "wget",
    "curl",
    "nc",
    "ncat",
    "socat",
    "doas",
    "pkexec",
    "start-stop-daemon",
    "tee",
    "xargs",
    "time",
    "timeout",
    "docker",
    "aa-exec",
    "ab",
    "agetty",
    "ar",
    "arj",
    "base32",
    "base64",
    "busybox",
    "byebug",
    "capsh",
    "chmod",
    "chown",
    "chroot",
    "crontab",
    "csvtool",
    "cut",
    "date",
    "diff",
    "dmsetup",
    "emacs",
    "expect",
    "file",
    "flock",
    "fmt",
    "fold",
    "gimp",
    "grep",
    "head",
    "hexdump",
    "highlight",
    "iconv",
    "install",
    "ionice",
    "ip",
    "jjs",
    "join",
    "jq",
    "jrunscript",
    "ksu",
    "ld.so",
    "logsave",
    "look",
    "lua",
    "make",
    "msfconsole",
    "nice",
    "nl",
    "nohup",
    "nsenter",
    "openssl",
    "paste",
    "pdb",
    "perlbug",
    "pg",
    "pico",
    "rsync",
    "run-parts",
    "rview",
    "rvim",
    "screen",
    "script",
    "sed",
    "setarch",
    "shuf",
    "sort",
    "split",
    "ssh-keygen",
    "ssh-keyscan",
    "strings",
    "su",
    "sysctl",
    "systemctl",
    "tail",
    "taskset",
    "tclsh",
    "telnet",
    "tftp",
    "troff",
    "ul",
    "unexpand",
    "uniq",
    "unshare",
    "valgrind",
    "watch",
    "xdotool",
    "xxd",
];

impl Check for SuidCheck {
    fn run(&self) -> Vec<Finding> {
        let mut findings = Vec::new();
        let search_dirs = ["/usr", "/bin", "/sbin", "/opt", "/tmp", "/var", "/home"];

        for dir in &search_dirs {
            for entry in WalkDir::new(dir)
                .max_depth(5)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                if !meta.is_file() {
                    continue;
                }

                let mode = meta.mode();
                let is_suid = mode & 0o4000 != 0;
                let is_sgid = mode & 0o2000 != 0;

                if !is_suid && !is_sgid {
                    continue;
                }

                let path = entry.path().to_string_lossy().to_string();
                let filename = entry.file_name().to_string_lossy().to_string();

                let is_gtfobins = GTFOBINS_SUID.iter().any(|&bin| filename == bin);
                let owner_uid = meta.uid();

                let (severity, hint) = if is_suid && owner_uid == 0 && is_gtfobins {
                    (
                        Severity::Critical,
                        Some(format!("GTFOBins SUID: {filename} owned by root")),
                    )
                } else if is_suid && owner_uid == 0 {
                    (Severity::Medium, None)
                } else if is_suid {
                    (Severity::Low, None)
                } else {
                    (Severity::Info, None)
                };

                let flag = if is_suid && is_sgid {
                    "SUID+SGID"
                } else if is_suid {
                    "SUID"
                } else {
                    "SGID"
                };

                findings.push(Finding {
                    check: "suid",
                    severity,
                    title: format!("{flag} binary: {filename} (owner uid {owner_uid})"),
                    detail: format!("mode: {mode:o}"),
                    path: Some(path),
                    exploit_hint: hint,
                });
            }
        }

        findings
    }
}
