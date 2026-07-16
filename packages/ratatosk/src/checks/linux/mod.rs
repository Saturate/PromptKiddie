mod suid;
mod sudo;
mod capabilities;
mod cron;
mod kernel;
mod docker;
mod perms;
mod network;
mod credentials;
mod processes;
mod user_groups;
mod systemd_services;
mod mounts;
mod ssh_config;
mod env_vars;
mod dbus;
mod snap_lxd;

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
