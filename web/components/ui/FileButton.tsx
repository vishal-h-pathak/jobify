import type { ChangeEvent } from "react";
import { BUTTON_VARIANT_CLASSES } from "./Button";

interface FileButtonProps {
  id: string;
  fileName: string | null;
  onFileChange: (file: File) => void;
  accept?: string;
  label?: string;
}

/**
 * Hides the native file input behind a secondary-styled label — clicking (or
 * tabbing to + activating) the label opens the picker without any JS ref/click
 * plumbing, so this stays a plain controlled component like Input/TextArea.
 */
export function FileButton({ id, fileName, onFileChange, accept, label = "Choose file" }: FileButtonProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileChange(file);
  }

  return (
    <div className="flex items-center gap-3">
      <input id={id} type="file" accept={accept} onChange={handleChange} className="sr-only" />
      <label
        htmlFor={id}
        className={`inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${BUTTON_VARIANT_CLASSES.secondary}`}
      >
        {fileName ?? label}
      </label>
    </div>
  );
}
