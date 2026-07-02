use std::process::Command;

/// Create a `Command` that suppresses visible console windows on Windows.
///
/// On Windows, spawning a console-subsystem child process (e.g. `omp`, `git`,
/// `node`) from a windowed application can allocate a visible console window
/// for the child. `CREATE_NO_WINDOW` (0x08000000) prevents this, keeping
/// helper processes hidden/internal.
///
/// On non-Windows platforms this is a no-op and returns a plain `Command`.
#[cfg(windows)]
pub fn hidden_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
pub fn hidden_command(program: &str) -> Command {
    Command::new(program)
}
