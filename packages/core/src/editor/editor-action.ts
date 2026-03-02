import type { Selection } from "../cursor/selection";

export type EditorAction =
  | { type: "INSERT_TEXT"; text: string }
  | { type: "DELETE_BACKWARD" }
  | { type: "SPLIT_NODE" }
  | { type: "MOVE_CURSOR"; direction: "forward" | "backward" }
  | { type: "MOVE_WORD"; direction: "forward" | "backward" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_CONTAINER_WIDTH"; width: number }
  | { type: "SET_SELECTION"; selection: Selection }
  | { type: "EXPAND_SELECTION"; direction: "forward" | "backward" }
  | { type: "EXPAND_WORD"; direction: "forward" | "backward" }
  | { type: "DELETE_FORWARD" }
  | { type: "MOVE_LINE"; direction: "up" | "down" }
  | { type: "EXPAND_LINE"; direction: "up" | "down" }
  | { type: "TOGGLE_STYLE"; style: "bold" | "italic" | "underline" }
  | { type: "PASTE"; text: string }
  | { type: "SET_BLOCK_TYPE"; blockType: string; properties?: Record<string, unknown> }
  | { type: "TOGGLE_LIST"; listType: "ordered" | "unordered" }
  | { type: "MOVE_LINE_BOUNDARY"; boundary: "start" | "end" }
  | { type: "EXPAND_LINE_BOUNDARY"; boundary: "start" | "end" }
  | { type: "MOVE_DOCUMENT_BOUNDARY"; boundary: "start" | "end" }
  | { type: "EXPAND_DOCUMENT_BOUNDARY"; boundary: "start" | "end" }
  | { type: "SELECT_ALL" }
  | { type: "DELETE_WORD"; direction: "forward" | "backward" }
  | { type: "DELETE_LINE" }
  | { type: "INSERT_BLOCK"; blockType: string; properties?: Record<string, unknown> }
  | { type: "INSERT_TABLE"; rows: number; columns: number; columnWidths?: number[] };
