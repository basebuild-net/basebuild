import { useEffect, useState } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { useTheme, type AppTheme } from "../../../state/useTheme";
import {
  getUiScale,
  resetUiScale,
  stepUiScale,
  subscribeUiScale,
  UI_SCALE_STEPS,
  type UiScale,
} from "../../../lib/uiScale";

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const [scale, setScale] = useState<UiScale>(() => getUiScale());
  useEffect(() => subscribeUiScale(setScale), []);
  const themes: { id: AppTheme; label: string; icon: typeof Sun; title: string }[] = [
    { id: "dark", label: "Dark", icon: Moon, title: "Graphite canvas with green accent — the default Basebuild theme." },
    { id: "light", label: "Light", icon: Sun, title: "Soft neutral canvas with deeper accent for contrast." },
  ];
  const minScale = UI_SCALE_STEPS[0];
  const maxScale = UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1];
  return (
    <div className="stack">
      <h3>Theme</h3>
      <p className="text-muted text-sm">Choose the color scheme for the Basebuild interface. The theme is stored locally and applied before the app paints to avoid flash.</p>
      <div className="theme-picker">
        {themes.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`btn theme-picker-card${theme === t.id ? " btn-primary" : ""}`}
              type="button"
              title={t.title}
              aria-pressed={theme === t.id}
              onClick={() => setTheme(t.id)}
            >
              <Icon size={24} />
              <span>{t.label}</span>
              {theme === t.id ? <Check size={12} /> : null}
            </button>
          );
        })}
      </div>
      <h3>UI scale</h3>
      <p className="text-muted text-sm">
        Scales the whole interface proportionally — text, padding, and layout together.
        Keyboard: CTRL+= to zoom in, CTRL+- to zoom out, CTRL+0 to reset. Stored locally.
      </p>
      <div className="row ui-scale-control" role="group" aria-label="UI scale">
        <button
          className="btn btn-sm"
          type="button"
          title="Decrease UI scale (CTRL+-)"
          disabled={scale <= minScale}
          onClick={() => stepUiScale(-1)}
        >
          −
        </button>
        <span className="mono ui-scale-value" title={`Current UI scale: ${scale}%`}>{scale}%</span>
        <button
          className="btn btn-sm"
          type="button"
          title="Increase UI scale (CTRL+=)"
          disabled={scale >= maxScale}
          onClick={() => stepUiScale(1)}
        >
          +
        </button>
        <button
          className="btn btn-sm btn-ghost"
          type="button"
          title="Reset UI scale to 100% (CTRL+0)"
          disabled={scale === 100}
          onClick={() => resetUiScale()}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
