"use server";

import { sendMessage, updateEngagement } from "@promptkiddie/core";
import { revalidatePath } from "next/cache";

export async function sendInboxMessage(engagementId: string, body: string) {
  await sendMessage({
    body,
    engagementId,
    direction: "inbound",
    author: "human",
  });
  revalidatePath(`/engagements/${engagementId}`);
}

export async function updateEngagementAction(engagementId: string, formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const type = formData.get("type") as string;
  if (!name || !type) return;

  // Optional fields pass the trimmed value (including "") so edits can clear them;
  // undefined would tell drizzle to leave the column unchanged.
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
