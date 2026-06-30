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
      {items.map((item) => (
        <button
          key={item.id}
          className={`activity-button${item.id === active ? " is-active" : ""}`}
          type="button"
          onClick={() => onSelect(item.id)}
        >
          <span>{item.label}</span>
          {item.badge ? <span className="activity-badge">{item.badge}</span> : null}
        </button>
      ))}
    </aside>
  );
}
