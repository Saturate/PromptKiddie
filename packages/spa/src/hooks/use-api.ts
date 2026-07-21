import { useQuery } from "@tanstack/react-query";
import {
  fetchEngagements, fetchEngagement, fetchTargets, fetchFindings,
  fetchActivity, fetchEvidence, fetchObjectives,
} from "@/api/client";

export function useApiHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("API unreachable");
      return res.json() as Promise<{ ok: boolean }>;
    },
    refetchInterval: 15_000,
    retry: false,
    staleTime: 10_000,
  });
}

export function useEngagements() {
  return useQuery({
    queryKey: ["engagements"],
    queryFn: () => fetchEngagements(),
  });
}

export function useEngagement(id: string | undefined) {
  return useQuery({
    queryKey: ["engagement", id],
    queryFn: () => fetchEngagement(id!),
    enabled: !!id,
  });
}

export function useTargets(engagementId: string | undefined) {
  return useQuery({
    queryKey: ["targets", engagementId],
    queryFn: () => fetchTargets(engagementId!),
    enabled: !!engagementId,
  });
}

export function useFindings(engagementId: string | undefined) {
  return useQuery({
    queryKey: ["findings", engagementId],
    queryFn: () => fetchFindings(engagementId!),
    enabled: !!engagementId,
  });
}

export function useActivity(engagementId: string | undefined) {
  return useQuery({
    queryKey: ["activity", engagementId],
    queryFn: () => fetchActivity(engagementId!),
    enabled: !!engagementId,
  });
}

export function useEvidence(engagementId: string | undefined) {
  return useQuery({
    queryKey: ["evidence", engagementId],
    queryFn: () => fetchEvidence(engagementId!),
    enabled: !!engagementId,
  });
}

export function useObjectives(engagementId: string | undefined) {
  return useQuery({
    queryKey: ["objectives", engagementId],
    queryFn: () => fetchObjectives(engagementId!),
    enabled: !!engagementId,
  });
}
