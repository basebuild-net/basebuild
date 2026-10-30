//! Shared test utilities for serializing DB-touching tests.
//!
//! All storage-touching tests MUST run against an isolated `BASEBUILD_HOME`
//! (temp directory) so the developer's real `~/.basebuild/state.db` is never
//! read or written. The `StorageService::connect()` function enforces this in
//! `cfg(test)` builds by erroring when `BASEBUILD_HOME` is unset.
//!
//! Tests across multiple modules set `BASEBUILD_HOME` to a temp dir, which
//! races when run in parallel. This module provides a single global mutex
//! that all DB-touching tests acquire before setting `BASEBUILD_HOME`. The
//! `isolated_home()` constructor is the recommended entry point: it provisions
//! a fresh temp dir, acquires the lock, sets the env var, and returns both.

#[cfg(test)]
pub mod test {
    use parking_lot::Mutex;
    use std::sync::LazyLock;

    /// Global lock for serializing all tests that set BASEBUILD_HOME.
    pub static DB_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    /// Acquire the global DB test lock and point `BASEBUILD_HOME` at the given
    /// temp dir. The returned guard releases the lock on drop; keep it bound
    /// for the test's duration.
    pub fn lock_db(dir: &tempfile::TempDir) -> parking_lot::MutexGuard<'static, ()> {
        let guard = DB_TEST_LOCK.lock();
        std::env::set_var("BASEBUILD_HOME", dir.path());
        guard
    }

    /// Provision an isolated `BASEBUILD_HOME` for a single test: fresh temp
    /// dir + global lock + env var set. Returns `(tempdir, guard)`. The temp
    /// dir is cleaned up when the `TempDir` drops; the guard releases the lock.
    ///
    /// Usage:
    /// ```ignore
    /// let (_dir, _guard) = isolated_home();
    /// let conn = StorageService::connect().unwrap();
    /// ```
    pub fn isolated_home() -> (tempfile::TempDir, parking_lot::MutexGuard<'static, ()>) {
        let dir = tempfile::TempDir::new().expect("temp dir for isolated home");
        let guard = lock_db(&dir);
        (dir, guard)
    }

    /// Minimal UTC ISO-8601 formatter (`YYYY-MM-DDTHH:MM:SSZ`) for fixtures
    /// that must stay inside a "recent" window relative to the wall clock.
    /// The crate has no chrono dependency; this is Howard Hinnant's
    /// civil-from-days, the inverse of the harness reader's parser.
    pub fn iso_utc(epoch_secs: i64) -> String {
        let days = epoch_secs.div_euclid(86_400);
        let rem = epoch_secs.rem_euclid(86_400);
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = era * 400 + yoe + i64::from(month <= 2);
        format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
            rem / 3600,
            (rem % 3600) / 60,
            rem % 60
        )
    }
}
