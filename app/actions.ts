"use server";

// Server actions behind the owner console. Each returns a FormState so the UI
// can render validation/state errors inline (via <ActionForm>) instead of
// throwing. The console is a trusted god-mode client: it calls the service layer
// directly and acts as whichever identity the step belongs to. Agents use /v1.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/app/components/ActionForm";
import { AuthzError } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { autoScreen } from "@/lib/policy";
import {
  askGate,
  closeWithReceipt,
  createRequest,
  decide,
  markReadyForRelease,
  postUpdate,
  rejectRelease,
  release,
  resolveCheck,
  respondToInfo,
  ServiceError,
  startSession,
} from "@/lib/service";
import type { GateDecisionKind, ReceiptStatus } from "@/lib/types";

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

// Turn an expected service error into inline form state; rethrow anything else
// (including Next's redirect control-flow signal).
function fail(err: unknown): FormState {
  if (err instanceof ServiceError || err instanceof AuthzError) return { error: err.message };
  throw err;
}

function refresh(requestId: string) {
  revalidatePath("/");
  revalidatePath("/owner");
  revalidatePath(`/requests/${requestId}`);
}

export async function createRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const db = getDb();
  let id: string;
  try {
    id = createRequest(db, {
      from_id: str(formData.get("from_id")),
      to_id: str(formData.get("to_id")),
      goal: str(formData.get("goal")),
      definition_of_done: lines(formData.get("definition_of_done")),
      constraints: lines(formData.get("constraints")),
      context: lines(formData.get("context")),
      deadline: str(formData.get("deadline")) || null,
    });
    // Run the request-time gate: policy auto-decides, or leaves it for a human.
    autoScreen(db, id);
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/");
  redirect(`/requests/${id}`);
}

export async function decideAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  try {
    decide(getDb(), requestId, {
      decision: str(formData.get("decision")) as GateDecisionKind,
      limits: lines(formData.get("limits")),
      reason: lines(formData.get("reason")),
    });
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}

export async function respondInfoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  try {
    respondToInfo(getDb(), requestId, lines(formData.get("answers")));
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}

export async function startSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  try {
    startSession(getDb(), requestId);
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}

export async function postUpdateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  const summary = str(formData.get("summary"));
  try {
    // A risky step routes through the execution-time gate instead of a plain note.
    if (formData.get("requires_gate") === "on") askGate(getDb(), requestId, summary);
    else postUpdate(getDb(), requestId, summary);
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}

export async function resolveCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  try {
    resolveCheck(getDb(), requestId, str(formData.get("decision")) !== "deny", lines(formData.get("reason")));
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}

export async function markReadyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  try {
    markReadyForRelease(getDb(), requestId, str(formData.get("summary")));
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}

export async function releaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  try {
    release(getDb(), requestId);
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}

export async function rejectReleaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  try {
    rejectRelease(getDb(), requestId, str(formData.get("reason")));
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}

export async function closeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const requestId = str(formData.get("request_id"));
  try {
    closeWithReceipt(getDb(), requestId, {
      status: (str(formData.get("status")) as ReceiptStatus) || "completed",
      artifacts: lines(formData.get("artifacts")),
      evidence: lines(formData.get("evidence")),
      assumptions: lines(formData.get("assumptions")),
    });
  } catch (err) {
    return fail(err);
  }
  refresh(requestId);
  return {};
}
