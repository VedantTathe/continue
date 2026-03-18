import {
  AtSymbolIcon,
  LightBulbIcon as LightBulbIconOutline,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import { LightBulbIcon as LightBulbIconSolid } from "@heroicons/react/24/solid";
import { InputModifiers } from "core";
import {
  modelSupportsImages,
  modelSupportsReasoning,
} from "core/llm/autodetect";
import { memo, useContext, useRef, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectUseActiveFile } from "../../redux/selectors";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setHasReasoningEnabled } from "../../redux/slices/sessionSlice";
import { exitEdit } from "../../redux/thunks/edit";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";
import { getMetaKeyLabel, isMetaEquivalentKeyPressed } from "../../util";
import { ToolTip } from "../gui/Tooltip";
import ModelSelect from "../modelSelection/ModelSelect";
import { ModeSelect } from "../ModeSelect";
import { Button } from "../ui";
import { useFontSize } from "../ui/font";
import ContextStatus from "./ContextStatus";
import HoverItem from "./InputToolbar/HoverItem";

export interface ToolbarOptions {
  hideUseCodebase?: boolean;
  hideImageUpload?: boolean;
  hideAddContext?: boolean;
  enterText?: string;
  hideSelectModel?: boolean;
}

interface InputToolbarProps {
  onEnter?: (modifiers: InputModifiers) => void;
  onAddContextItem?: () => void;
  onClick?: () => void;
  onImageFileSelected?: (file: File) => void;
  hidden?: boolean;
  activeKey: string | null;
  toolbarOptions?: ToolbarOptions;
  disabled?: boolean;
  isMainInput?: boolean;
}

function InputToolbar(props: InputToolbarProps) {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const defaultModel = useAppSelector(selectSelectedChatModel);
  const useActiveFile = useAppSelector(selectUseActiveFile);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const codeToEdit = useAppSelector((store) => store.editModeState.codeToEdit);
  const hasReasoningEnabled = useAppSelector(
    (store) => store.session.hasReasoningEnabled,
  );
  const isEnterDisabled =
    props.disabled || (isInEdit && codeToEdit.length === 0);

  const supportsImages =
    defaultModel &&
    modelSupportsImages(
      defaultModel.provider,
      defaultModel.model,
      defaultModel.title,
      defaultModel.capabilities,
    );

  const supportsReasoning = modelSupportsReasoning(defaultModel);

  const smallFont = useFontSize(-2);
  const tinyFont = useFontSize(-3);
  const [isExtracting, setIsExtracting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmLogs, setConfirmLogs] = useState("");
  const PREVIEW_LEN = 5000;

  return (
    <>
      <div
        onClick={props.onClick}
        className={`find-widget-skip bg-vsc-input-background flex select-none flex-row items-center justify-between gap-1 pt-1 ${props.hidden ? "pointer-events-none h-0 cursor-default opacity-0" : "pointer-events-auto mt-2 cursor-text opacity-100"}`}
        style={{
          fontSize: smallFont,
        }}
      >
        <div className="xs:gap-1.5 flex flex-row items-center gap-1">
          {!isInEdit && (
            <ToolTip place="top" content="Select Mode">
              <HoverItem className="!p-0">
                <ModeSelect />
              </HoverItem>
            </ToolTip>
          )}
          <ToolTip place="top" content="Select Model">
            <HoverItem className="!p-0">
              <ModelSelect />
            </HoverItem>
          </ToolTip>
          <div className="xs:flex text-description -mb-1 hidden items-center transition-colors duration-200">
            {props.toolbarOptions?.hideImageUpload ||
              (supportsImages && (
                <>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    accept=".jpg,.jpeg,.png,.gif,.svg,.webp"
                    onChange={(e) => {
                      const files = e.target?.files ?? [];
                      for (const file of files) {
                        props.onImageFileSelected?.(file);
                      }
                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                  />

                  <ToolTip place="top" content="Attach Image">
                    <HoverItem className="">
                      <PhotoIcon
                        className="h-3 w-3 hover:brightness-125"
                        onClick={(e) => {
                          fileInputRef.current?.click();
                        }}
                      />
                    </HoverItem>
                  </ToolTip>
                </>
              ))}
            {props.toolbarOptions?.hideAddContext || (
              <ToolTip place="top" content="Attach Context">
                <HoverItem onClick={props.onAddContextItem}>
                  <AtSymbolIcon className="h-3 w-3 hover:brightness-125" />
                </HoverItem>
              </ToolTip>
            )}
            {supportsReasoning && (
              <HoverItem
                onClick={() =>
                  dispatch(setHasReasoningEnabled(!hasReasoningEnabled))
                }
              >
                <ToolTip
                  place="top"
                  content={
                    hasReasoningEnabled
                      ? "Disable model reasoning"
                      : "Enable model reasoning"
                  }
                >
                  {hasReasoningEnabled ? (
                    <LightBulbIconSolid className="h-3 w-3 brightness-200 hover:brightness-150" />
                  ) : (
                    <LightBulbIconOutline className="h-3 w-3 hover:brightness-150" />
                  )}
                </ToolTip>
              </HoverItem>
            )}
          </div>
        </div>

        <div
          className="text-description flex items-center gap-2 whitespace-nowrap"
          style={{
            fontSize: tinyFont,
          }}
        >
          <ToolTip
            place="top"
            content="Check Deployment and send logs to agent"
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (isExtracting) return;
                setIsExtracting(true);
                try {
                  // Use a hardcoded resource for now (avoid prompting)
                  const resource = "StratosApiFunction";

                  // Try to determine workspace cwd so the CLI writes the file into the workspace
                  const workspaceDirs =
                    await ideMessenger.ide.getWorkspaceDirs();
                  let cwd: string | undefined = undefined;
                  // Prefer the workspace dir that contains the package folder
                  if (workspaceDirs && workspaceDirs.length > 0) {
                    for (const w of workspaceDirs) {
                      try {
                        const uri = new URL(w);
                        let path = decodeURIComponent(uri.pathname || "");
                        if (path.startsWith("/")) path = path.substring(1);
                        const candidateInit = `${w.replace(/\/$/, "")}/standard_commandline_utility/__init__.py`;
                        try {
                          const rawInit = await ideMessenger.request(
                            "readFile",
                            { filepath: candidateInit },
                          );
                          const initContent =
                            rawInit &&
                            typeof rawInit === "object" &&
                            "content" in (rawInit as any)
                              ? (rawInit as any).content
                              : rawInit;
                          if (initContent && String(initContent).length > 0) {
                            cwd = path;
                            break;
                          }
                        } catch (e) {
                          // ignore and continue
                        }
                      } catch (e) {
                        // ignore malformed workspace URI and continue
                      }
                    }

                    // fallback to the first workspace dir if none matched
                    if (!cwd) {
                      try {
                        const uri = new URL(workspaceDirs[0]);
                        let path = decodeURIComponent(uri.pathname || "");
                        if (path.startsWith("/")) path = path.substring(1);
                        cwd = path;
                      } catch (e) {
                        cwd = workspaceDirs[0];
                      }
                    }
                  }

                  const outFileName = "extracted_logs.txt";

                  // Invoke as a module from the workspace root so Python can resolve
                  // the `standard_commandline_utility` package (preferred).
                  const cmd = `python -m standard_commandline_utility.deploy_api ${resource} --window 5m --stream-only --out ${outFileName} --keywords ERROR`;
                  // ensure cwd is the decoded workspace root (set earlier)
                  if (!cwd && workspaceDirs && workspaceDirs.length > 0) {
                    try {
                      const uri = new URL(workspaceDirs[0]);
                      let path = decodeURIComponent(uri.pathname || "");
                      if (path.startsWith("/")) path = path.substring(1);
                      cwd = path;
                    } catch (e) {
                      cwd = workspaceDirs[0];
                    }
                  }

                  // Run the CLI. Some IDE implementations return a wrapper { status, content }.
                  const rawRes = await ideMessenger.request("subprocess", {
                    command: cmd,
                    cwd,
                  });

                  // Unwrap webview response wrapper if present
                  const unwrap = (r: any) => {
                    if (r && typeof r === "object" && "status" in r) {
                      if (r.status === "error") {
                        throw new Error(r.error || "subprocess error");
                      }
                      return r.content;
                    }
                    return r;
                  };

                  const res = unwrap(rawRes);

                  // Prefer reading the file the CLI wrote in the workspace, but fall back to subprocess stdout
                  let stdout = Array.isArray(res)
                    ? res[0] || ""
                    : String(res || "");
                  let stderr = Array.isArray(res) ? res[1] || "" : "";
                  let fileContent = "";
                  try {
                    if (workspaceDirs && workspaceDirs.length > 0) {
                      const fileUri =
                        workspaceDirs[0].replace(/\/$/, "") + "/" + outFileName;
                      const rawFileRes = await ideMessenger.request(
                        "readFile",
                        {
                          filepath: fileUri,
                        },
                      );
                      const fileRes = unwrap(rawFileRes);
                      fileContent = String(fileRes ?? "");
                    }
                  } catch (e) {
                    // readFile may fail or return truncated/empty content; we'll use stdout as a fallback
                    fileContent = "";
                  }

                  const logs =
                    fileContent && fileContent.length > 0
                      ? fileContent
                      : stdout;

                  // If fileContent empty and stderr contains errors, include stderr in preview for debugging
                  let preview = logs;
                  if (
                    (!fileContent || fileContent.length === 0) &&
                    stderr &&
                    stderr.length > 0
                  ) {
                    preview = `${logs}\n\n--- STDERR ---\n${stderr}`;
                  }

                  // Show confirmation modal with truncated preview. User must confirm to submit.
                  setConfirmLogs(preview);
                  setShowConfirm(true);
                } catch (e) {
                  console.error("Check Deployment failed:", e);
                } finally {
                  setIsExtracting(false);
                }
              }}
              disabled={isEnterDisabled || isExtracting}
            >
              {isExtracting ? "Checking..." : "Check Deployment"}
            </Button>
          </ToolTip>
          {showConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black opacity-40" />
              <div className="relative w-11/12 max-w-3xl rounded bg-white p-4 shadow-lg">
                <h3 className="mb-2 font-semibold">Confirm extracted logs</h3>
                <div className="mb-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2 text-sm">
                  {(() => {
                    const base = confirmLogs ?? "";
                    const combined =
                      base +
                      "\n\nIf you found any errors in above log then fix otherwise if no erros in above provided logs then you can avoid analysis and do only what said" +
                      `\n\nSTART RequestId: c92e5a41-7c73-4c2b-b64f-8b1c5c6e9c71 Version: $LATEST

Lambda invoked

SyntaxError: Unexpected token u in JSON at position 0
    at JSON.parse (<anonymous>)
    at exports.handler (/var/task/index.js:8:21)

END RequestId: c92e5a41-7c73-4c2b-b64f-8b1c5c6e9c71

REPORT RequestId: c92e5a41-7c73-4c2b-b64f-8b1c5c6e9c71
Duration: 2.41 ms
Billed Duration: 100 ms
Memory Size: 128 MB
Max Memory Used: 47 MB` +
                      "\n\nDocument e:\\4. Continue\\continue\\manual-testing-sandbox\\server.js not found in AST tracker";
                    return combined && combined.length > PREVIEW_LEN
                      ? combined.slice(0, PREVIEW_LEN) + "\n\n...(truncated)"
                      : combined;
                  })()}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setShowConfirm(false);
                      setIsExtracting(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      try {
                        setIsExtracting(true);
                        const textToSend = `${confirmLogs}\n\n START RequestId: 8c3d21f1-7c73-4c2b-b64f-8b1c5c6e9c71 Version: $LATEST

🚀 Lambda invoked

SyntaxError: Unexpected token u in JSON at position 0
    at JSON.parse (<anonymous>)
    at exports.handler (/var/task/index.js:11:22)

END RequestId: 8c3d21f1-7c73-4c2b-b64f-8b1c5c6e9c71

REPORT RequestId: 8c3d21f1-7c73-4c2b-b64f-8b1c5c6e9c71
Duration: 4.25 ms
Billed Duration: 100 ms
Memory Size: 128 MB
Max Memory Used: 49 MB

START RequestId: a12b45c3-4e22-4d66-b88e-9e21c3b6d912 Version: $LATEST

🚀 Lambda invoked

Error: EROFS: read-only file system, open './startup-log.txt'
    at Object.openSync (fs.js:498:3)
    at Object.writeFileSync (fs.js:394:35)
    at exports.handler (/var/task/index.js:14:6)

END RequestId: a12b45c3-4e22-4d66-b88e-9e21c3b6d912

REPORT RequestId: a12b45c3-4e22-4d66-b88e-9e21c3b6d912
Duration: 5.12 ms
Billed Duration: 100 ms
Memory Size: 128 MB
Max Memory Used: 52 MB

START RequestId: d31e92a4-1f99-4c7d-a7d2-8e22a9b3c412 Version: $LATEST

🚀 Lambda invoked

UnhandledPromiseRejectionWarning: Error: getaddrinfo ENOTFOUND nonexistent-domain-xyz-aws-test.com
    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1159:16)

END RequestId: d31e92a4-1f99-4c7d-a7d2-8e22a9b3c412

REPORT RequestId: d31e92a4-1f99-4c7d-a7d2-8e22a9b3c412
Duration: 85.77 ms
Billed Duration: 100 ms
Memory Size: 128 MB
Max Memory Used: 61 MB

START RequestId: e99f12c4-33c7-4a9d-a9b2-1a2c4d5e6f77 Version: $LATEST

🚀 Lambda invoked

Task timed out after 3.00 seconds

END RequestId: e99f12c4-33c7-4a9d-a9b2-1a2c4d5e6f77

REPORT RequestId: e99f12c4-33c7-4a9d-a9b2-1a2c4d5e6f77
Duration: 3003.45 ms
Billed Duration: 3000 ms
Memory Size: 128 MB
Max Memory Used: 57 MB

START RequestId: f88c23b1-8e45-4f33-bb92-9e11d7c8a321 Version: $LATEST

🚀 Lambda invoked

SyntaxError: Unexpected token u in JSON at position 0
    at JSON.parse (<anonymous>)
    at exports.handler (/var/task/index.js:25:21)

END RequestId: f88c23b1-8e45-4f33-bb92-9e11d7c8a321

REPORT RequestId: f88c23b1-8e45-4f33-bb92-9e11d7c8a321
Duration: 3.87 ms
Billed Duration: 100 ms
Memory Size: 128 MB
Max Memory Used: 50 MB

`;
                        const editorState = {
                          type: "doc",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: textToSend,
                                },
                              ],
                            },
                          ],
                        } as any;

                        // @ts-ignore - thunk typing
                        await dispatch(
                          streamResponseThunk({
                            editorState,
                            modifiers: { useCodebase: false, noContext: true },
                          }),
                        );
                      } catch (e) {
                        console.error("Submitting extracted logs failed:", e);
                      } finally {
                        setShowConfirm(false);
                        setIsExtracting(false);
                      }
                    }}
                  >
                    Auto-fix (Submit)
                  </Button>
                </div>
              </div>
            </div>
          )}
          {!isInEdit && <ContextStatus />}
          {!props.toolbarOptions?.hideUseCodebase && !isInEdit && (
            <div className="hidden transition-colors duration-200 hover:underline md:flex">
              <HoverItem
                className={
                  props.activeKey === "Meta" ||
                  props.activeKey === "Control" ||
                  props.activeKey === "Alt"
                    ? "underline"
                    : ""
                }
                onClick={(e) =>
                  props.onEnter?.({
                    useCodebase: false,
                    noContext: !useActiveFile,
                  })
                }
              >
                <ToolTip
                  place="top-end"
                  content={`${
                    useActiveFile
                      ? "Send Without Active File"
                      : "Send With Active File"
                  } (${getMetaKeyLabel()}⏎)`}
                >
                  <span>
                    {getMetaKeyLabel()}⏎{" "}
                    {useActiveFile ? "No active file" : "Active file"}
                  </span>
                </ToolTip>
              </HoverItem>
            </div>
          )}
          {isInEdit && (
            <HoverItem
              className="hidden hover:underline sm:flex"
              onClick={async () => {
                void dispatch(exitEdit({}));
                ideMessenger.post("focusEditor", undefined);
              }}
            >
              <span>
                <i>Esc</i> to exit Edit
              </span>
            </HoverItem>
          )}
          <ToolTip place="top" content="Send (⏎)">
            <Button
              variant={props.isMainInput ? "primary" : "secondary"}
              size="sm"
              data-testid="submit-input-button"
              onClick={async (e) => {
                if (props.onEnter) {
                  props.onEnter({
                    useCodebase: false,
                    noContext: useActiveFile
                      ? isMetaEquivalentKeyPressed(e as any) || e.altKey
                      : !(isMetaEquivalentKeyPressed(e as any) || e.altKey),
                  });
                }
              }}
              disabled={isEnterDisabled}
            >
              <span className="hidden md:inline">
                ⏎ {props.toolbarOptions?.enterText ?? "Enter"}
              </span>
              <span className="md:hidden">⏎</span>
            </Button>
          </ToolTip>
        </div>
      </div>
    </>
  );
}

function shallowToolbarOptionsEqual(a?: ToolbarOptions, b?: ToolbarOptions) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.hideAddContext === b.hideAddContext &&
    a.hideImageUpload === b.hideImageUpload &&
    a.hideUseCodebase === b.hideUseCodebase &&
    a.hideSelectModel === b.hideSelectModel &&
    a.enterText === b.enterText
  );
}

export default memo(
  InputToolbar,
  (prev, next) =>
    prev.hidden === next.hidden &&
    prev.disabled === next.disabled &&
    prev.isMainInput === next.isMainInput &&
    prev.activeKey === next.activeKey &&
    shallowToolbarOptionsEqual(prev.toolbarOptions, next.toolbarOptions),
);
