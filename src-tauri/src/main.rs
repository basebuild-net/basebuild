// Hide the console window in release builds. In debug builds the console
// remains visible for panic output and development logging.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    basebuild_app_lib::run();
}
