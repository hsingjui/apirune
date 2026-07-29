import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, useI18n } from "../i18n";
import {
  type CodegenInput,
  generateSnippet,
  SNIPPET_LANGUAGES,
  type SnippetKind,
} from "../utils/codegen";
import { type HighlightLang, tokenizeLines } from "../utils/codeHighlight";
import "./CodegenModal.css";

interface CodegenModalProps {
  visible: boolean;
  /** 已解析路径参数与环境配置的请求快照；打开弹窗前由编辑器计算 */
  input: CodegenInput | null;
  onClose: () => void;
}

/** 各语言在左侧列表中的小图标徽标（纯 CSS，无额外资源） */
const LANGUAGE_BADGES: Record<string, { text: string; className: string }> = {
  Shell: { text: ">_", className: "codegen-icon-shell" },
  JavaScript: { text: "JS", className: "codegen-icon-js" },
  Java: { text: "J", className: "codegen-icon-java" },
  Go: { text: "Go", className: "codegen-icon-go" },
  Python: { text: "Py", className: "codegen-icon-python" },
  C: { text: "C", className: "codegen-icon-c" },
};

/** 片段类型到高亮语言的映射 */
const HIGHLIGHT_LANGS: Record<SnippetKind, HighlightLang> = {
  curl: "shell",
  "curl-win": "shell",
  httpie: "shell",
  wget: "shell",
  powershell: "shell",
  fetch: "js",
  axios: "js",
  jquery: "js",
  xhr: "js",
  "node-native": "js",
  "node-request": "js",
  unirest: "js",
  "java-okhttp": "java",
  "java-unirest": "java",
  "go-native": "go",
  "c-libcurl": "c",
  python: "python",
};

/** 生成代码弹窗：左侧语言列表，右侧变体 Tab + 代码预览与复制 */
function CodegenModal({ visible, input, onClose }: CodegenModalProps) {
  useI18n();
  const [kind, setKind] = useState<SnippetKind>("curl");
  const activeGroup =
    SNIPPET_LANGUAGES.find((group) => group.variants.some((v) => v.kind === kind)) ??
    SNIPPET_LANGUAGES[0];
  const activeVariant =
    activeGroup.variants.find((v) => v.kind === kind) ?? activeGroup.variants[0];
  const code = useMemo(() => (input ? generateSnippet(kind, input) : ""), [kind, input]);
  const lines = useMemo(() => tokenizeLines(code, HIGHLIGHT_LANGS[kind]), [code, kind]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t("editor.copyCodeSuccess", { label: activeVariant.label }));
    } catch (err) {
      console.error("复制代码失败", err);
      toast.error(t("editor.copyCodeFailed"));
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="codegen-dialog gap-0 overflow-hidden p-0 sm:max-w-[860px]">
        <DialogHeader className="codegen-header">
          <DialogTitle>{t("editor.generateCode")}</DialogTitle>
        </DialogHeader>
        <div className="codegen-body">
          <aside className="codegen-langs">
            {SNIPPET_LANGUAGES.map((group) => {
              const badge = LANGUAGE_BADGES[group.language];
              const isActive = group.language === activeGroup.language;
              return (
                <button
                  key={group.language}
                  type="button"
                  className={`codegen-lang${isActive ? " codegen-lang-active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => setKind(group.variants[0].kind)}
                >
                  {badge && (
                    <span className={`codegen-lang-icon ${badge.className}`} aria-hidden="true">
                      {badge.text}
                    </span>
                  )}
                  {group.language}
                </button>
              );
            })}
          </aside>
          <section className="codegen-main">
            <h3 className="codegen-lang-title">{activeGroup.language}</h3>
            <div className="codegen-card">
              <div className="codegen-card-header">
                <div className="codegen-tabs" role="tablist">
                  {activeGroup.variants.map((variant) => (
                    <button
                      key={variant.kind}
                      type="button"
                      role="tab"
                      aria-selected={variant.kind === activeVariant.kind}
                      className={`codegen-tab${variant.kind === activeVariant.kind ? " codegen-tab-active" : ""}`}
                      onClick={() => setKind(variant.kind)}
                    >
                      {variant.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="codegen-code-wrap">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="codegen-copy"
                      aria-label={t("common.copy")}
                      onClick={() => void handleCopy()}
                    >
                      <Copy aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("common.copy")}</TooltipContent>
                </Tooltip>
                <pre className="codegen-code">
                  <code>
                    {lines.map((tokens, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 代码高亮行为静态渲染，顺序不变
                      <div className="codegen-line" key={index}>
                        <span className="codegen-line-no" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span className="codegen-line-text">
                          {tokens.length > 0
                            ? tokens.map((token, tokenIndex) =>
                                token.type ? (
                                  // biome-ignore lint/suspicious/noArrayIndexKey: 行内语法 token 为静态渲染，顺序不变
                                  <span key={tokenIndex} className={`codegen-tok-${token.type}`}>
                                    {token.text}
                                  </span>
                                ) : (
                                  token.text
                                ),
                              )
                            : " "}
                        </span>
                      </div>
                    ))}
                  </code>
                </pre>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CodegenModal;
