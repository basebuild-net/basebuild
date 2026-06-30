type TopBarProps = {
  title: string;
  status?: string;
};

export function TopBar({ title, status }: TopBarProps) {
  return (
    <header className="top-bar">
      <h1>{title}</h1>
      {status ? <span className="status-pill" title={status}>{status}</span> : null}
    </header>
  );
}
