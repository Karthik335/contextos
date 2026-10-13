/** The flowing pastel background: five blurred blobs drifting slowly into each other. */
export default function Background({ calm = false }: { calm?: boolean }) {
  return (
    <div className={`bg-flow ${calm ? "bg-calm" : ""}`} aria-hidden>
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div className="blob b4" />
      <div className="blob b5" />
    </div>
  );
}
