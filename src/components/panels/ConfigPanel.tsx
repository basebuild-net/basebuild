import { useEffect, useState } from "react";

import { createUserConfigPack, listConfigPacks, type ConfigPack } from "../../lib/configPacks";

export function ConfigPanel({ projectPath }: { projectPath: string | null }) {
  const [packs, setPacks] = useState<ConfigPack[]>([]);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    void refresh();
  }, [projectPath]);

  async function refresh() {
    const discovered = await listConfigPacks(projectPath ?? undefined);
    setPacks(discovered);
  }

  async function create() {
    if (!newName.trim()) {
      return;
    }
    await createUserConfigPack(newName.trim());
    setNewName("");
    await refresh();
  }

  return (
    <div className="config-panel">
      <div className="config-create">
        <input
          className="config-input"
          placeholder="New pack name"
          type="text"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void create();
            }
          }}
        />
        <button className="primary-action" onClick={() => void create()} type="button">
          Create pack
        </button>
      </div>

      <div className="config-list">
        {packs.map((pack) => (
          <article className="config-card" key={pack.manifest.id}>
            <div className="config-card-header">
              <h3>{pack.manifest.name}</h3>
              <span className="config-version">v{pack.manifest.version}</span>
            </div>
            <p>{pack.manifest.description}</p>
            <div className="config-meta">
              <span className={`config-source is-${pack.manifest.source}`}>{pack.manifest.source}</span>
              {pack.manifest.author ? <span>{pack.manifest.author}</span> : null}
            </div>
            <div className="config-prompts">
              {pack.manifest.prompts.map((prompt) => (
                <code key={prompt}>{prompt}</code>
              ))}
            </div>
          </article>
        ))}
        {packs.length === 0 ? <p className="config-empty">No config packs found.</p> : null}
      </div>
    </div>
  );
}
