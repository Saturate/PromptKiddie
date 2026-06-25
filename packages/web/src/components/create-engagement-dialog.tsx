"use client";

import { useState } from "react";
import { createEngagementAction } from "@/app/actions";
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
import { CirclePlusIcon } from "lucide-react";

export function CreateEngagementDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="font-mono text-sm gap-1.5" />}>
        <CirclePlusIcon className="h-4 w-4" />
        New Engagement
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">New Engagement</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Create a new security engagement.
          </DialogDescription>
        </DialogHeader>
        <form
          action={async (formData: FormData) => {
            await createEngagementAction(formData);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name" className="font-mono text-xs">
              Name
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. HTB: Sherlock"
              required
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type" className="font-mono text-xs">
              Type
            </Label>
            <select
              id="type"
              name="type"
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
            <Label htmlFor="group" className="font-mono text-xs">
              Group{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="group"
              name="group"
              placeholder="e.g. HTB, THM, Internal"
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scope" className="font-mono text-xs">
              Scope{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="scope"
              name="scope"
              placeholder="Free-form scope summary"
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          <DialogFooter>
            <Button type="submit" className="font-mono text-sm">
              Create Engagement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
