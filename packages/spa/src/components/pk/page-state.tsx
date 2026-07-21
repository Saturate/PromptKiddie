import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface PageStateProps {
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  label?: string;
  children: React.ReactNode;
}

export function PageState({ isLoading, isError, refetch, label = "data", children }: PageStateProps) {
  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground font-mono text-sm">Loading...</div>;
  }
  if (isError) {
    return (
      <div className="py-12 text-center space-y-3">
        <p className="text-sm text-destructive font-mono">Failed to load {label}.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono text-xs">
          <RefreshCw className="size-3 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
