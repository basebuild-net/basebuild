import { useEffect, useState } from "react";
import { ChevronDown, LogOut, User } from "lucide-react";
import type { AccountState } from "../../state/account";

type AccountButtonProps = {
  account: AccountState;
  onOpenSettings: () => void;
};

export function AccountButton({ account, onOpenSettings }: AccountButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".account-button")) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  if (account.loading) {
    return <div className="account-button account-button-loading" />;
  }

  if (!account.profile) {
    return (
      <div className="account-button">
        <button
          className="account-signin-btn"
          type="button"
          title="Sign in to basebuild.net"
          onClick={onOpenSettings}
        >
          <User size={13} />
          <span>Sign in</span>
        </button>
      </div>
    );
  }

  const initial = account.profile.username.slice(0, 2).toUpperCase();

  return (
    <div className="account-button">
      <button
        className="account-trigger"
        type="button"
        title={`${account.profile.username} — ${account.profile.email}`}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {account.profile.image && !imgFailed ? (
          <img
            src={account.profile.image}
            alt={account.profile.username}
            className="account-avatar"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="account-avatar account-avatar-placeholder">{initial}</span>
        )}
        <span className="account-name">{account.profile.username}</span>
        <ChevronDown size={11} className="account-chevron" />
      </button>
      {menuOpen ? (
        <div className="account-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="account-dropdown-header">
            <span className="text-sm">{account.profile.username}</span>
            <span className="text-muted text-sm">{account.profile.email}</span>
          </div>
          <button
            className="account-dropdown-item"
            type="button"
            title="Open settings"
            onClick={() => { setMenuOpen(false); onOpenSettings(); }}
          >
            <User size={12} /> Settings
          </button>
          <button
            className="account-dropdown-item account-dropdown-danger"
            type="button"
            title="Sign out and revoke this device's token"
            onClick={() => { setMenuOpen(false); void account.signOut(); }}
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
