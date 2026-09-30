export default function Promo({ label }: { label: string }) {
  return (
    <section className="promo">
      <span className="text-[11px] font-medium uppercase tracking-widest">{label}</span>
    </section>
  );
}
