export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2 pl-1">{children}</h2>
  );
}
