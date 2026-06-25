"use server";

import { createEngagement } from "@promptkiddie/core";
import { redirect } from "next/navigation";

export async function createEngagementAction(formData: FormData) {
  const name = formData.get("name") as string;
  const type = formData.get("type") as string;
  const group = formData.get("group") as string;
  const scope = formData.get("scope") as string;
  if (!name?.trim() || !type) return;

  const row = await createEngagement({
    name: name.trim(),
    type: type as "ctf" | "whitebox" | "blackbox" | "bugbounty",
    group: group?.trim() || undefined,
    scope: scope?.trim() || undefined,
  });

  redirect(`/engagements/${row.id}`);
}
