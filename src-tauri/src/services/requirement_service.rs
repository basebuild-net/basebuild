use std::process::Command;

use crate::models::requirement::{RequirementSeverity, RequirementStatus};

#[derive(Debug, Default)]
pub struct RequirementService;

impl RequirementService {
    pub fn check_all() -> Vec<RequirementStatus> {
        vec![Self::check_git(), Self::check_omp()]
    }

    pub fn check_git() -> RequirementStatus {
        match command_version("git", &["--version"]) {
            Ok(output) => RequirementStatus {
                id: "git".to_string(),
                label: "Git".to_string(),
                required: true,
                installed: true,
                version: parse_git_version(&output),
                severity: RequirementSeverity::Ok,
                message: None,
            },
            Err(message) => RequirementStatus {
                id: "git".to_string(),
                label: "Git".to_string(),
                required: true,
                installed: false,
                version: None,
                severity: RequirementSeverity::Error,
                message: Some(message),
            },
        }
    }

    pub fn check_omp() -> RequirementStatus {
        match command_version("omp", &["--version"]) {
            Ok(output) => RequirementStatus {
                id: "omp".to_string(),
                label: "OhMyPi / OMP".to_string(),
                required: false,
                installed: true,
                version: Some(output.trim().to_string()),
                severity: RequirementSeverity::Ok,
                message: None,
            },
            Err(message) => RequirementStatus {
                id: "omp".to_string(),
                label: "OhMyPi / OMP".to_string(),
                required: false,
                installed: false,
                version: None,
                severity: RequirementSeverity::Attention,
                message: Some(message),
            },
        }
    }
}

fn command_version(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|_| format!("{program} was not found on PATH."))?;

    if !output.status.success() {
        return Err(format!("{program} returned a non-zero exit code."));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Err(format!("{program} did not report a version."))
    } else {
        Ok(stdout)
    }
}

fn parse_git_version(output: &str) -> Option<String> {
    output
        .strip_prefix("git version ")
        .map(str::trim)
        .map(str::to_string)
}
