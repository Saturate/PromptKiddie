mod capabilities;
mod credentials;
mod cron;
mod dbus;
mod docker;
mod env_vars;
mod kernel;
mod mounts;
mod network;
mod perms;
mod processes;
mod snap_lxd;
mod ssh_config;
mod sudo;
mod suid;
mod systemd_services;
mod user_groups;

use super::Check;

pub fn all() -> Vec<Box<dyn Check>> {
    vec![
        Box::new(suid::SuidCheck),
        Box::new(sudo::SudoCheck),
        Box::new(capabilities::CapCheck),
        Box::new(cron::CronCheck),
        Box::new(kernel::KernelCheck),
        Box::new(docker::DockerCheck),
        Box::new(perms::PermsCheck),
        Box::new(network::NetworkCheck),
        Box::new(credentials::CredCheck),
        Box::new(processes::ProcessCheck),
        Box::new(user_groups::UserGroupCheck),
        Box::new(systemd_services::SystemdCheck),
        Box::new(mounts::MountCheck),
        Box::new(ssh_config::SshConfigCheck),
        Box::new(env_vars::EnvCheck),
        Box::new(dbus::DbusCheck),
        Box::new(snap_lxd::SnapLxdCheck),
    ]
}
