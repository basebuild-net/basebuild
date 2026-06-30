import type { ActivityId, ActivityItem } from "../../state/activity";

type ActivityRailProps = {
  active: ActivityId;
  items: ActivityItem[];
  onSelect: (activity: ActivityId) => void;
};

export function ActivityRail({ active, items, onSelect }: ActivityRailProps) {
  return (
    <aside className="activity-rail" aria-label="Primary navigation">
      <div className="brand-mark">B</div>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            className={`activity-button${isActive ? " is-active" : ""}`}
            type="button"
            title={item.label}
            aria-label={item.label}
            onClick={() => onSelect(item.id)}
          >
            <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
            {item.badge ? <span className="activity-badge">{item.badge}</span> : null}
          </button>
        );
      })}
    </aside>
  );
}
