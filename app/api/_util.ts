// Shared helpers for the JSON API route handlers.
import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/service";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

// Map service/validation errors to 400, anything else to 500.
export function fail(err: unknown) {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}
