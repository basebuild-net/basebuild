//! Serializable types for stability reports and telemetry.

use serde::{Deserialize, Serialize};

pub type StabilityReport = crate::services::stability_service::StabilityReport;
pub type CommandTelemetryEntry = crate::services::stability_service::CommandTelemetryEntry;
