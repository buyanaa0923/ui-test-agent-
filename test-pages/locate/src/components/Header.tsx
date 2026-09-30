export function Header({ onClose }: { onClose: () => void }) {
  return (
    <header className="app-header">
      <span className="brand">Acme</span>
      <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
    </header>
  );
}
