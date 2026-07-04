//! Shared test utilities for serializing DB-touching tests.
//!
//! Tests across multiple modules set `BASEBUILD_HOME` to a temp dir, which
//! races when run in parallel. This module provides a single global mutex
//! that all DB-touching tests should acquire before setting `BASEBUILD_HOME`.

#[cfg(test)]
pub mod test {
    use std::sync::LazyLock;
    use parking_lot::Mutex;

    /// Global lock for serializing all tests that set BASEBUILD_HOME.
    pub static DB_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    pub fn lock_db(dir: &tempfile::TempDir) -> parking_lot::MutexGuard<'static, ()> {
        let guard = DB_TEST_LOCK.lock();
        std::env::set_var("BASEBUILD_HOME", dir.path());
        guard
    }
}
