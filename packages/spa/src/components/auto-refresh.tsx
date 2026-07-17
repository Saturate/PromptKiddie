import { useEffect } from "react";

export function AutoRefresh({ interval = 5000, onRefresh }: { interval?: number; onRefresh: () => void }) {
  useEffect(() => {
    const id = setInterval(onRefresh, interval);
    return () => clearInterval(id);
  }, [onRefresh, interval]);

  return null;
}
