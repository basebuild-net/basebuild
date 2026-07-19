import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateUpdaterManifest } from "./generate-updater-manifest.mjs";

const assetNames = [
  "Basebuild-windows-x86_64-setup.exe",
  "Basebuild-linux-x86_64.AppImage",
  "Basebuild-linux-x86_64.deb",
  "Basebuild-macos-universal.app.tar.gz",
];

function fixture() {
  const signaturesDirectory = mkdtempSync(join(tmpdir(), "basebuild-signatures-"));
  for (const assetName of assetNames) {
    writeFileSync(join(signaturesDirectory, `${assetName}.sig`), `signature:${assetName}\n`);
  }
  return signaturesDirectory;
}

function metadata(names = assetNames) {
  return {
    body: "Release notes",
    createdAt: "2026-07-19T00:00:00Z",
    assets: names.flatMap((name) => [{ name }, { name: `${name}.sig` }]),
  };
}

test("builds one complete manifest after every platform uploads", () => {
  const signaturesDirectory = fixture();
  try {
    const manifest = generateUpdaterManifest({
      metadata: metadata(),
      signaturesDirectory,
      repository: "basebuild-net/basebuild",
      tag: "v0.0.27",
      version: "0.0.27",
    });

    assert.equal(manifest.version, "0.0.27");
    assert.equal(manifest.notes, "Release notes");
    assert.equal(manifest.pub_date, "2026-07-19T00:00:00Z");
    assert.deepEqual(Object.keys(manifest.platforms), [
      "windows-x86_64",
      "windows-x86_64-nsis",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "darwin-aarch64",
      "darwin-x86_64",
      "darwin-aarch64-app",
      "darwin-x86_64-app",
    ]);
    assert.deepEqual(
      manifest.platforms["darwin-aarch64"],
      manifest.platforms["darwin-x86_64"],
    );
    assert.match(
      manifest.platforms["darwin-aarch64"].url,
      /Basebuild-macos-universal\.app\.tar\.gz$/,
    );
    assert.equal(
      manifest.platforms["windows-x86_64"].signature,
      "signature:Basebuild-windows-x86_64-setup.exe",
    );
  } finally {
    rmSync(signaturesDirectory, { recursive: true, force: true });
  }
});

test("rejects a partial platform upload", () => {
  const signaturesDirectory = fixture();
  try {
    const incomplete = assetNames.filter(
      (name) => name !== "Basebuild-macos-universal.app.tar.gz",
    );
    assert.throws(
      () =>
        generateUpdaterManifest({
          metadata: metadata(incomplete),
          signaturesDirectory,
          repository: "basebuild-net/basebuild",
          tag: "v0.0.27",
          version: "0.0.27",
        }),
      /Required updater asset is missing: Basebuild-macos-universal\.app\.tar\.gz/,
    );
  } finally {
    rmSync(signaturesDirectory, { recursive: true, force: true });
  }
});

test("rejects a mismatched tag and version", () => {
  assert.throws(
    () =>
      generateUpdaterManifest({
        metadata: metadata(),
        signaturesDirectory: ".",
        repository: "basebuild-net/basebuild",
        tag: "v0.0.26",
        version: "0.0.27",
      }),
    /does not match version/,
  );
});
