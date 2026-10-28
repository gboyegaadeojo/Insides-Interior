import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import { BulletList, ListItem } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Bold as BoldIcon, List } from "lucide-react";
import * as React from "react";
import { sanitizeRichText } from "~/lib/rich-text";
import { cn } from "~/lib/utils";

/**
 * RichTextLine (SPEC 6.11): Tiptap with bold and bullets only. The output is
 * sanitised again on the server (SPEC 11.1).
 */
export function RichTextField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = React.useId();
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [Document, Paragraph, Text, Bold, BulletList, ListItem, UndoRedo],
    content: value || "",
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": `${id}-label`,
        class:
          "min-h-20 rounded-b-control border border-t-0 border-tertiary bg-surface px-3.5 py-2.5 text-body outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-teal-base [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold",
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
    onUpdate({ editor: e }) {
      const html = e.isEmpty ? "" : sanitizeRichText(e.getHTML());
      onChangeRef.current(html);
    },
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      bullets: e?.isActive("bulletList") ?? false,
    }),
  });

  const toolButton =
    "inline-flex size-11 items-center justify-center rounded-control text-secondary hover:bg-surface-3 aria-pressed:bg-teal-tint aria-pressed:text-teal-ink";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={`${id}-label`} className="text-label font-semibold">
        {label}
      </span>
      <div
        role="toolbar"
        aria-label={`${label} formatting`}
        className="flex gap-1 rounded-t-control border border-tertiary bg-surface-2 p-0.5"
      >
        <button
          type="button"
          className={toolButton}
          aria-pressed={state?.bold ?? false}
          aria-label="Bold"
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <BoldIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={toolButton}
          aria-pressed={state?.bullets ?? false}
          aria-label="Bullet list"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" aria-hidden />
        </button>
      </div>
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div
          className="min-h-20 rounded-b-control border border-t-0 border-tertiary bg-surface px-3.5 py-2.5 text-secondary"
          aria-hidden
        >
          {placeholder}
        </div>
      )}
    </div>
  );
}
