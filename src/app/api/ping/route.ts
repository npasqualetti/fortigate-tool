import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { pingHosts } from "@/lib/ping";
import type { AppRole } from "@/lib/types";

const PING_ROLES: AppRole[] = ["network_admin", "telecom", "fuel"];

type PingTargetInput = {
  id: string;
  ipAddress: string;
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !user.roles.some((role) => PING_ROLES.includes(role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { targets?: PingTargetInput[] };
  try {
    body = (await request.json()) as { targets?: PingTargetInput[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const targets = (body.targets || []).slice(0, 64);
  if (!targets.length) {
    return NextResponse.json({ results: [] });
  }

  const byIp = await pingHosts(targets.map((target) => target.ipAddress));
  const checkedAt = Date.now();

  const results = targets.map((target) => {
    const ping = byIp[target.ipAddress.trim()];
    return {
      id: target.id,
      ipAddress: target.ipAddress,
      reachable: ping?.reachable ?? false,
      latencyMs: ping?.latencyMs ?? null,
      error: ping?.error,
      checkedAt
    };
  });

  return NextResponse.json({ results });
}
