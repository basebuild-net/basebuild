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
    analytics::{
        analytics_event_count, delete_analytics_events, export_analytics_json,
        get_analytics_consent, list_analytics_events, record_analytics_event,
        set_analytics_consent,
    },
    app::{app_version, open_url, restart_app},
    auth::{
        auth_fetch_profile, auth_get_token, auth_poll_device_flow, auth_sign_out,
        auth_start_device_flow, auth_status,
    },
    config_packs::{create_user_config_pack, list_config_packs},
    connectors::{
        connector_approve_claim, connector_delete, connector_deny_claim, connector_get,
        connector_list, connector_list_claims, connector_list_grants, connector_record_grant,
        connector_register, connector_revoke_grants, connector_set_enabled,
    },
    execution_advisor::{
        execution_advice_clear_override, execution_advice_delete_feedback,
        execution_advice_export_feedback, execution_advice_feedback_consent, execution_advice_get,
        execution_advice_list_feedback, execution_advice_record_feedback,
        execution_advice_set_feedback_consent, execution_advice_set_override,
    },
    files::{list_files, read_file},
    final_touches::{
        final_touch_create_step, final_touch_delete_step, final_touch_list_steps,
        final_touch_reorder_step, final_touch_set_enabled, final_touch_update_step,
    },
    git::{
        git_add, git_branch_create, git_branch_list, git_branch_switch, git_commit,
        git_current_branch, git_default_branch, git_diff, git_discard, git_fetch, git_log,
        git_pull, git_push, git_remote_url, git_reset, git_stage_all, git_status, git_unstage_all,
    },
    idea_rounds::{finish_idea_round, list_idea_rounds, start_idea_round},
    ideas::{
        create_category, create_idea, delete_category, delete_idea, ensure_default_categories,
        list_categories, list_ideas, list_project_categories, list_project_ideas, promote_ideas,
        reject_idea, update_idea, update_idea_status,
    },
    integration::{integration_cleanup, integration_list},
    interactions::{
        native_interaction_cancel, native_interaction_list_all, native_interaction_list_pending,
        native_interaction_resolve, native_interaction_save_draft,
    },
    mcp::{
        mcp_call_tool, mcp_disconnect, mcp_get_prompt, mcp_list_prompts, mcp_list_servers,
        mcp_list_tools, mcp_oauth_cancel, mcp_oauth_clear, mcp_oauth_poll, mcp_oauth_start,
        mcp_reload, mcp_shutdown_all,
    },
    native_chat::{
        native_catalog_sync, native_chat_bootstrap, native_chat_cancel,
        native_chat_clear_messages, native_chat_input_history_add,
        native_chat_input_history_list, native_chat_get, native_chat_history,
        native_chat_list, native_chat_messages,
        native_chat_model_default, native_chat_rename, native_chat_resolve_approval,
        native_chat_send, native_chat_set_global_model_default,
        native_chat_set_project_model_default, native_chat_start, native_chat_steer,
        native_chat_tool_events, native_chat_update_session_model,
        native_delete_provider_credential, native_generate_ideas,
        native_local_llm_scan, native_local_model_override_set,
        native_provider_account_logout, native_provider_account_set_label,
        native_provider_account_strategy, native_provider_account_strategy_set,
        native_provider_account_test, native_provider_account_usage, native_provider_accounts_list,
        native_provider_catalog, native_provider_catalog_refresh, native_provider_login_cancel,
        native_provider_login_poll, native_provider_login_start, native_provider_login_submit,
        native_provider_popularity, native_provider_refresh_omp_credentials,
        native_request_metrics, native_request_metrics_summary, native_request_tool_approval,
        native_save_provider_credential, native_session_latest_metric,
    },
    notifications::{
        notification_delete, notification_get_settings, notification_list,
        notification_mark_all_read, notification_mark_read, notification_set_settings,
        notification_unread_count,
    },
    omp::{
        omp_config_list, omp_debug_context, omp_stats, omp_status, omp_stream_command, omp_usage,
    },
    omp_telemetry::{
        omp_telemetry_refresh, omp_telemetry_snapshot, omp_telemetry_start, omp_telemetry_stop,
    },
    openspec::{
        openspec_archive_change, openspec_derive_change_name, openspec_link_change_to_plan,
        openspec_list_changes, openspec_parse_task_progress, openspec_parse_tasks_structured,
        openspec_read_tasks_structured, openspec_refresh_task_progress,
        openspec_resolve_change_name, openspec_runtime_install, openspec_runtime_status,
        openspec_runtime_update, openspec_task_progress, openspec_toggle_task,
        openspec_unlink_plan_from_change,
    },
    pipeline::{
        pipeline_cancel, pipeline_get_run, pipeline_list_runs, pipeline_list_runs_by_project,
        pipeline_start,
    },
    plan_dependency::{
        plan_assign_with_profile, plan_coordination_event_publish, plan_coordination_events,
        plan_dependency_graph, plan_file_claims_list, plan_file_claims_set, plan_get_dependencies,
        plan_get_launch_profile, plan_merge_queue_list, plan_merge_queue_review,
        plan_set_dependencies, plan_set_launch_profile, plan_validate_readiness,
    },
    plan_import::{plan_import_apply, plan_import_detect},
    plan_runs::{
        plan_assign_to_chat, plan_run_cancel, plan_run_check_completion, plan_run_complete,
        plan_run_enqueue, plan_run_finish_outcome, plan_run_get, plan_run_list,
        plan_run_list_by_plan, plan_run_list_by_project, plan_run_list_queue,
        plan_run_mark_complete, plan_run_pause, plan_run_remove, plan_run_reorder, plan_run_start,
        plan_run_start_omp,
    },
    planning_prompts::{planning_prompt_list, planning_prompt_reset, planning_prompt_set},
    plans::{
        batch_promote_ideas, create_plan, delete_plan, get_plan, list_plans, list_project_plans,
        planning_integrity_check, set_plan_context, set_plan_status, update_plan,
    },
    projects::{
        basebuild_data_dir, create_project_basebuild_config, detect_project,
        get_last_focused_project, list_recent_projects, pick_context_file, pick_context_folder,
        pick_project_directory, remember_recent_project, remove_recent_project, reveal_in_explorer,
        set_last_active_session, set_last_focused_project, test_run_mode_init,
    },
    pull_requests::{pr_create, pr_gh_status, pr_recommend},
    requirements::list_requirements,
    schematic::{
        get_project_schematic, has_project_schematic, inspect_project_schematic,
        set_project_schematic,
    },
    sessions::{
        create_session, create_tab, delete_session, delete_tab, list_sessions, list_tabs,
        rename_session, update_tab_chat_session, update_tab_file_path, update_tab_terminal,
        update_tab_title,
    },
    settings::{
        add_approval_rule, clear_audit_trail, delete_runtime_profile, effective_run_concurrency,
        get_approval_mode, get_computer_id, get_concurrency_limits, get_milestone_auto_commit,
        get_permission_rules, get_run_concurrency_defaults, get_run_concurrency_overrides,
        get_runtime_defaults, list_approval_rules, list_audit_trail, list_runtime_profiles,
        remove_approval_rule, remove_run_concurrency_override, reset_permission_rules,
        reset_runtime_defaults, set_approval_mode, set_concurrency_limits,
        set_milestone_auto_commit, set_permission_rules, set_run_concurrency_defaults,
        set_run_concurrency_override, set_runtime_defaults, upsert_runtime_profile,
        validate_runtime_profile,
    },
    skills::{list_resolved_skills, provision_skill_dirs, read_resolved_skill, read_skill},
    slash_commands::{expand_slash_command, list_slash_commands},
    stability::{
        stability_delete_report, stability_list_reports, stability_mark_seen,
        stability_read_report, stability_recent_telemetry, stability_record_renderer_crash,
        stability_renderer_heartbeat, stability_unseen_count, stability_violations,
    },
    startup::{
        startup_disable, startup_enable, startup_get_status, startup_launch_mode, startup_reconcile,
    },
    sync::{
        sync_raw_usage_native, usage_declare_provider_plans, usage_detect_provider_plans,
        usage_drain_rates, usage_list_provider_plans, usage_sync_projected_usage, usage_sync_retry,
        usage_sync_set_enabled, usage_sync_set_mode, usage_sync_status, usage_sync_trigger,
    },
    terminal::{
        close_terminal, create_terminal, list_terminals, resize_terminal, terminal_replay,
        write_terminal,
    },
    tool_catalog::{tool_catalog_list, tool_download, tool_download_delete, tool_downloads_list},
    updater::{
        apply_downloaded_update, check_for_updates, clear_skipped_update, download_update,
        get_skipped_update_version, skip_update_version,
    },
    voice::{voice_profile_get, voice_profile_set, voice_reset_mic_permission, voice_transcribe},
    workspace::{get_workspace_restore_state, save_workspace_restore_state},
    workspaces::{workspace_create, workspace_is_supported, workspace_list, workspace_remove},
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
    // Install the rustls crypto provider before any reqwest/rmcp HTTP client
    // is built. reqwest 0.13 ships with rustls-no-provider, so a provider
    // must be installed explicitly or Client::build() panics.
    let _ = rustls::crypto::ring::default_provider().install_default();
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
        let _ =
            crate::services::stability_service::StabilityReport::write("panic", &summary, &details);

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ));
    // Release-only: a dev build must never hand off to an installed instance
    // and exit silently — that makes `tauri dev` appear to "show no changes".
    #[cfg(all(desktop, not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .manage(app_state::AppState::default())
        .manage(std::sync::Mutex::new(
            crate::services::agent_service::AgentManager::default(),
        ))
        .setup(|app| {
            // Store handle so the panic hook can emit to the frontend
            if let Ok(mut handle) = APP_HANDLE.lock() {
                *handle = Some(app.handle().clone());
            }
            // A process restart cannot retain provider streams or tool
            // executors. Convert stale database state before the UI loads so
            // recovered chats never appear to be silently running.
            crate::services::agent_loop_service::sweep_interrupted_runs();
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
            // OMP telemetry is native-first opt-in: the polling loop is NOT
            // started at launch (doing so spawned `omp stats/usage` probe
            // processes on every run, even without OMP installed). The loop
            // starts on demand (idempotent) when the OMP HUD mounts via the
            // `omp_telemetry_start` command in `useOmpTelemetry`.
            // Restore connectors: mark all as disconnected (no silent auto-launch).
            let _ = crate::services::connector_service::ConnectorService::restore_on_startup();
            // Start the auto-sync loop (off by default; gates re-checked each tick).
            crate::services::sync_service::start_autosync_loop(app.handle().clone());
            // Collect v2 rows locally every five minutes when collection consent is enabled.
            crate::services::usage_v2_collector_service::UsageV2CollectorService::start_background_loop();
            // Start the freeze watchdog (heartbeat + freeze report + abort).
            crate::services::stability_service::start_watchdog(app.handle().clone());
            // Reconcile Windows autostart registration with persisted intent
            // (idempotent — only acts if intent and OS state disagree).
            let _ = crate::services::startup_service::StartupService::reconcile(app.handle());
            // Detect launch mode: if launched with --background (autostart),
            // keep the main window hidden. The frontend can also query this
            // via the startup_launch_mode command.
            let launch_mode = crate::services::startup_service::detect_launch_mode();
            eprintln!("[startup] launch mode: {:?}", launch_mode);
            if matches!(launch_mode, crate::models::startup::LaunchMode::Background) {
                eprintln!("[startup] background launch — main window stays hidden");
            } else {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    eprintln!("[startup] foreground launch — main window shown");
                }
            }
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
                        eprintln!("[startup] window close → tray (hidden, process alive)");
                        // Opportunistic sync trigger: window hidden but process alive.
                        crate::services::sync_service::trigger_sync(
                            window.app_handle().clone(),
                            "window-hidden",
                            false,
                        );
                    }
                }
                tauri::WindowEvent::Focused(false) => {
                    // Best-effort sync when the app loses focus (user stepping away).
                    crate::services::sync_service::trigger_sync(
                        window.app_handle().clone(),
                        "focus-lost",
                        false,
                    );
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            open_url,
            restart_app,
            remember_recent_project,
            list_recent_projects,
            get_last_focused_project,
            set_last_focused_project,
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
            basebuild_data_dir,
            test_run_mode_init,
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
            inspect_project_schematic,
            create_plan,
            batch_promote_ideas,
            list_plans,
            list_project_plans,
            get_plan,
            planning_integrity_check,
            update_plan,
            delete_plan,
            set_plan_status,
            set_plan_context,
            pipeline_start,
            pipeline_cancel,
            pipeline_list_runs,
            pipeline_list_runs_by_project,
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
            integration_list,
            integration_cleanup,
            final_touch_update_step,
            final_touch_set_enabled,
            final_touch_reorder_step,
            final_touch_delete_step,
            plan_assign_to_chat,
            plan_run_enqueue,
            plan_run_list_queue,
            plan_run_reorder,
            plan_run_remove,
            plan_run_start,
            plan_run_start_omp,
            plan_run_pause,
            plan_run_cancel,
            plan_run_complete,
            plan_run_mark_complete,
            plan_run_check_completion,
            plan_run_finish_outcome,
            plan_run_list,
            plan_run_list_by_project,
            plan_run_list_by_plan,
            plan_run_get,
            plan_set_dependencies,
            plan_get_dependencies,
            plan_dependency_graph,
            plan_validate_readiness,
            plan_file_claims_set,
            plan_file_claims_list,
            plan_coordination_event_publish,
            plan_coordination_events,
            plan_set_launch_profile,
            plan_get_launch_profile,
            plan_merge_queue_list,
            plan_merge_queue_review,
            plan_assign_with_profile,
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
            list_resolved_skills,
            read_resolved_skill,
            provision_skill_dirs,
            stability_read_report,
            stability_delete_report,
            stability_mark_seen,
            stability_unseen_count,
            stability_violations,
            stability_renderer_heartbeat,
            stability_recent_telemetry,
            stability_record_renderer_crash,
            openspec_task_progress,
            openspec_parse_task_progress,
            openspec_derive_change_name,
            openspec_resolve_change_name,
            openspec_list_changes,
            openspec_parse_tasks_structured,
            openspec_read_tasks_structured,
            openspec_toggle_task,
            openspec_link_change_to_plan,
            openspec_unlink_plan_from_change,
            openspec_refresh_task_progress,
            openspec_runtime_status,
            openspec_runtime_install,
            openspec_runtime_update,
            openspec_archive_change,
            plan_import_detect,
            plan_import_apply,
            planning_prompt_list,
            planning_prompt_set,
            planning_prompt_reset,
            list_slash_commands,
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            list_terminals,
            terminal_replay,
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
            git_log,
            git_current_branch,
            git_default_branch,
            git_remote_url,
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
            update_tab_title,
            create_category,
            list_categories,
            list_project_categories,
            delete_category,
            create_idea,
            update_idea,
            list_ideas,
            list_project_ideas,
            update_idea_status,
            delete_idea,
            promote_ideas,
            reject_idea,
            ensure_default_categories,
            start_idea_round,
            finish_idea_round,
            list_idea_rounds,
            execution_advice_get,
            execution_advice_set_override,
            execution_advice_clear_override,
            execution_advice_feedback_consent,
            execution_advice_set_feedback_consent,
            execution_advice_record_feedback,
            execution_advice_list_feedback,
            execution_advice_export_feedback,
            execution_advice_delete_feedback,
            agent_start,
            agent_send,
            agent_capabilities,
            agent_stop,
            native_provider_catalog,
            native_chat_bootstrap,
            native_catalog_sync,
            native_provider_popularity,
            native_provider_catalog_refresh,
            native_local_llm_scan,
            native_local_model_override_set,
            native_chat_start,
            native_chat_get,
            native_chat_rename,
            native_chat_list,
            native_chat_history,
            native_chat_messages,
            native_chat_clear_messages,
            native_chat_update_session_model,
            native_chat_input_history_add,
            native_chat_input_history_list,
            native_chat_send,
            native_chat_steer,
            native_request_metrics,
            native_request_metrics_summary,
            native_session_latest_metric,
            native_chat_cancel,
            native_chat_resolve_approval,
            native_chat_tool_events,
            native_delete_provider_credential,
            native_save_provider_credential,
            native_request_tool_approval,
            native_generate_ideas,
            native_chat_model_default,
            native_chat_set_project_model_default,
            native_chat_set_global_model_default,
            native_provider_login_start,
            native_provider_login_poll,
            native_provider_login_submit,
            native_provider_login_cancel,
            native_provider_accounts_list,
            native_provider_account_logout,
            native_provider_account_set_label,
            native_provider_account_test,
            native_provider_account_usage,
            native_provider_account_strategy,
            native_provider_account_strategy_set,
            native_provider_refresh_omp_credentials,
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
            get_computer_id,
            list_audit_trail,
            clear_audit_trail,
            get_approval_mode,
            set_approval_mode,
            list_approval_rules,
            add_approval_rule,
            remove_approval_rule,
            get_run_concurrency_defaults,
            set_run_concurrency_defaults,
            get_run_concurrency_overrides,
            set_run_concurrency_override,
            effective_run_concurrency,
            get_concurrency_limits,
            set_concurrency_limits,
            get_milestone_auto_commit,
            set_milestone_auto_commit,
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
            usage_sync_retry,
            usage_sync_set_enabled,
            usage_sync_set_mode,
            usage_sync_projected_usage,
            usage_sync_status,
            usage_detect_provider_plans,
            usage_list_provider_plans,
            usage_declare_provider_plans,
            usage_drain_rates,
            get_workspace_restore_state,
            save_workspace_restore_state,
            workspace_create,
            workspace_list,
            workspace_remove,
            workspace_is_supported,
            pr_recommend,
            pr_create,
            pr_gh_status,
            check_for_updates,
            download_update,
            apply_downloaded_update,
            skip_update_version,
            clear_skipped_update,
            notification_list,
            notification_unread_count,
            notification_set_settings,
            native_interaction_list_pending,
            native_interaction_list_all,
            native_interaction_resolve,
            native_interaction_save_draft,
            native_interaction_cancel,
            get_skipped_update_version,
            notification_mark_all_read,
            notification_delete,
            notification_get_settings,
            notification_set_settings,
            get_skipped_update_version,
            startup_get_status,
            startup_enable,
            startup_disable,
            startup_reconcile,
            startup_launch_mode,
            notification_mark_read,
            git_commit,
            expand_slash_command,
            stability_list_reports,
            final_touch_create_step,
            remove_run_concurrency_override,
            voice_profile_get,
            voice_profile_set,
            voice_transcribe,
            voice_reset_mic_permission,
            tool_catalog_list,
            tool_downloads_list,
            tool_download,
            tool_download_delete,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Basebuild")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                eprintln!("[APP] ExitRequested — running final sync before exit");
                crate::services::sync_service::sync_on_exit();
                eprintln!("[APP] final sync done — exiting");
            }
        });
}

#[cfg(test)]
mod tests {
    use crate::models::session::TabKind;

    #[test]
    fn tab_kind_serializes_as_plain_string() {
        let json = serde_json::to_string(&TabKind::Terminal).unwrap();
        assert_eq!(
            json, "\"terminal\"",
            "TabKind must serialize as a plain string to match the frontend TabKind type"
        );

        let kind: TabKind = serde_json::from_str("\"chat\"").unwrap();
        assert_eq!(
            kind,
            TabKind::Chat,
            "TabKind must deserialize from a plain string"
        );
    }
}
