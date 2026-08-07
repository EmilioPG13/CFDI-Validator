import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  onFile: (file: File) => void;
  /** Shown inline, below the drop area — e.g. "El archivo debe ser un .zip". */
  error?: string | null;
}

/**
 * Drag-and-drop ZIP upload with a real `<input type="file">` underneath a `<label>` — the
 * label makes the whole area clickable AND is the accessibility/no-JS-drag-support
 * fallback the task calls for: a keyboard or screen-reader user (or a touch device with no
 * drag events at all) still gets a native file picker, no drag machinery required.
 */
export function UploadDropzone({ onFile, error }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputId = useId();

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    // Reset so choosing the same file twice in a row (e.g. after fixing a non-.zip error)
    // still fires a change event.
    event.target.value = "";
  }

  return (
    <div>
      <div className="corner-box bg-[var(--paper-raised)]">
        <span className="cb-extra" aria-hidden="true" />
        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-4 border-2 border-dashed px-6 py-16 text-center transition-colors sm:px-10",
            isDragging ? "border-[var(--azul)] bg-[var(--azul)]/5" : "border-[var(--hairline-strong)]",
          )}
        >
          <UploadCloud
            className={cn("size-9", isDragging ? "text-[var(--azul)]" : "text-[var(--ink-faint)]")}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <div>
            <p className="font-display text-lg font-bold leading-snug text-[var(--ink)]">
              Arrastra aquí el ZIP de XML descargado del SAT
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-soft)]">
              o haz clic para elegirlo desde tu computadora
            </p>
          </div>
          <span className="font-mono-data text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            Solo archivos .zip · el análisis corre en tu navegador, nada se sube
          </span>
          <input
            id={inputId}
            type="file"
            accept=".zip"
            className="sr-only"
            onChange={handleChange}
          />
        </label>
      </div>
      {error ? (
        <p className="font-mono-data mt-3 text-[12px] font-semibold text-[var(--rojo)]">{error}</p>
      ) : null}
    </div>
  );
}
