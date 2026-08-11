import { NextResponse } from "next/server";
import { runFullAssetSync } from "@/lib/assets/sync-job";

export async function POST(request: Request) {
  const secret = process.env.ASSET_SYNC_CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Asset sync cron is not configured." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runFullAssetSync("cron");
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
