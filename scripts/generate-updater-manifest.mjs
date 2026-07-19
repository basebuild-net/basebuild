#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const ASSETS = {
  windows: "Basebuild-windows-x86_64-setup.exe",
  linuxAppImage: "Basebuild-linux-x86_64.AppImage",
  linuxDeb: "Basebuild-linux-x86_64.deb",
  macOS: "Basebuild-macos-universal.app.tar.gz",
};

function downloadUrl(repository, tag, assetName) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

function requireAsset(assetNames, assetName) {
  if (!assetNames.has(assetName)) {
    throw new Error(`Required updater asset is missing: ${assetName}`);
  }
}

function readSignature(signaturesDirectory, assetName) {
  const signatureName = `${assetName}.sig`;
  const signature = readFileSync(join(signaturesDirectory, signatureName), "utf8").trim();
  if (!signature) {
    throw new Error(`Updater signature is empty: ${signatureName}`);
  }
  return signature;
}

function platform(repository, tag, signaturesDirectory, assetName) {
  return {
    signature: readSignature(signaturesDirectory, assetName),
    url: downloadUrl(repository, tag, assetName),
  };
}

export function generateUpdaterManifest({
  metadata,
  signaturesDirectory,
  repository,
  tag,
  version,
}) {
  if (!repository.includes("/")) {
    throw new Error("Repository must use the owner/name format.");
  }
  if (tag !== `v${version}`) {
    throw new Error(`Tag ${tag} does not match version ${version}.`);
  }

  const assetNames = new Set((metadata.assets ?? []).map((asset) => asset.name));
  for (const assetName of Object.values(ASSETS)) {
    requireAsset(assetNames, assetName);
    requireAsset(assetNames, `${assetName}.sig`);
  }

  const windows = platform(repository, tag, signaturesDirectory, ASSETS.windows);
  const linuxAppImage = platform(
    repository,
    tag,
    signaturesDirectory,
    ASSETS.linuxAppImage,
  );
  const linuxDeb = platform(repository, tag, signaturesDirectory, ASSETS.linuxDeb);
  const macOS = platform(repository, tag, signaturesDirectory, ASSETS.macOS);

  return {
    version,
    notes: metadata.body ?? "",
    pub_date: metadata.createdAt ?? new Date().toISOString(),
    platforms: {
      "windows-x86_64": windows,
      "windows-x86_64-nsis": windows,
      "linux-x86_64": linuxAppImage,
      "linux-x86_64-appimage": linuxAppImage,
      "linux-x86_64-deb": linuxDeb,
      "darwin-aarch64": macOS,
      "darwin-x86_64": macOS,
      "darwin-aarch64-app": macOS,
      "darwin-x86_64-app": macOS,
    },
  };
}

function runCli() {
  const [metadataPath, signaturesDirectory, repository, tag, version, outputPath] =
    process.argv.slice(2);
  if (!outputPath) {
    throw new Error(
      "Usage: generate-updater-manifest <metadata.json> <signatures-dir> <owner/repo> <tag> <version> <output.json>",
    );
  }

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const manifest = generateUpdaterManifest({
    metadata,
    signaturesDirectory,
    repository,
    tag,
    version,
  });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${basename(outputPath)} for ${Object.keys(manifest.platforms).length} platform keys.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
