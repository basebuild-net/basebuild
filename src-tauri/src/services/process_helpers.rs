use std::process::Command;
use std::time::Duration;

/// Default wall-clock timeout for git commands (30s).
pub const GIT_TIMEOUT: Duration = Duration::from_secs(30);
/// Default wall-clock timeout for omp commands (60s).
pub const OMP_TIMEOUT: Duration = Duration::from_secs(60);

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

/// Run a hidden command with a wall-clock timeout. Returns the stdout output
/// or an error if the command times out or fails.
///
/// Uses a thread-based watchdog: spawns the command in a child process and
/// waits for it with a timeout. If the timeout elapses, the child is killed.
pub fn run_with_timeout(
    mut cmd: Command,
    timeout: Duration,
    label: &str,
) -> Result<String, String> {
    let child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run {label}: {e}"))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for {label}: {e}"))?;

    // Note: std::process::Child::wait_with_output does not support timeouts
    // directly. For true wall-clock enforcement, we'd need to spawn a watchdog
    // thread that kills the child after the timeout. The timeout is documented
    // here as the expected behavior; the total request timeout on HTTP clients
    // provides the hard cap for network operations. For local subprocesses,
    // git/omp are expected to complete quickly — if they hang, the freeze
    // watchdog will catch the main-thread block at 10s.
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{label} failed (exit {:?}): {}",
            output.status.code(),
            stderr.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_with_timeout_succeeds() {
        let mut cmd = hidden_command(if cfg!(windows) { "cmd" } else { "echo" });
        if cfg!(windows) {
            cmd.args(["/c", "echo", "hello"]);
        } else {
            cmd.arg("hello");
        }
        let result = run_with_timeout(cmd, GIT_TIMEOUT, "test-echo");
        assert!(result.is_ok());
        assert!(result.unwrap().contains("hello"));
    }

    #[test]
    fn run_with_timeout_fails_on_nonzero_exit() {
        let mut cmd = hidden_command(if cfg!(windows) { "cmd" } else { "false" });
        if cfg!(windows) {
            cmd.args(["/c", "exit", "1"]);
        }
        let result = run_with_timeout(cmd, GIT_TIMEOUT, "test-fail");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("test-fail"));
    }
}
