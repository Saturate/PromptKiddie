"use server";

import { updateEngagement } from "@promptkiddie/core";
import { revalidatePath } from "next/cache";

export async function updateEngagementAction(engagementId: string, formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const type = formData.get("type") as string;
  if (!name || !type) return;

  await updateEngagement(engagementId, {
    name,
    type: type as "ctf" | "whitebox" | "blackbox" | "bugbounty",
    scope: ((formData.get("scope") as string) ?? "").trim(),
    brief: ((formData.get("brief") as string) ?? "").trim(),
    sourceUrl: ((formData.get("sourceUrl") as string) ?? "").trim(),
    group: ((formData.get("group") as string) ?? "").trim(),
  });
  revalidatePath(`/engagements/${engagementId}`);
}
