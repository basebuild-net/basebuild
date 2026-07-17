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
}
