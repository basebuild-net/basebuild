import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SCHEMATIC = `# Project Schematic: <Project Name>

## Purpose

<!-- One paragraph: what problem does this solve and for whom? -->

## Target users

<!-- Primary users and their top 2–3 goals. -->

## Tech stack

<!-- Runtime, framework, languages, key dependencies. -->

## Architecture notes

<!-- Major layers, data model, important folders, invariants. -->

## Design constraints

<!-- Visual system, CSS rules, component reuse rules, file conventions. -->

## Development conventions

<!-- Naming, error handling, testing, docs, commit style. -->

## Current priorities

<!-- Top 3–5 open concerns in priority order. -->

## Open questions

<!-- What is still unclear or needs a human decision? -->
`;

export async function getProjectSchematic(projectPath: string): Promise<string> {
  const result = await invoke<{ content: string }>("get_project_schematic", { projectPath });
  return result.content;
}

export async function hasProjectSchematic(projectPath: string): Promise<boolean> {
  return invoke<boolean>("has_project_schematic", { projectPath });
}

export async function setProjectSchematic(projectPath: string, content: string): Promise<void> {
  return invoke("set_project_schematic", { projectPath, content });
}
