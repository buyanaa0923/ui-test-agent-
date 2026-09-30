export function Drawer({ onClose }: { onClose: () => void }) {
  return (
    <aside className="drawer">
      <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
    </aside>
  );
}
