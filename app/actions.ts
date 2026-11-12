"use server";
/**
 * PURPOSE
 * Inbox-level server actions.
 * - syncFromPayPal: the manual ingest path ("Sync from PayPal" button). Lists the merchant's
 *   disputes and refreshes each from the Disputes API. READ-ONLY toward PayPal.
 * Errors are returned as messages (shown in the UI), not swallowed.
 */
import { revalidatePath } from "next/cache";
import { syncAllDisputes } from "@/lib/disputes";

export type ActionState = { ok: boolean; message: string } | null;

export async function syncFromPayPal(_prev: ActionState): Promise<ActionState> {
  try {
    const n = await syncAllDisputes();
    revalidatePath("/");
    return { ok: true, message: `Synced ${n} dispute${n === 1 ? "" : "s"} from PayPal` };
  } catch (e) {
    return { ok: false, message: (e as Error).message.slice(0, 300) };
  }
}
