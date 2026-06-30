mod app_state;
mod commands;
mod events;
mod models;
mod services;

use app_state::AppState;
use commands::{
    app::app_version,
    config_packs::{create_user_config_pack, list_config_packs},
    git::{
        git_add, git_branch_create, git_branch_list, git_branch_switch, git_commit, git_diff,
        git_discard, git_fetch, git_log, git_pull, git_push, git_reset, git_stage_all,
        git_status, git_unstage_all,
    },
    omp::{omp_config_list, omp_debug_context, omp_stats, omp_status, omp_stream_command, omp_usage},
    projects::{
        create_project_basebuild_config, detect_project, list_recent_projects, remember_recent_project,
        remove_recent_project, reveal_in_explorer,
    },
    requirements::list_requirements,
    terminal::{close_terminal, create_terminal, resize_terminal, write_terminal},
    updates::check_app_update,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            app_version,
            remember_recent_project,
            list_recent_projects,
            detect_project,
            create_project_basebuild_config,
            remove_recent_project,
            reveal_in_explorer,
            omp_status,
            omp_config_list,
            omp_stats,
            omp_usage,
            omp_debug_context,
            omp_stream_command,
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            git_status,
            git_diff,
            git_add,
            git_reset,
            git_discard,
            git_stage_all,
            git_unstage_all,
            git_pull,
            git_push,
            git_fetch,
            git_branch_list,
            git_branch_create,
            git_branch_switch,
            git_commit,
            git_log,
            list_config_packs,
            create_user_config_pack,
            check_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Basebuild");
}
