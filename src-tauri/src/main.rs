// Never allocate a console window — autostart (`--background`) and Explorer
// launches must be silent. In debug builds, attach to the parent process's
// console (if any) so `cargo run` / `tauri dev` still stream logs and panic
// output to the invoking terminal; launched without one (e.g. autostart),
// the attach fails harmlessly and the app stays windowless.
#![windows_subsystem = "windows"]

fn main() {
    #[cfg(all(windows, debug_assertions))]
    // SAFETY: AttachConsole has no preconditions; on failure (no parent
    // console) it returns 0 and the process simply keeps no console.
    unsafe {
        use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
    basebuild_app_lib::run();
}
