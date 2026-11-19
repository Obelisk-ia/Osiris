export function SectionRule({
  roman,
  label,
  page,
}: {
  roman: string;
  label: string;
  page: string;
}) {
  return (
    <div className="section-rule">
      <span className="roman" aria-hidden="true">{roman}.</span>
      <span className="section-label">{label}</span>
      <span className="section-page" aria-hidden="true">{page}</span>
    </div>
  );
}
