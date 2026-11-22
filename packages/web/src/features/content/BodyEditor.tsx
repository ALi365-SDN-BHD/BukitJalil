import {
  BlockNoteSchema,
  createCodeBlockSpec,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultStyleSpecs,
  filterSuggestionItems,
} from "@blocknote/core";
import { en, zh } from "@blocknote/core/locales";
import {
  AddBlockButton,
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  DragHandleButton,
  DragHandleMenu,
  FileCaptionButton,
  FileDeleteButton,
  FileReplaceButton,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useCreateBlockNote,
  useDictionary,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { CONTENT_CODE_LANGUAGES, type ContentBlock } from "@bukitjalil/shared";
import "@blocknote/shadcn/style.css";
import { getNonce } from "get-nonce";
import { useEffect, useMemo } from "react";
import { useI18n } from "@/i18n";
import { useDark } from "@/lib/theme";
import { type BlocksProblem, type EditorBlock, fromEditor, toEditor, type Unsaved } from "./blocks";

/**
 * Only the blocks and styles a body save writes (plan 5.6 item 7): no colours, underline, alignment, tables,
 * toggles, files, video or audio. Pasted content of other kinds becomes these blocks.
 */
const { paragraph, bulletListItem, numberedListItem, checkListItem, quote, divider, image } = defaultBlockSpecs;
const { bold, italic, strike, code } = defaultStyleSpecs;
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }),
    bulletListItem,
    numberedListItem,
    checkListItem,
    quote,
    codeBlock: createCodeBlockSpec({
      defaultLanguage: "plain text",
      supportedLanguages: Object.fromEntries(CONTENT_CODE_LANGUAGES.map((l) => [l, { name: l }])),
    }),
    divider,
    image,
  },
  styleSpecs: { bold, italic, strike, code },
});

export type BodyChange = { blocks: ContentBlock[] } | { problem: BlocksProblem; unsaved: Unsaved };

/**
 * The body as Notion-like blocks. It reads `blocks` (or `restore`, a document that could not be saved) once:
 * the column remounts it (by key) to load another body. Every change reports the body as the server's blocks,
 * or why it cannot be saved as it is, with the document to restore it from.
 */
export default function BodyEditor({
  blocks,
  restore,
  editable,
  onLoad,
  onChange,
}: {
  blocks: ContentBlock[];
  restore?: Unsaved | null;
  editable: boolean;
  /** The body is in the editor. */
  onLoad: () => void;
  onChange: (change: BodyChange) => void;
}) {
  const { locale, m } = useI18n();
  const dark = useDark();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the body is read once, when mounted
  const loaded = useMemo(
    () => (restore ? { blocks: restore.doc as never[], images: restore.images } : toEditor(blocks)),
    [],
  );
  const editor = useCreateBlockNote({
    schema,
    dictionary: locale === "zh-CN" ? zh : en,
    initialContent: loaded.blocks.length > 0 ? (loaded.blocks as never) : undefined,
    placeholders: { default: m.content.bodyPlaceholder, emptyDocument: m.content.bodyPlaceholder },
    // The editor's base styles go in a <style> element, which the admin CSP allows only with its nonce.
    _tiptapOptions: { injectNonce: getNonce() },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when mounted
  useEffect(onLoad, []);
  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={dark ? "dark" : "light"}
      formattingToolbar={false}
      sideMenu={false}
      slashMenu={false}
      emojiPicker={false}
      tableHandles={false}
      onChange={() => {
        const doc = editor.document as unknown as EditorBlock[];
        const result = fromEditor(doc, loaded.images);
        onChange("problem" in result ? { ...result, unsaved: { doc, images: loaded.images } } : result);
      }}
      className="min-h-80 rounded-md border py-3"
      data-testid="content-body"
    >
      <FormattingToolbarController formattingToolbar={Toolbar} />
      <SideMenuController sideMenu={BlockSideMenu} />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            // Emoji are typed as text; the picker would load its data.
            getDefaultReactSlashMenuItems(editor).filter((item) => !("key" in item && item.key === "emoji")),
            query,
          )
        }
      />
    </BlockNoteView>
  );
}

function Toolbar() {
  return (
    <FormattingToolbar>
      <BlockTypeSelect key="type" />
      <FileCaptionButton key="caption" />
      <FileReplaceButton key="replace" />
      <FileDeleteButton key="delete" />
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <BasicTextStyleButton basicTextStyle="code" key="code" />
      <CreateLinkButton key="link" />
    </FormattingToolbar>
  );
}

function BlockSideMenu(props: Parameters<typeof SideMenu>[0]) {
  const dict = useDictionary();
  return (
    <SideMenu {...props}>
      <AddBlockButton />
      <DragHandleButton {...props}>
        <DragHandleMenu>
          <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
        </DragHandleMenu>
      </DragHandleButton>
    </SideMenu>
  );
}
