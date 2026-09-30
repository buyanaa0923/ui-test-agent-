export default function Hero({ label }: { label: string }) {
  return (
    <section className="hero">
      <span className="text-[11px] font-medium uppercase tracking-widest">{label}</span>
    </section>
  );
}
