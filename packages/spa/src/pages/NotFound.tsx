import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4">
      <div className="font-mono text-6xl font-bold text-muted-foreground/20">404</div>
      <p className="font-mono text-sm text-muted-foreground">Page not found.</p>
      <Link to="/" className="font-mono text-xs text-pk-amber hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
