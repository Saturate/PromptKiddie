"use server";

import { sendMessage } from "@promptkiddie/core";
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
