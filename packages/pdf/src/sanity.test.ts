import { describe, it, expect } from "vitest";
import { PDF_PACKAGE_NAME } from "./index";

describe("@taleweaver/pdf scaffolding", () => {
  it("exports the package marker", () => {
    expect(PDF_PACKAGE_NAME).toBe("@taleweaver/pdf");
  });
});
