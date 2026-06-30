type TopBarProps = {
  title: string;
  eyebrow?: string;
  status?: string;
};

export function TopBar({ title, eyebrow = "Basebuild", status }: TopBarProps) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {status ? <span className="status-pill">{status}</span> : null}
    </header>
  );
}
