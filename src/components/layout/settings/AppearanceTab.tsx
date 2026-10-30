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
import { t } from "../../../i18n";
import { LanguagePicker } from "../LanguagePicker";

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const [scale, setScale] = useState<UiScale>(() => getUiScale());
  useEffect(() => subscribeUiScale(setScale), []);
  const themes: { id: AppTheme; label: string; icon: typeof Sun; title: string }[] = [
    { id: "dark", label: t("appearanceTab.dark"), icon: Moon, title: t("appearanceTab.blackGreySilverCanvasWithGreen") },
    { id: "dark-green", label: t("appearanceTab.darkGreen"), icon: Moon, title: t("appearanceTab.graphiteGreenCanvasWithARicher") },
    { id: "light", label: t("appearanceTab.light"), icon: Sun, title: t("appearanceTab.softNeutralCanvasWithDeeperAccent") },
  ];
  const minScale = UI_SCALE_STEPS[0];
  const maxScale = UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1];
  return (
    <div className="stack">
      <h3>{t("localePicker.label")}</h3>
      <p className="text-muted text-sm">{t("localePicker.hint")}</p>
      <LanguagePicker />
      <h3>{t("appearanceTab.theme")}</h3>
      <p className="text-muted text-sm">{t("appearanceTab.chooseTheColorSchemeFor")}</p>
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
      <h3>{t("appearanceTab.uIScale")}</h3>
      <p className="text-muted text-sm">
        {t("appearanceTab.scalesTheWholeInterfaceProportionally")}
      </p>
      <div className="row ui-scale-control" role="group" aria-label={t("appearanceTab.uIScale")}>
        <button
          className="btn btn-sm"
          type="button"
          title={t("appearanceTab.decreaseUiScaleCtrl")}
          disabled={scale <= minScale}
          onClick={() => stepUiScale(-1)}
        >
          −
        </button>
        <span className="mono ui-scale-value" title={t("appearanceTab.currentUIScale", { scale: scale })}>{scale}%</span>
        <button
          className="btn btn-sm"
          type="button"
          title={t("appearanceTab.increaseUiScaleCtrl")}
          disabled={scale >= maxScale}
          onClick={() => stepUiScale(1)}
        >
          +
        </button>
        <button
          className="btn btn-sm btn-ghost"
          type="button"
          title={t("appearanceTab.resetUiScaleTo100")}
          disabled={scale === 100}
          onClick={() => resetUiScale()}
        >
          {t("appearanceTab.reset")}
        </button>
      </div>
    </div>
  );
}
