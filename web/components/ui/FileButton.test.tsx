import { describe, expect, it, vi } from "vitest";
import { FileButton } from "./FileButton";

describe("FileButton", () => {
  it("hides the native file input and shows the label when no file is chosen", () => {
    const result = FileButton({ id: "cv-upload", fileName: null, onFileChange: vi.fn() });
    const [input, label] = result.props.children;
    expect(input.type).toBe("input");
    expect(input.props.type).toBe("file");
    expect(input.props.className).toMatch(/sr-only/);
    expect(label.type).toBe("label");
    expect(label.props.htmlFor).toBe("cv-upload");
    expect(label.props.children).toBe("Choose file");
  });

  it("shows the chosen filename once a file is selected", () => {
    const result = FileButton({ id: "cv-upload", fileName: "resume.txt", onFileChange: vi.fn() });
    const [, label] = result.props.children;
    expect(label.props.children).toBe("resume.txt");
  });

  it("forwards the selected file to onFileChange", () => {
    const onFileChange = vi.fn();
    const result = FileButton({ id: "cv-upload", fileName: null, onFileChange });
    const [input] = result.props.children;
    const file = new File(["hello"], "resume.txt");
    input.props.onChange({ target: { files: [file] } });
    expect(onFileChange).toHaveBeenCalledWith(file);
  });
});
