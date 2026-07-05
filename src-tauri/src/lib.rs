mod app_state;
mod commands;
mod events;
pub mod models;
pub mod services;
#[cfg(test)]
pub mod test_util;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

static APP_HANDLE: LazyLock<Mutex<Option<AppHandle>>> = LazyLock::new(|| Mutex::new(None));

use commands::{
    agent::{agent_capabilities, agent_send, agent_start, agent_stop},
    app::{app_version, open_url},
    connectors::{
        connector_approve_claim, connector_delete, connector_deny_claim, connector_get,
        connector_list, connector_list_claims, connector_list_grants, connector_record_grant,
        connector_register, connector_revoke_grants, connector_set_enabled,
    },
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
    mcp::{
        mcp_call_tool, mcp_disconnect, mcp_get_prompt, mcp_list_prompts, mcp_list_servers,
        mcp_list_tools, mcp_oauth_cancel, mcp_oauth_clear, mcp_oauth_poll, mcp_oauth_start,
        mcp_reload, mcp_shutdown_all,
    },
    git::{
        git_add, git_branch_create, git_branch_list, git_branch_switch, git_commit, git_diff,
        git_discard, git_fetch, git_log, git_pull, git_push, git_reset, git_stage_all, git_status,
        git_unstage_all,
    },
    ideas::{
        create_category, create_idea, delete_category, delete_idea, ensure_default_categories,
        list_categories, list_ideas, promote_ideas, reject_idea, update_idea_status,
    },
    omp::{
        omp_config_list, omp_debug_context, omp_stats, omp_status, omp_stream_command, omp_usage,
    },
    omp_telemetry::{
        omp_telemetry_refresh, omp_telemetry_snapshot, omp_telemetry_start, omp_telemetry_stop,
    },
    native_chat::{
        native_chat_get, native_chat_list, native_chat_messages, native_chat_send,
        native_chat_start, native_chat_cancel, native_chat_resolve_approval,
        native_chat_tool_events, native_chat_model_default,
        native_chat_set_project_model_default,
        native_chat_set_global_model_default, native_catalog_sync,
        native_delete_provider_credential, native_generate_ideas,
        native_list_provider_credentials, native_provider_catalog,
        native_provider_catalog_refresh, native_provider_login_cancel,
        native_provider_login_poll, native_provider_login_start, native_request_metrics,
        native_request_metrics_summary, native_request_tool_approval,
        native_save_provider_credential,
    },
    plans::{
        create_plan, delete_plan, get_plan, list_plans, set_plan_context, set_plan_status,
        update_plan,
    },
    final_touches::{
        final_touch_create_step, final_touch_delete_step, final_touch_list_steps,
        final_touch_reorder_step, final_touch_set_enabled, final_touch_update_step,
    },
    pipeline::{pipeline_cancel, pipeline_get_run, pipeline_list_runs, pipeline_start},
    plan_runs::{
        plan_run_cancel, plan_run_check_completion, plan_run_complete, plan_run_enqueue,
        plan_run_get, plan_run_list, plan_run_list_queue, plan_run_pause, plan_run_remove,
        plan_run_reorder, plan_run_start, plan_run_start_omp,
    },
    openspec::{
        openspec_derive_change_name, openspec_parse_task_progress, openspec_resolve_change_name,
        openspec_task_progress,
    },
    planning_prompts::{planning_prompt_list, planning_prompt_reset, planning_prompt_set},
    slash_commands::{expand_slash_command, list_slash_commands},
    projects::{
        create_project_basebuild_config, detect_project, list_recent_projects, pick_context_file,
        pick_context_folder, pick_project_directory, remember_recent_project, remove_recent_project,
        reveal_in_explorer, set_last_active_session,
    },
    requirements::list_requirements,
     schematic::{get_project_schematic, has_project_schematic, set_project_schematic},
    settings::{
        add_approval_rule, clear_audit_trail, delete_runtime_profile, get_approval_mode,
        get_permission_rules, get_runtime_defaults, list_approval_rules, list_audit_trail,
        list_runtime_profiles, remove_approval_rule, reset_permission_rules,
        reset_runtime_defaults, set_approval_mode, set_permission_rules, set_runtime_defaults,
        upsert_runtime_profile, validate_runtime_profile,
    },
    sessions::{
        create_session, create_tab, delete_session, delete_tab, list_sessions, list_tabs,
        rename_session, update_tab_chat_session, update_tab_file_path, update_tab_terminal,
    },
    skills::read_skill,
    stability::{
        stability_delete_report, stability_list_reports, stability_mark_seen,
        stability_read_report, stability_recent_telemetry, stability_renderer_heartbeat,
        stability_unseen_count, stability_violations,
    },
    sync::{
        sync_raw_usage_native, usage_sync_projected_usage, usage_sync_set_enabled,
        usage_sync_status, usage_sync_trigger,
    },
     terminal::{close_terminal, create_terminal, list_terminals, resize_terminal, write_terminal},
    workspace::{get_workspace_restore_state, save_workspace_restore_state},
    workspaces::{workspace_create, workspace_is_supported, workspace_list, workspace_remove},
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
    // Install panic hook: file-first, deadlock-free.
    // Writes a crash report to disk before any lock/emit, then best-effort
    // emits to the frontend via try_lock (never blocks on APP_HANDLE).
    std::panic::set_hook(Box::new(|info| {
        let payload = info.payload();
        let msg = if let Some(s) = payload.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_default();
        let backtrace = std::backtrace::Backtrace::force_capture();
        let summary = format!("Panic: {msg} at {location}");
        let details = format!(
            "## Rust Crash Report\n\n**Message:** {msg}\n\n**Location:** {location}\n\n**Backtrace:**\n```\n{backtrace}\n```"
        );

        // 1. File-first: write to disk before any lock acquisition.
        let _ = crate::services::stability_service::StabilityReport::write(
            "panic",
            &summary,
            &details,
        );

        // 2. Best-effort frontend emit via try_lock (never deadlocks).
        if let Ok(handle) = APP_HANDLE.try_lock() {
            if let Some(app) = handle.as_ref() {
                let _ = app.emit("rust://panic", &details);
            }
        }

        // 3. stderr for debugging.
        eprintln!("{details}");
    }));

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .manage(app_state::AppState::default())
        .manage(std::sync::Mutex::new(crate::services::agent_service::AgentManager::default()))
        .manage(CloseToTrayState::default())
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
            crate::services::omp_telemetry_service::OmpTelemetryService::start_loop(app.handle().clone());
            // Restore connectors: mark all as disconnected (no silent auto-launch).
            let _ = crate::services::connector_service::ConnectorService::restore_on_startup();
            // Start the auto-sync loop (off by default; gates re-checked each tick).
            crate::services::sync_service::start_autosync_loop(app.handle().clone());
            // Start the freeze watchdog (heartbeat + freeze report + abort).
            crate::services::stability_service::start_watchdog(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::Manager;
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    use tauri::Manager;
                    let should_exit = window
                        .app_handle()
                        .try_state::<CloseToTrayState>()
                        .and_then(|s| s.force_exit.lock().ok().map(|g| *g))
                        .unwrap_or(false);

                    if !should_exit {
                        api.prevent_close();
                        let _ = window.hide();
                        // Opportunistic sync trigger: window hidden but process alive.
                        crate::services::sync_service::trigger_sync(
                            window.app_handle().clone(),
                            "window-hidden",
                        );
                    }
                }
                tauri::WindowEvent::Focused(false) => {
                    // Best-effort sync when the app loses focus (user stepping away).
                    crate::services::sync_service::trigger_sync(
                        window.app_handle().clone(),
                        "focus-lost",
                    );
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            open_url,
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
            omp_telemetry_start,
            omp_telemetry_stop,
            omp_telemetry_snapshot,
            omp_telemetry_refresh,
            get_project_schematic,
            has_project_schematic,
            set_project_schematic,
            create_plan,
            list_plans,
            get_plan,
            update_plan,
            delete_plan,
            set_plan_status,
            set_plan_context,
            pipeline_start,
            pipeline_cancel,
            pipeline_list_runs,
            connector_register,
            connector_list,
            connector_get,
            connector_set_enabled,
            connector_delete,
            connector_list_grants,
            connector_revoke_grants,
            connector_record_grant,
            connector_list_claims,
            connector_approve_claim,
            connector_deny_claim,
            pipeline_get_run,
            final_touch_list_steps,
            final_touch_create_step,
            final_touch_update_step,
            final_touch_set_enabled,
            final_touch_reorder_step,
            final_touch_delete_step,
            plan_run_enqueue,
            plan_run_list_queue,
            plan_run_reorder,
            plan_run_remove,
            plan_run_start,
            plan_run_start_omp,
            plan_run_pause,
            plan_run_cancel,
            plan_run_complete,
            plan_run_check_completion,
            plan_run_list,
            plan_run_get,
            mcp_reload,
            mcp_list_servers,
            mcp_list_tools,
            mcp_list_prompts,
            mcp_disconnect,
            mcp_call_tool,
            mcp_get_prompt,
            mcp_oauth_start,
            mcp_oauth_poll,
            mcp_oauth_cancel,
            mcp_oauth_clear,
            mcp_shutdown_all,
            read_skill,
            stability_list_reports,
            stability_read_report,
            stability_delete_report,
            stability_mark_seen,
            stability_unseen_count,
            stability_violations,
            stability_renderer_heartbeat,
            stability_recent_telemetry,
            openspec_task_progress,
            openspec_parse_task_progress,
            openspec_derive_change_name,
            openspec_resolve_change_name,
            planning_prompt_list,
            planning_prompt_set,
            planning_prompt_reset,
            list_slash_commands,
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
            promote_ideas,
            reject_idea,
            ensure_default_categories,
            agent_start,
            agent_send,
            agent_capabilities,
            agent_stop,
            native_provider_catalog,
            native_catalog_sync,
            native_provider_catalog_refresh,
            native_chat_start,
            native_chat_get,
            native_chat_list,
            native_chat_messages,
            native_chat_send,
            native_request_metrics,
            native_request_metrics_summary,
            native_chat_cancel,
            native_chat_resolve_approval,
            native_chat_tool_events,
            native_list_provider_credentials,
            native_delete_provider_credential,
            native_save_provider_credential,
            native_request_tool_approval,
            native_generate_ideas,
            native_chat_model_default,
            native_chat_set_project_model_default,
            native_chat_set_global_model_default,
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
            get_approval_mode,
            set_approval_mode,
            list_approval_rules,
            add_approval_rule,
            remove_approval_rule,
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
            usage_sync_trigger,
            usage_sync_set_enabled,
            usage_sync_status,
            usage_sync_projected_usage,
            get_workspace_restore_state,
            save_workspace_restore_state,
            workspace_create,
            workspace_list,
            workspace_remove,
            workspace_is_supported,
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
