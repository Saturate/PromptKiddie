mod ad_recon;
mod cloud;
mod credentials;
mod dll_hijack;
mod events;
mod network;
mod patches;
mod processes;
mod registry;
mod scheduled_tasks;
mod services;
mod tokens;
mod uac;

use super::Check;

pub fn all() -> Vec<Box<dyn Check>> {
    vec![
        Box::new(services::ServiceCheck),
        Box::new(registry::RegistryCheck),
        Box::new(tokens::TokenCheck),
        Box::new(scheduled_tasks::TaskCheck),
        Box::new(credentials::WinCredCheck),
        Box::new(dll_hijack::DllHijackCheck),
        Box::new(network::WinNetworkCheck),
        Box::new(patches::PatchCheck),
        Box::new(uac::UacCheck),
        Box::new(ad_recon::AdReconCheck),
        Box::new(processes::WinProcessCheck),
        Box::new(cloud::CloudCheck),
        Box::new(events::EventCheck),
    ]
}
