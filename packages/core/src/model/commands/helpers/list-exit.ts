import type { Block } from "../../block";
import type { Plan } from "../../plan";
import type { ModelSelection } from "../../position/model-position";
import type { ParagraphLayout } from "../../position/paragraph-layout";
import type { Scalar } from "../../storage/scalar";
import type { CommandContext } from "../command-context";
import { plan } from "./build-plan";
import { keysWrite } from "./writes";

/** Exit a list (Enter on an empty item, Backspace at an item's start): outdent one level, or at level 0 become a paragraph. */
export function listExit(ctx: CommandContext, L: ParagraphLayout, sel: ModelSelection): Plan | null {
  if (L.mark === null) return null;
  const raw = L.block.attrs["listLevel"];
  const level = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
  const keys: Record<string, Scalar | undefined> =
    level > 0 ? { "p:listLevel": level - 1 } : { "p:type": undefined, "p:listId": undefined, "p:listLevel": undefined, "p:listCounterOverride": undefined };
  return plan(ctx.version, keysWrite(L.mark, keys), () => sel);
}

export const isListItem = (b: Block): boolean => b.type === "list-item";
