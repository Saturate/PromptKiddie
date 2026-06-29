import { listPlaybooks } from "@promptkiddie/core";

export async function GET() {
  const rows = await listPlaybooks();
  return Response.json(rows);
}
