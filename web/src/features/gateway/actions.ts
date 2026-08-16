"use server";

import { auth } from "@/auth";
import { getDatabase } from "@/db";
import { requireSeller } from "@/lib/dal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { loadMasterKeyConfig } from "./env";
import { newPublicId } from "./endpoint";
import {
  changeEndpointPayout,
  changeEndpointPrice,
  createEndpointDraft,
  hasRecentSignIn,
  replaceEndpointCredential,
  ServiceError,
  setEndpointStatus,
  updateEndpointDraft,
  type ServiceAuth,
} from "./service";
import type { EndpointStatus } from "./repository";

export interface ActionState {
  readonly error?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

async function currentAuth(): Promise<ServiceAuth> {
  const session = await auth();
  const db = getDatabase();
  const seller = await requireSeller(db.db, session);
  return { sellerId: seller.id, db: db.db };
}

function vaultKeyRing() {
  const config = loadMasterKeyConfig(process.env);
  return config.ring;
}

function fieldError(error: unknown): ActionState {
  if (error instanceof ServiceError) {
    if (error.field !== null) {
      return { fieldErrors: { [error.field]: error.message } };
    }
    return { error: error.message };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "An unexpected error occurred" };
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createEndpointAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await currentAuth();
  const credential = readString(formData, "credential");
  try {
    const summary = await createEndpointDraft(
      auth,
      {
        displayName: readString(formData, "displayName"),
        upstreamUrl: readString(formData, "upstreamUrl"),
        authMode: readString(formData, "authMode"),
        price: readString(formData, "price"),
        payTo: readString(formData, "payTo"),
        ...(credential !== "" ? { credential } : {}),
      },
      newPublicId(),
      vaultKeyRing(),
    );
    redirect(`/dashboard/${summary.id}`);
  } catch (error) {
    return fieldError(error);
  }
}

export async function updateEndpointAction(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await currentAuth();
  const endpointId = readString(formData, "endpointId");
  const credential = readString(formData, "credential");
  try {
    await updateEndpointDraft(
      auth,
      {
        endpointId,
        displayName: readString(formData, "displayName"),
        upstreamUrl: readString(formData, "upstreamUrl"),
        authMode: readString(formData, "authMode"),
        price: readString(formData, "price"),
        payTo: readString(formData, "payTo"),
        ...(credential !== "" ? { credential } : {}),
      },
      vaultKeyRing(),
    );
  } catch (error) {
    return fieldError(error);
  }
  revalidatePath(`/dashboard/${endpointId}`);
  return {};
}

export async function setStatusAction(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await currentAuth();
  const endpointId = readString(formData, "endpointId");
  const status = readString(formData, "status") as EndpointStatus;
  try {
    await setEndpointStatus(auth, endpointId, status);
  } catch (error) {
    if (error instanceof ServiceError) {
      return {
        error:
          error.message === "Endpoint not found"
            ? error.message
            : "Secret is required before this endpoint can be activated",
      };
    }
    return fieldError(error);
  }
  revalidatePath(`/dashboard/${endpointId}`);
  revalidatePath("/dashboard");
  return {};
}

export async function replaceCredentialAction(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await currentAuth();
  const endpointId = readString(formData, "endpointId");
  const credential = readString(formData, "credential");
  try {
    if (credential.trim() === "") {
      throw new ServiceError("Upstream secret cannot be blank", "credential");
    }
    await replaceEndpointCredential(auth, endpointId, credential, vaultKeyRing());
  } catch (error) {
    return fieldError(error);
  }
  revalidatePath(`/dashboard/${endpointId}`);
  return {};
}

export async function changePayoutAction(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await currentAuth();
  const endpointId = readString(formData, "endpointId");
  const payTo = readString(formData, "payTo");
  try {
    const recentAuth = await hasRecentSignIn(auth);
    await changeEndpointPayout(auth, endpointId, payTo, recentAuth);
  } catch (error) {
    return fieldError(error);
  }
  revalidatePath(`/dashboard/${endpointId}`);
  return {};
}

export async function changePriceAction(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await currentAuth();
  const endpointId = readString(formData, "endpointId");
  const price = readString(formData, "price");
  try {
    const recentAuth = await hasRecentSignIn(auth);
    await changeEndpointPrice(auth, endpointId, price, recentAuth);
  } catch (error) {
    return fieldError(error);
  }
  revalidatePath(`/dashboard/${endpointId}`);
  return {};
}