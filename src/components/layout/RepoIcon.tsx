import type { RepoHost } from "../../lib/repoIdentity";

type RepoIconProps = {
  host: RepoHost;
  size?: number;
};

export function RepoIcon({ host, size = 16 }: RepoIconProps) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true as const };

  switch (host) {
    case "github":
      return (
        <svg {...common} className="repo-icon-svg">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      );
    case "gitlab":
      return (
        <svg {...common} className="repo-icon-svg">
          <path fill="currentColor" d="M8.01 15.27l1.42-4.36H5.66l1.42 4.36h.93zM5.66 10.91h4.7l.73-2.26H4.93l.73 2.26zM4.2 8.65h7.6l.73-2.26H3.47l.73 2.26zM2.74 6.39h10.52l.73-2.26H2.01l.73 2.26zM8 0L5.38 2.59h5.24L8 0z" />
        </svg>
      );
    case "bitbucket":
      return (
        <svg {...common} className="repo-icon-svg">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm4.02 5.14l-1.07 6.04H5.05L3.98 5.14h8.04z" />
        </svg>
      );
    case "generic-git":
      return (
        <svg {...common} className="repo-icon-svg">
          <path fill="currentColor" d="M15.698 7.287L8.712.301a1.03 1.03 0 00-1.457 0L5.827 1.729l1.779 1.779a1.223 1.223 0 011.55 1.56l1.714 1.714a1.223 1.223 0 011.262 2.019 1.223 1.223 0 01-1.975-1.492L8.586 5.686v4.356a1.223 1.223 0 11-1.008-.035V5.648a1.223 1.223 0 01-.664-1.604L5.156 2.4.301 7.254a1.03 1.03 0 000 1.458l6.987 6.986a1.03 1.03 0 001.457 0l6.953-6.953a1.03 1.03 0 000-1.458z" />
        </svg>
      );
    case "folder":
    default:
      return (
        <svg {...common} className="repo-icon-svg">
          <path fill="currentColor" d="M14 3H7.5L6 1.5H2A1.5 1.5 0 00.5 3v10A1.5 1.5 0 002 14.5h12a1.5 1.5 0 001.5-1.5V4.5A1.5 1.5 0 0014 3z" />
        </svg>
      );
  }
}
