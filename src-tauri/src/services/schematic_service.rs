use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

pub const SCHEMATIC_DIR: &str = ".basebuild";
pub const SCHEMATIC_FILE: &str = "project-schematic.md";

/// Template sections in canonical order (schematic template v2.1).
pub const SECTIONS: [&str; 11] = [
    "Purpose",
    "Vision",
    "Blueprint",
    "End goals",
    "Target users",
    "Tech stack",
    "Architecture notes",
    "Design constraints",
    "Development conventions",
    "Current priorities",
    "Open questions",
];

/// Sections that may legitimately be empty and do not block `complete` health.
const OPTIONAL_SECTIONS: [&str; 1] = ["Open questions"];

fn schematic_path(project_path: &Path) -> PathBuf {
    project_path.join(SCHEMATIC_DIR).join(SCHEMATIC_FILE)
}

pub fn read(project_path: &Path) -> Result<String, String> {
    let path = schematic_path(project_path);
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read schematic: {e}"))
}

pub fn exists(project_path: &Path) -> bool {
    schematic_path(project_path).is_file()
}

pub fn write(project_path: &Path, content: &str) -> Result<PathBuf, String> {
    let dir = project_path.join(SCHEMATIC_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create .basebuild dir: {e}"))?;
    let path = dir.join(SCHEMATIC_FILE);
    std::fs::write(&path, content).map_err(|e| format!("Failed to write schematic: {e}"))?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// Inspection: parsing, completeness validation, end-goal staleness.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionState {
    Filled,
    Placeholder,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Health {
    Complete,
    Partial,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalKind {
    Year,
    Month,
    Undated,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionReport {
    pub name: String,
    pub state: SectionState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndGoal {
    pub period: String,
    pub statement: String,
    pub kind: GoalKind,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchematicReport {
    pub exists: bool,
    pub health: Health,
    pub sections: Vec<SectionReport>,
    pub end_goals: Vec<EndGoal>,
    pub missing_year_goal: bool,
    pub missing_month_goal: bool,
    pub stale_goal: bool,
}

/// Inspect the project's schematic from disk using the current (UTC) year/month.
pub fn inspect(project_path: &Path) -> SchematicReport {
    let content = read(project_path).ok();
    report_from_content(content.as_deref(), current_year_month())
}

/// Pure report builder. `today` is `(year, month)` (month 1-12).
pub fn report_from_content(content: Option<&str>, today: (i64, u32)) -> SchematicReport {
    let Some(md) = content else {
        return SchematicReport {
            exists: false,
            health: Health::Missing,
            sections: SECTIONS
                .iter()
                .map(|name| SectionReport {
                    name: (*name).to_string(),
                    state: SectionState::Missing,
                })
                .collect(),
            end_goals: Vec::new(),
            missing_year_goal: true,
            missing_month_goal: true,
            stale_goal: false,
        };
    };

    let parsed = split_sections(md);
    let find_body = |name: &str| -> Option<&str> {
        parsed
            .iter()
            .find(|(h, _)| h.eq_ignore_ascii_case(name))
            .map(|(_, b)| b.as_str())
    };

    let sections: Vec<SectionReport> = SECTIONS
        .iter()
        .map(|name| {
            let state = match find_body(name) {
                None => SectionState::Missing,
                Some(body) => classify_body(body),
            };
            SectionReport {
                name: (*name).to_string(),
                state,
            }
        })
        .collect();

    let end_goals = find_body("End goals")
        .map(|b| parse_end_goals(b, today))
        .unwrap_or_default();

    let missing_year_goal = !end_goals.iter().any(|g| g.kind == GoalKind::Year);
    let missing_month_goal = !end_goals.iter().any(|g| g.kind == GoalKind::Month);
    let stale_goal = end_goals.iter().any(|g| g.stale);

    let required_incomplete = sections
        .iter()
        .filter(|s| !OPTIONAL_SECTIONS.contains(&s.name.as_str()))
        .any(|s| s.state != SectionState::Filled);

    let health = if required_incomplete {
        Health::Partial
    } else {
        Health::Complete
    };

    SchematicReport {
        exists: true,
        health,
        sections,
        end_goals,
        missing_year_goal,
        missing_month_goal,
        stale_goal,
    }
}

/// Split markdown into `(heading, body)` pairs for each `## ` section. Content
/// before the first `## ` (e.g. the `# Title`) is ignored.
fn split_sections(md: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;
    for line in md.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            if let Some(pair) = current.take() {
                out.push(pair);
            }
            current = Some((rest.trim().to_string(), String::new()));
        } else if let Some((_, body)) = current.as_mut() {
            body.push_str(line);
            body.push('\n');
        }
    }
    if let Some(pair) = current.take() {
        out.push(pair);
    }
    out
}

/// A present section is `Placeholder` when it is empty or contains only template
/// scaffold tokens (`<...>` lines); otherwise `Filled`.
fn classify_body(body: &str) -> SectionState {
    let meaningful = body
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .any(|l| !(l.starts_with('<') && l.ends_with('>')));
    if meaningful {
        SectionState::Filled
    } else {
        SectionState::Placeholder
    }
}

/// Parse `End goal of <period>: <statement>` lines from the End goals body.
fn parse_end_goals(body: &str, today: (i64, u32)) -> Vec<EndGoal> {
    let mut goals = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim().trim_start_matches(['-', '*', ' ']).trim();
        let lower = trimmed.to_ascii_lowercase();
        let Some(idx) = lower.find("end goal of ") else {
            continue;
        };
        let after = &trimmed[idx + "end goal of ".len()..];
        let Some(colon) = after.find(':') else {
            continue;
        };
        let period = after[..colon].trim().to_string();
        let statement = after[colon + 1..].trim().to_string();
        let (kind, stale) = classify_period(&period, today);
        goals.push(EndGoal {
            period,
            statement,
            kind,
            stale,
        });
    }
    goals
}

fn classify_period(period: &str, today: (i64, u32)) -> (GoalKind, bool) {
    let p = period.trim();
    if let Ok(year) = p.parse::<i64>() {
        if (1900..=3000).contains(&year) {
            return (GoalKind::Year, year < today.0);
        }
    }
    let parts: Vec<&str> = p.split_whitespace().collect();
    if parts.len() == 2 {
        if let (Some(month), Ok(year)) = (month_num(parts[0]), parts[1].parse::<i64>()) {
            let stale = year < today.0 || (year == today.0 && month < today.1);
            return (GoalKind::Month, stale);
        }
    }
    (GoalKind::Undated, false)
}

fn month_num(name: &str) -> Option<u32> {
    let n = name.trim().to_ascii_lowercase();
    let months = [
        ("january", 1),
        ("february", 2),
        ("march", 3),
        ("april", 4),
        ("may", 5),
        ("june", 6),
        ("july", 7),
        ("august", 8),
        ("september", 9),
        ("october", 10),
        ("november", 11),
        ("december", 12),
    ];
    months
        .iter()
        .find(|(full, _)| *full == n || full.starts_with(&n) && n.len() >= 3)
        .map(|(_, num)| *num)
}

/// Current `(year, month)` in UTC, derived from the civil-date algorithm so no
/// date dependency is required.
fn current_year_month() -> (i64, u32) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let (y, m, _) = civil_from_days(days);
    (y, m)
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 → (year, month, day).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TODAY: (i64, u32) = (2026, 7); // July 2026

    fn full_schematic() -> String {
        let mut s = String::from("# Project Schematic: Test\n\n");
        for name in SECTIONS {
            s.push_str(&format!("## {name}\nReal content for {name}.\n\n"));
        }
        s
    }

    #[test]
    fn complete_when_all_sections_filled() {
        let r = report_from_content(Some(&full_schematic()), TODAY);
        assert_eq!(r.health, Health::Complete);
        assert!(r.exists);
        assert!(r.sections.iter().all(|s| s.state == SectionState::Filled));
    }

    #[test]
    fn missing_file_reports_all_missing() {
        let r = report_from_content(None, TODAY);
        assert_eq!(r.health, Health::Missing);
        assert!(!r.exists);
        assert!(r.sections.iter().all(|s| s.state == SectionState::Missing));
        assert!(r.missing_year_goal && r.missing_month_goal);
    }

    #[test]
    fn scaffold_body_is_placeholder() {
        let md = "## Purpose\n<one paragraph>\n\n## Vision\n\n";
        let r = report_from_content(Some(md), TODAY);
        let purpose = r.sections.iter().find(|s| s.name == "Purpose").unwrap();
        let vision = r.sections.iter().find(|s| s.name == "Vision").unwrap();
        assert_eq!(purpose.state, SectionState::Placeholder);
        assert_eq!(vision.state, SectionState::Placeholder);
        assert_eq!(r.health, Health::Partial);
    }

    #[test]
    fn legacy_schematic_missing_new_sections() {
        // Pre-v2: no Vision / Blueprint / End goals.
        let md = "## Purpose\nA tool.\n\n## Tech stack\nRust.\n\n## Current priorities\nShip.\n";
        let r = report_from_content(Some(md), TODAY);
        let missing = |n: &str| {
            r.sections.iter().find(|s| s.name == n).unwrap().state == SectionState::Missing
        };
        assert!(missing("Vision"));
        assert!(missing("Blueprint"));
        assert!(missing("End goals"));
        assert_eq!(r.health, Health::Partial);
    }

    #[test]
    fn open_questions_empty_still_complete() {
        let mut md = full_schematic();
        // Replace Open questions body with nothing.
        md = md.replace(
            "## Open questions\nReal content for Open questions.\n",
            "## Open questions\n",
        );
        let r = report_from_content(Some(&md), TODAY);
        assert_eq!(r.health, Health::Complete);
    }

    #[test]
    fn end_goals_year_and_month_parsed() {
        let md = "## End goals\n\
            - End goal of 2026: ship v1\n\
            - End goal of December 2026: launch marketing\n";
        let r = report_from_content(Some(md), TODAY);
        assert_eq!(r.end_goals.len(), 2);
        assert_eq!(r.end_goals[0].kind, GoalKind::Year);
        assert_eq!(r.end_goals[1].kind, GoalKind::Month);
        assert!(!r.missing_year_goal);
        assert!(!r.missing_month_goal);
        assert!(!r.stale_goal);
    }

    #[test]
    fn stale_goal_detected() {
        let md = "## End goals\n\
            End goal of 2025: was due\n\
            End goal of June 2026: also passed\n";
        let r = report_from_content(Some(md), TODAY);
        assert!(r.stale_goal);
        assert!(r.end_goals.iter().filter(|g| g.stale).count() >= 2);
    }

    #[test]
    fn undated_goal_never_stale() {
        let md = "## End goals\nEnd goal of someday: eventually\n";
        let r = report_from_content(Some(md), TODAY);
        assert_eq!(r.end_goals.len(), 1);
        assert_eq!(r.end_goals[0].kind, GoalKind::Undated);
        assert!(!r.end_goals[0].stale);
        assert!(r.missing_year_goal && r.missing_month_goal);
    }

    #[test]
    fn civil_date_epoch_is_1970() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }
}
