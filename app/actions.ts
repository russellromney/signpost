"use server";

// Server actions that back the manual buttons in the UI. Each one reads a
// FormData, calls the service layer, and revalidates the affected pages.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/lib/db";
import {
  closeWithReceipt,
  createRequest,
  decide,
  markReadyForRelease,
  postUpdate,
  rejectRelease,
  release,
  startSession,
} from "@/lib/service";
import type { GateDecisionKind, ReceiptStatus } from "@/lib/types";

// Split a textarea into a list of trimmed, non-empty lines.
function lines(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function str(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function refresh(requestId: string) {
  revalidatePath("/");
  revalidatePath(`/requests/${requestId}`);
}

export async function createRequestAction(formData: FormData) {
  const id = createRequest(getDb(), {
    from_id: str(formData.get("from_id")),
    to_id: str(formData.get("to_id")),
    goal: str(formData.get("goal")),
    definition_of_done: lines(formData.get("definition_of_done")),
    constraints: lines(formData.get("constraints")),
    context: lines(formData.get("context")),
    deadline: str(formData.get("deadline")) || null,
  });
  revalidatePath("/");
  redirect(`/requests/${id}`);
}

export async function decideAction(formData: FormData) {
  const requestId = str(formData.get("request_id"));
  decide(getDb(), requestId, {
    decision: str(formData.get("decision")) as GateDecisionKind,
    limits: lines(formData.get("limits")),
    reason: lines(formData.get("reason")),
  });
  refresh(requestId);
}

export async function startSessionAction(formData: FormData) {
  const requestId = str(formData.get("request_id"));
  startSession(getDb(), requestId);
  refresh(requestId);
}

export async function postUpdateAction(formData: FormData) {
  const requestId = str(formData.get("request_id"));
  postUpdate(
    getDb(),
    requestId,
    str(formData.get("summary")),
    formData.get("requires_gate") === "on",
  );
  refresh(requestId);
}

export async function markReadyAction(formData: FormData) {
  const requestId = str(formData.get("request_id"));
  markReadyForRelease(getDb(), requestId, str(formData.get("summary")));
  refresh(requestId);
}

export async function releaseAction(formData: FormData) {
  const requestId = str(formData.get("request_id"));
  release(getDb(), requestId);
  refresh(requestId);
}

export async function rejectReleaseAction(formData: FormData) {
  const requestId = str(formData.get("request_id"));
  rejectRelease(getDb(), requestId, str(formData.get("reason")));
  refresh(requestId);
}

export async function closeAction(formData: FormData) {
  const requestId = str(formData.get("request_id"));
  closeWithReceipt(getDb(), requestId, {
    status: (str(formData.get("status")) as ReceiptStatus) || "completed",
    artifacts: lines(formData.get("artifacts")),
    evidence: lines(formData.get("evidence")),
    assumptions: lines(formData.get("assumptions")),
  });
  refresh(requestId);
}
