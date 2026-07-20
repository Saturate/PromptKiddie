export default function Chat() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-2">
      <p className="text-sm font-mono text-muted-foreground">
        Chat is available from any page.
      </p>
      <p className="text-xs font-mono text-muted-foreground/50">
        Click the chat button in the bottom-right corner to get started.
      </p>
    </div>
  );
}
