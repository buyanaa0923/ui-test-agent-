type Props = { title: string; body: string };

export function Card({ title, body }: Props) {
  return (
    <div className="card">
      <h3 className="card-title">{title}</h3>
      <p className="card-body">{body}</p>
    </div>
  );
}
