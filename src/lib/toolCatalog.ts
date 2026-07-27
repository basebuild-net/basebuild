import { invoke } from "@tauri-apps/api/core";

// ─── Types ───
//
// Mirrors `src-tauri/src/models/tool_catalog.rs` field for field. The tools
// catalog is the companion to `models.json`: where that file carries AI/LLM
// chat and coding models, `tools.json` carries non-LLM services that Basebuild
// can download and run locally, such as offline speech-to-text engines.

/** The kind of non-LLM service a tool provides. */
export type ToolKind = "speechToText";

export type ToolCapabilities = {
  speechToText: boolean;
  toolCalling: boolean;
  selfHostDownloadLink: boolean;
  /** STT: whether the model supports streaming/low-latency inference. */
  streaming: boolean;
  /** STT: whether the model can translate to English. */
  translate: boolean;
  /** STT: whether the model auto-detects the spoken language. */
  langDetect: boolean;
  /** STT: timestamp granularity (`"token"`, `"word"`, `"segment"`, `"none"`). */
  timestamps: string;
};

export type ToolFile = {
  /** Quantization label (`"Q8_0"`, `"Q5_K_M"`, `"F16"`, etc.). */
  quant: string;
  /** Exact file size in bytes. */
  sizeBytes: number;
  /** Canonical HTTPS download URL. */
  url: string;
};

export type CatalogTool = {
  id: string;
  name: string;
  family: string;
  architecture?: string;
  parameters?: string;
  description: string;
  languages: string[];
  capabilities: ToolCapabilities;
  license: string;
  baseModel?: string;
  recommended: boolean;
  recommendedRank?: number;
  files: ToolFile[];
  defaultQuant: string;
};

// ─── Commands ───

/**
 * List all tools of a kind from the bundled `tools.json` catalog. Currently
 * only `speechToText` is supported.
 */
export async function toolCatalogList(kind: ToolKind): Promise<CatalogTool[]> {
  return invoke<CatalogTool[]>("tool_catalog_list", { kind });
}


export type DownloadedToolModel = {
  toolId: string;
  quant: string;
  kind: string;
  localPath: string;
  sizeBytes: number;
  downloadedAt: number;
};

export type ToolDownloadResult = {
  toolId: string;
  quant: string;
  localPath: string;
  sizeBytes: number;
};

// ─── Download Commands ───

/** List all downloaded tool models. */
export async function toolDownloadsList(): Promise<DownloadedToolModel[]> {
  return invoke<DownloadedToolModel[]>("tool_downloads_list");
}

/** Download a specific quantization of a tool model. */
export async function toolDownload(
  kind: ToolKind,
  toolId: string,
  quant: string,
): Promise<ToolDownloadResult> {
  return invoke<ToolDownloadResult>("tool_download", { kind, toolId, quant });
}

/** Delete a downloaded tool model file and its database row. */
export async function toolDownloadDelete(
  toolId: string,
  quant: string,
): Promise<void> {
  return invoke<void>("tool_download_delete", { toolId, quant });
}