export type UpdateSource = "app" | "configPack" | "requirement" | "skillOrPlugin";
export type UpdateAction = "none" | "install" | "review" | "openUrl" | "recheck";

export type UpdateCard = {
  id: string;
  title: string;
  installedVersion: string | null;
  availableVersion: string | null;
  source: UpdateSource;
  action: UpdateAction;
};
