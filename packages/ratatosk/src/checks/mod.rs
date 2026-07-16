#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "windows")]
pub mod windows;

use crate::output::Finding;

pub trait Check: Sync {
    fn run(&self) -> Vec<Finding>;
}

pub fn all() -> Vec<Box<dyn Check>> {
    #[cfg(target_os = "linux")]
    { linux::all() }

    #[cfg(target_os = "windows")]
    { windows::all() }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    { vec![] }
}
