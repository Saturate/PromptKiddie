import { useState } from "react";
import { updateEngagement } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PencilIcon } from "lucide-react";

interface Props {
  engagement: { id: string; name: string; type: string; group?: string | null; sourceUrl?: string | null; scope?: string | null; brief?: string | null };
  onUpdated?: () => void;
}

export function EditEngagementDialog({ engagement, onUpdated }: Props) {
  const [open, setOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await updateEngagement(engagement.id, {
      name: fd.get("name") as string,
      type: fd.get("type") as string,
      group: (fd.get("group") as string) || undefined,
      sourceUrl: (fd.get("sourceUrl") as string) || undefined,
      scope: (fd.get("scope") as string) || undefined,
      brief: (fd.get("brief") as string) || undefined,
    });
    setOpen(false);
    onUpdated?.();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="font-mono gap-1.5" />}>
        <PencilIcon className="size-3.5" />
        Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">Edit Engagement</DialogTitle>
          <DialogDescription className="font-mono text-xs">Update engagement details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name" className="font-mono text-xs">Name</Label>
            <Input id="edit-name" name="name" defaultValue={engagement.name} required autoComplete="off" className="font-mono text-sm" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-type" className="font-mono text-xs">Type</Label>
            <select id="edit-type" name="type" defaultValue={engagement.type} required className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-xs">
              <option value="ctf">CTF</option>
              <option value="whitebox">Whitebox</option>
              <option value="blackbox">Blackbox</option>
              <option value="bugbounty">Bug Bounty</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-scope" className="font-mono text-xs">Scope <span className="text-muted-foreground">(optional)</span></Label>
            <textarea id="edit-scope" name="scope" defaultValue={engagement.scope ?? ""} rows={2} className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none" />
          </div>
          <DialogFooter>
            <Button type="submit" className="font-mono text-sm">Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
