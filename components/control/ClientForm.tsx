"use client";

import { useActionState } from "react";
import {
  createClientAction,
  updateClientAction,
  type PartnerActionState,
} from "@/lib/actions/partner-actions";
import { ErrorMessage } from "./StatusMessage";

type ClientValues = {
  id?: string;
  restaurantName?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
};

export default function ClientForm({ client }: { client?: ClientValues }) {
  const isEdit = Boolean(client?.id);
  const [state, action, pending] = useActionState<PartnerActionState, FormData>(
    isEdit ? updateClientAction : createClientAction,
    {},
  );

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {isEdit && <input type="hidden" name="id" value={client!.id} />}
      <input
        name="restaurantName"
        required
        defaultValue={client?.restaurantName ?? ""}
        placeholder="Restaurant / café name"
        aria-label="Restaurant name"
        className="input-primary sm:col-span-2"
      />
      <input
        name="contactName"
        defaultValue={client?.contactName ?? ""}
        placeholder="Contact person"
        aria-label="Contact person"
        className="input-primary"
      />
      <input
        name="email"
        type="email"
        defaultValue={client?.email ?? ""}
        placeholder="Contact email"
        aria-label="Contact email"
        className="input-primary"
      />
      <input
        name="phone"
        defaultValue={client?.phone ?? ""}
        placeholder="Phone"
        aria-label="Phone"
        className="input-primary"
      />
      <input
        name="city"
        defaultValue={client?.city ?? ""}
        placeholder="City"
        aria-label="City"
        className="input-primary"
      />
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add client"}
        </button>
        {state.ok && isEdit && (
          <span className="font-label text-craft-success-text dark:text-craft-success">Saved.</span>
        )}
        <ErrorMessage>{state.error}</ErrorMessage>
      </div>
    </form>
  );
}
