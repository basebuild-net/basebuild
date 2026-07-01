import { useEffect, useRef, useState } from "react";
export type MenuAction = {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
};

export type MenuConfig = {
  label: string;
  items: MenuAction[];
};

type MenuBarProps = {
  menus: MenuConfig[];
};

export function MenuBar({ menus }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  return (
    <nav className="menu-bar" ref={ref}>
      {menus.map((menu) => (
        <div
          key={menu.label}
          className={`menu-bar-item${openMenu === menu.label ? " is-open" : ""}`}
          onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
        >
          {menu.label}
          {openMenu === menu.label ? (
            <div className="menu-bar-dropdown" onClick={(e) => e.stopPropagation()}>
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div className="menu-bar-dropdown-sep" key={`sep-${i}`} />
                ) : (
                  <button
                    key={i}
                    className={`menu-bar-dropdown-item${item.disabled ? " is-disabled" : ""}`}
                    type="button"
                    onClick={() => {
                      item.onClick?.();
                      setOpenMenu(null);
                    }}
                    disabled={item.disabled}
                  >
                    <span>{item.label}</span>
                    {item.shortcut ? <span className="menu-bar-shortcut">{item.shortcut}</span> : null}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
