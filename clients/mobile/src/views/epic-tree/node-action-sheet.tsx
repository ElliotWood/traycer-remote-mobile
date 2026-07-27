/**
 * P1 — the row "⋯" action sheet (rename / add-child / delete).
 *
 * Evaluator tighten #3 (destructive-action safety): these are this client's
 * FIRST destructive writes, so Delete is a deliberate TWO-STEP flow — tap
 * "⋯" → tap "Delete" in a plain list (never a lone icon), which opens a
 * SEPARATE confirm sheet with nothing else on it but Cancel/Delete, so a
 * single mis-tap can never delete anything. Cascade count (real descendant
 * count, computed from the already-loaded tree — no extra round-trip) is
 * shown so a parent delete never surprises the user about its children.
 */
import { useState, type ReactElement } from "react";
import { FilePenLine, FolderPlus, Trash2, type LucideIcon } from "lucide-react";
import { Button, radius, theme, type } from "@/views/design-tokens";
import { ROW_MIN_HEIGHT } from "./tree-primitives";

const AddChildIcon = FolderPlus;

export interface NodeActionSheetProps {
  readonly title: string;
  readonly onRename: () => void;
  readonly onAddChild: () => void;
  readonly onDeleteConfirmed: () => void;
  /** Descendants that will ALSO be deleted (0 for a leaf). */
  readonly deleteCascadeCount: number;
  readonly deleting: boolean;
  readonly deleteError: string | null;
  readonly canMutate: boolean;
  readonly onClose: () => void;
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 50,
} as const;

const sheetStyle = {
  width: "100%",
  maxWidth: 480,
  background: theme.surface,
  borderTopLeftRadius: radius.xl,
  borderTopRightRadius: radius.xl,
  border: `1px solid ${theme.borderHairline}`,
  borderBottom: "none",
  padding: 16,
  boxSizing: "border-box" as const,
};

function ActionRow({
  icon: Icon,
  label,
  destructive,
  disabled,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minHeight: 48,
        padding: "0 8px",
        border: "none",
        background: "transparent",
        color: destructive ? theme.danger : theme.text,
        fontSize: 15,
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={18} aria-hidden="true" />
      {label}
    </button>
  );
}

export function NodeActionSheet(props: NodeActionSheetProps): ReactElement {
  const [step, setStep] = useState<"menu" | "confirm-delete">("menu");

  return (
    <div role="dialog" aria-modal="true" style={overlayStyle} onClick={props.onClose}>
      <div style={sheetStyle} onClick={(e) => e.stopPropagation()}>
        <p style={{ ...type.bodySm, color: theme.mutedText, margin: "0 0 8px", padding: "0 8px" }}>
          {props.title}
        </p>

        {step === "menu" ? (
          <MenuStep {...props} onDeleteTapped={() => setStep("confirm-delete")} />
        ) : (
          <ConfirmDeleteStep {...props} onBack={() => setStep("menu")} />
        )}
      </div>
    </div>
  );
}

function MenuStep(
  props: NodeActionSheetProps & { readonly onDeleteTapped: () => void },
): ReactElement {
  return (
    <>
      <RenameRow
        onRename={() => {
          props.onRename();
          props.onClose();
        }}
        canMutate={props.canMutate}
      />
      <ActionRow
        icon={AddChildIcon}
        label="Add child"
        disabled={!props.canMutate}
        onClick={() => {
          props.onAddChild();
          props.onClose();
        }}
      />
      <div style={{ height: 1, background: theme.borderHairline, margin: "8px 0" }} />
      <ActionRow
        icon={Trash2}
        label="Delete"
        destructive
        disabled={!props.canMutate}
        onClick={props.onDeleteTapped}
      />
      <div style={{ height: 8 }} />
      <Button variant="ghost" fullWidth onClick={props.onClose}>
        Cancel
      </Button>
    </>
  );
}

function RenameRow({
  onRename,
  canMutate,
}: {
  readonly onRename: () => void;
  readonly canMutate: boolean;
}): ReactElement {
  return <ActionRow icon={FilePenLine} label="Rename" disabled={!canMutate} onClick={onRename} />;
}

export interface RenamePromptProps {
  readonly initialTitle: string;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onSubmit: (title: string) => void;
  readonly onClose: () => void;
}

/** The inline rename surface opened by the action sheet's "Rename" row. */
export function RenamePrompt({
  initialTitle,
  submitting,
  error,
  onSubmit,
  onClose,
}: RenamePromptProps): ReactElement {
  const [value, setValue] = useState(initialTitle);
  const canSubmit = value.trim().length > 0 && !submitting;

  return (
    <div role="dialog" aria-modal="true" style={overlayStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={(e) => e.stopPropagation()}>
        <p style={{ ...type.titleSm, color: theme.text, margin: "0 0 12px", padding: "0 8px" }}>Rename</p>
        <input
          autoFocus
          value={value}
          disabled={submitting}
          aria-label="Title"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) onSubmit(value);
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            minHeight: ROW_MIN_HEIGHT,
            padding: "0 12px",
            fontSize: 15,
            borderRadius: radius.md,
            border: `1px solid ${theme.border}`,
            background: theme.background,
            color: theme.text,
            marginBottom: 12,
          }}
        />
        {error !== null && (
          <p role="alert" style={{ ...type.bodySm, color: theme.danger, margin: "0 0 12px", padding: "0 8px" }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Button variant="primary" fullWidth disabled={!canSubmit} onClick={() => onSubmit(value)}>
            {submitting ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" fullWidth onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteStep({
  title,
  deleteCascadeCount,
  deleting,
  deleteError,
  onDeleteConfirmed,
  onBack,
  onClose,
}: NodeActionSheetProps & { readonly onBack: () => void }): ReactElement {
  return (
    <>
      <p style={{ ...type.titleSm, color: theme.text, margin: "0 0 8px", padding: "0 8px" }}>
        Delete “{title}”?
      </p>
      {deleteCascadeCount > 0 && (
        <p style={{ ...type.bodySm, color: theme.mutedText, margin: "0 0 12px", padding: "0 8px" }}>
          This will also delete {deleteCascadeCount} nested item{deleteCascadeCount === 1 ? "" : "s"}.
        </p>
      )}
      {deleteError !== null && (
        <p role="alert" style={{ ...type.bodySm, color: theme.danger, margin: "0 0 12px", padding: "0 8px" }}>
          {deleteError}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <Button variant="secondary" fullWidth onClick={onBack} disabled={deleting}>
          Cancel
        </Button>
        <Button variant="destructive" fullWidth onClick={onDeleteConfirmed} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </div>
      <div style={{ height: 4 }} />
      <button
        type="button"
        onClick={onClose}
        style={{
          width: "100%",
          minHeight: 40,
          marginTop: 8,
          border: "none",
          background: "transparent",
          color: theme.mutedText,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </>
  );
}
