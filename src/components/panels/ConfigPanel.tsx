import { useEffect, useState } from "react";
import { createUserConfigPack, listConfigPacks, type ConfigPack } from "../../lib/configPacks";

export function ConfigPanel({ projectPath }: { projectPath: string | null }) {
  const [packs, setPacks] = useState<ConfigPack[]>([]);
  const [newName, setNewName] = useState("");

  useEffect(() => { void refresh(); }, [projectPath]);

  async function refresh() { setPacks(await listConfigPacks(projectPath ?? undefined)); }

  async function create() {
    if (!newName.trim()) return;
    await createUserConfigPack(newName.trim());
    setNewName("");
    await refresh();
  }

  return (
    <div className="stack">
      <div className="row gap-sm">
        <input className="input" placeholder="New pack name" type="text" value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
        <button className="btn btn-primary" title="Create config pack" onClick={() => void create()} type="button">Create</button>
      </div>
      {packs.length === 0 ? <p className="text-muted">No config packs found.</p> : null}
      {packs.map((pack) => (
        <div className="config-card" key={pack.manifest.id}>
          <div className="config-card-header">
            <h3>{pack.manifest.name}</h3>
            <span className="badge">v{pack.manifest.version}</span>
          </div>
          <p className="text-muted text-sm">{pack.manifest.description}</p>
          <div className="row gap-sm mt-6">
            <span className="pill">{pack.manifest.source}</span>
            {pack.manifest.author ? <span className="text-sm text-muted">{pack.manifest.author}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
