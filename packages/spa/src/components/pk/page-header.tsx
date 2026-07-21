export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <h1 className="text-xl font-bold font-mono">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground font-mono">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
