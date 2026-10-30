import { useEffect, useState } from "react";
import { Check, FolderOpen, MessageSquarePlus, Plug, type LucideIcon } from "lucide-react";
import { nativeProviderCatalog } from "../../lib/native-chat";
import { useLogs } from "../../state/log";
import { t } from "../../i18n";

type GetStartedHomeProps = {
  /** Changes when Settings closes so the provider check runs again. */
  refreshKey: number;
  /** Projects known to the sidebar (open or recent). */
  projectCount: number;
  hasProjectOpen: boolean;
  /** Chat surfaces currently open in the workspace. */
  chatCount: number;
  pickerInFlight: boolean;
  onOpenProviderSettings: () => void;
  onOpenFolder: () => void;
  onNewChat: () => void;
};

type ProviderCheck = "loading" | "ready" | "error";

type StepCard = {
  key: "connect" | "project" | "chat";
  Icon: LucideIcon;
  title: string;
  hint: string;
  doneText: string;
  done: boolean;
  checking: boolean;
  action: string;
  disabled: boolean;
  onAction: () => void;
};

/**
 * Empty-workspace home: three steps to a first agent run. Done-states are
 * derived live; the provider step stays "checking" until the catalog resolves
 * so a slow lookup never reads as "not connected".
 */
export function GetStartedHome({
  refreshKey,
  projectCount,
  hasProjectOpen,
  chatCount,
  pickerInFlight,
  onOpenProviderSettings,
  onOpenFolder,
  onNewChat,
}: GetStartedHomeProps) {
  const { addLog } = useLogs();
  const [providerCheck, setProviderCheck] = useState<ProviderCheck>("loading");
  const [providerConnected, setProviderConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProviderCheck("loading");
    nativeProviderCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setProviderConnected(catalog.providers.some((provider) => provider.configured && !provider.localOnly));
        setProviderCheck("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setProviderConnected(false);
        setProviderCheck("error");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const connectDone = providerConnected;
  const projectDone = projectCount > 0 || hasProjectOpen;
  const chatDone = chatCount > 0;
  const doneCount = [connectDone, projectDone, chatDone].filter(Boolean).length;

  const steps: StepCard[] = [
    {
      key: "connect",
      Icon: Plug,
      title: t("getStarted.connectTitle"),
      hint: t("getStarted.connectHint"),
      doneText: t("getStarted.connectDone"),
      done: connectDone,
      checking: providerCheck === "loading",
      action: connectDone ? t("getStarted.manageProviders") : t("getStarted.connectAction"),
      disabled: false,
      onAction: () => {
        addLog("debug", "Get started: open provider settings");
        onOpenProviderSettings();
      },
    },
    {
      key: "project",
      Icon: FolderOpen,
      title: t("getStarted.projectTitle"),
      hint: t("getStarted.projectHint"),
      doneText: t("getStarted.projectDone"),
      done: projectDone,
      checking: false,
      action: t("getStarted.projectAction"),
      disabled: pickerInFlight,
      onAction: () => {
        addLog("debug", "Get started: open folder");
        onOpenFolder();
      },
    },
    {
      key: "chat",
      Icon: MessageSquarePlus,
      title: t("getStarted.chatTitle"),
      hint: hasProjectOpen ? t("getStarted.chatHint") : t("getStarted.chatLocked"),
      doneText: t("getStarted.chatDone"),
      done: chatDone,
      checking: false,
      action: t("getStarted.chatAction"),
      disabled: !hasProjectOpen,
      onAction: () => {
        addLog("debug", "Get started: new chat");
        onNewChat();
      },
    },
  ];

  return (
    <section className="get-started" aria-labelledby="get-started-heading">
      <header className="get-started-header">
        <h2 id="get-started-heading">{t("getStarted.heading")}</h2>
        <p className="get-started-sub">{t("getStarted.subheading")}</p>
        <span className="get-started-progress">{t("getStarted.progress", { done: doneCount })}</span>
      </header>
      <ol className="get-started-steps">
        {steps.map((step, index) => (
          <li key={step.key} className={`get-started-card${step.done ? " is-done" : ""}`}>
            <div className="get-started-card-head">
              <span className="get-started-card-icon" aria-hidden="true">
                {step.done ? <Check size={13} /> : <step.Icon size={13} />}
              </span>
              <span className="get-started-card-state">
                {step.checking
                  ? t("getStarted.checking")
                  : step.done
                    ? t("getStarted.stepDone")
                    : `${index + 1}. ${t("getStarted.stepTodo")}`}
              </span>
            </div>
            <h3 className="get-started-card-title">{step.title}</h3>
            <p className="get-started-card-hint">{step.done ? step.doneText : step.hint}</p>
            <button
              className={`btn btn-sm${step.done ? "" : " btn-primary"} get-started-card-action`}
              type="button"
              title={step.action}
              disabled={step.disabled}
              onClick={step.onAction}
            >
              {step.action}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
