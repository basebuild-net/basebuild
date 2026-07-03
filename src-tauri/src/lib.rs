mod app_state;
mod commands;
mod events;
mod models;
mod services;

use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

static APP_HANDLE: LazyLock<Mutex<Option<AppHandle>>> = LazyLock::new(|| Mutex::new(None));

use app_state::AppState;
use commands::{
    agent::{agent_capabilities, agent_send, agent_start, agent_stop},
     app::app_version,
    auth::{
        auth_fetch_profile, auth_get_token, auth_poll_device_flow, auth_sign_out,
        auth_start_device_flow, auth_status,
    },
     analytics::{
        analytics_event_count, delete_analytics_events, export_analytics_json,
        get_analytics_consent, list_analytics_events, record_analytics_event,
        set_analytics_consent,
     },
    config_packs::{create_user_config_pack, list_config_packs},
     files::{list_files, read_file},
    git::{
        git_add, git_branch_create, git_branch_list, git_branch_switch, git_commit, git_diff,
        git_discard, git_fetch, git_log, git_pull, git_push, git_reset, git_stage_all, git_status,
        git_unstage_all,
    },
    ideas::{
        create_category, create_idea, delete_category, delete_idea, list_categories, list_ideas,
        update_idea_status,
    },
    omp::{
        omp_config_list, omp_debug_context, omp_stats, omp_status, omp_stream_command, omp_usage,
    },
    native_chat::{
        native_chat_get, native_chat_list, native_chat_messages, native_chat_send,
        native_chat_start, native_delete_provider_credential, native_generate_ideas,
        native_list_provider_credentials, native_provider_catalog, native_provider_login_cancel,
        native_provider_login_poll, native_provider_login_start, native_request_metrics,
        native_request_metrics_summary, native_request_tool_approval,
        native_save_provider_credential,
    },
    plans::{
        create_plan, delete_plan, get_plan, list_plans, set_plan_context, set_plan_status,
        update_plan,
    },
    projects::{
        create_project_basebuild_config, detect_project, list_recent_projects, pick_context_file,
        pick_context_folder, pick_project_directory, remember_recent_project, remove_recent_project,
        reveal_in_explorer, set_last_active_session,
    },
    requirements::list_requirements,
     schematic::{get_project_schematic, has_project_schematic, set_project_schematic},
    settings::{
        clear_audit_trail, delete_runtime_profile, get_permission_rules, get_runtime_defaults,
        list_audit_trail, list_runtime_profiles, reset_permission_rules, reset_runtime_defaults,
        set_permission_rules, set_runtime_defaults, upsert_runtime_profile,
        validate_runtime_profile,
    },
    sessions::{
        create_session, create_tab, delete_session, delete_tab, list_sessions, list_tabs,
        rename_session, update_tab_chat_session, update_tab_file_path, update_tab_terminal,
    },
    skills::read_skill,
     terminal::{close_terminal, create_terminal, list_terminals, resize_terminal, write_terminal},
    workspace::{get_workspace_restore_state, save_workspace_restore_state},
    sync::sync_raw_usage_native,
    updater::{
        check_for_updates, clear_skipped_update, get_skipped_update_version,
        install_update, install_update_with_progress, skip_update_version,
    },
};

pub struct CloseToTrayState {
    pub force_exit: Mutex<bool>,
}

impl Default for CloseToTrayState {
    fn default() -> Self {
        Self {
            force_exit: Mutex::new(false),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install panic hook to capture crash info and open a GitHub issue
    std::panic::set_hook(Box::new(|info| {
        let payload = info.payload();
        let msg = if let Some(s) = payload.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };
        let location = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_default();
        let backtrace = std::backtrace::Backtrace::force_capture();
        let report = format!(
            "## Rust Crash Report\n\n**Message:** {msg}\n\n**Location:** {location}\n\n**Backtrace:**\n```\n{backtrace}\n```"
        );
        let title = format!("Crash: {msg}");
        let url = format!(
            "https://github.com/basebuild-net/basebuild/issues/new?title={}&body={}",
            urlencoding::encode(&title),
            urlencoding::encode(&report)
        );
        eprintln!("{report}");

        // Emit to the frontend so the ErrorBoundary can display the crash
        if let Ok(handle) = APP_HANDLE.lock() {
            if let Some(app) = handle.as_ref() {
                let _ = app.emit("rust://panic", &report);
            }
        }


        let _ = open::that(&url);
    }));

    tauri::Builder::default()
        .manage(AppState::default())
        .manage(std::sync::Mutex::new(crate::services::agent_service::AgentManager::default()))
        .manage(CloseToTrayState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Store handle so the panic hook can emit to the frontend
            if let Ok(mut handle) = APP_HANDLE.lock() {
                *handle = Some(app.handle().clone());
            }
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .text("show", "Show Basebuild")
                .separator()
                .text("exit", "Exit")
                .build()?;

            let _tray_icon = tauri::tray::TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/icon.png"))
                .menu(&tray_menu)
                .tooltip("Basebuild")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        use tauri::Manager;
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "exit" => {
                        use tauri::Manager;
                        if let Some(state) = app.try_state::<CloseToTrayState>() {
                            if let Ok(mut guard) = state.force_exit.lock() {
                                *guard = true;
                            }
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                let should_exit = window
                    .app_handle()
                    .try_state::<CloseToTrayState>()
                    .and_then(|s| s.force_exit.lock().ok().map(|g| *g))
                    .unwrap_or(false);

                if !should_exit {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            remember_recent_project,
            list_recent_projects,
            detect_project,
            pick_project_directory,
            pick_context_file,
            pick_context_folder,
            list_files,
            read_file,
            create_project_basebuild_config,
            remove_recent_project,
            set_last_active_session,
            reveal_in_explorer,
            omp_status,
            omp_config_list,
            omp_stats,
            omp_usage,
            omp_debug_context,
            omp_stream_command,
            get_project_schematic,
            has_project_schematic,
            set_project_schematic,
            create_plan,
            list_plans,
            get_plan,
            update_plan,
            set_plan_status,
            set_plan_context,
            delete_plan,
            read_skill,
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            list_terminals,
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
            list_requirements,
            create_session,
            list_sessions,
            rename_session,
            delete_session,
            create_tab,
            list_tabs,
            delete_tab,
            update_tab_terminal,
            update_tab_file_path,
            update_tab_chat_session,
            create_category,
            list_categories,
            delete_category,
            create_idea,
            list_ideas,
            update_idea_status,
            delete_idea,
             agent_start,
             agent_send,
            agent_capabilities,
             agent_stop,
            native_provider_catalog,
            native_chat_start,
            native_chat_get,
            native_chat_list,
            native_chat_messages,
            native_chat_send,
            native_request_metrics,
            native_request_metrics_summary,
            native_request_tool_approval,
            native_save_provider_credential,
            native_list_provider_credentials,
            native_delete_provider_credential,
            native_generate_ideas,
            native_provider_login_start,
            native_provider_login_poll,
            native_provider_login_cancel,
            list_runtime_profiles,
            upsert_runtime_profile,
            delete_runtime_profile,
            validate_runtime_profile,
            get_runtime_defaults,
            set_runtime_defaults,
            reset_runtime_defaults,
            get_permission_rules,
            set_permission_rules,
            reset_permission_rules,
            list_audit_trail,
            clear_audit_trail,
            get_analytics_consent,
            set_analytics_consent,
            list_analytics_events,
            analytics_event_count,
            delete_analytics_events,
            export_analytics_json,
            record_analytics_event,
            auth_status,
            auth_start_device_flow,
            auth_poll_device_flow,
            auth_fetch_profile,
            auth_sign_out,
            auth_get_token,
            sync_raw_usage_native,
            get_workspace_restore_state,
            save_workspace_restore_state,
             check_for_updates,
             install_update,
            install_update_with_progress,
            skip_update_version,
            clear_skipped_update,
            get_skipped_update_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Basebuild");
}

#[cfg(test)]
mod tests {
    use crate::models::session::TabKind;

    #[test]
    fn tab_kind_serializes_as_plain_string() {
        let json = serde_json::to_string(&TabKind::Terminal).unwrap();
        assert_eq!(json, "\"terminal\"", "TabKind must serialize as a plain string to match the frontend TabKind type");

        let kind: TabKind = serde_json::from_str("\"chat\"").unwrap();
        assert_eq!(kind, TabKind::Chat, "TabKind must deserialize from a plain string");
    }
}
