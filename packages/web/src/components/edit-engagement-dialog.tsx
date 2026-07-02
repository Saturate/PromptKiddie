"use client";

import { useState } from "react";
import { updateEngagementAction } from "@/app/engagements/[id]/actions";
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

interface EditEngagementDialogProps {
  engagement: {
    id: string;
    name: string;
    type: string;
    group?: string | null;
    sourceUrl?: string | null;
    scope?: string | null;
    brief?: string | null;
  };
}

export function EditEngagementDialog({ engagement }: EditEngagementDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="font-mono gap-1.5" />}>
        <PencilIcon className="size-3.5" data-icon="inline-start" />
        Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">Edit Engagement</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Update the engagement details.
          </DialogDescription>
        </DialogHeader>
        <form
          action={async (formData: FormData) => {
            await updateEngagementAction(engagement.id, formData);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="edit-name" className="font-mono text-xs">
              Name
            </Label>
            <Input
              id="edit-name"
              name="name"
              defaultValue={engagement.name}
              placeholder="e.g. HTB: Sherlock"
              required
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-type" className="font-mono text-xs">
              Type
            </Label>
            <select
              id="edit-type"
              name="type"
              defaultValue={engagement.type}
              required
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="ctf">CTF</option>
              <option value="whitebox">Whitebox</option>
              <option value="blackbox">Blackbox</option>
              <option value="bugbounty">Bug Bounty</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-group" className="font-mono text-xs">
              Group <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="edit-group"
              name="group"
              defaultValue={engagement.group ?? ""}
              placeholder="e.g. HTB, THM, Internal"
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-sourceUrl" className="font-mono text-xs">
              Source URL <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="edit-sourceUrl"
              name="sourceUrl"
              defaultValue={engagement.sourceUrl ?? ""}
              placeholder="e.g. https://tryhackme.com/room/neighbour"
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-scope" className="font-mono text-xs">
              Scope <span className="text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="edit-scope"
              name="scope"
              defaultValue={engagement.scope ?? ""}
              placeholder="Free-form scope summary"
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-brief" className="font-mono text-xs">
              Brief <span className="text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="edit-brief"
              name="brief"
              defaultValue={engagement.brief ?? ""}
              placeholder="Room description / task brief"
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          <DialogFooter>
            <Button type="submit" className="font-mono text-sm">
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
