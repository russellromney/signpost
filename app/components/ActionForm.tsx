"use client";

// A thin client wrapper that runs a server action through useActionState so a
// ServiceError surfaces as inline text instead of a thrown error overlay. The
// form's fields are passed as children (server-rendered DOM is fine). Controls
// are disabled while the action is pending.
import { useActionState } from "react";

export interface FormState {
  error?: string;
}

export function ActionForm({
  action,
  children,
  className,
  style,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className} style={style}>
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
        {children}
      </fieldset>
      {state?.error && <p className="error">{state.error}</p>}
    </form>
  );
}
