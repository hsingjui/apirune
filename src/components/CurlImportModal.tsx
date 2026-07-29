import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "../i18n";
import { getProjectGlobals } from "../lib/environments";
import { applyImportUrlRules, type ParsedCurl, parseImportCommand } from "../utils/curl";
import "./CurlImportModal.css";

interface CurlImportModalProps {
  visible: boolean;
  /** 当前项目 id，用于读取项目级导入 URL 规则；缺省时由父组件自行应用规则（如首页草稿流） */
  projectId?: string;
  onCancel: () => void;
  /** 解析成功后回调，由父组件创建快捷请求标签页 */
  onImport: (parsed: ParsedCurl) => void;
}

/** 导入弹窗：粘贴 cURL、PowerShell 或浏览器复制的原始 HTTP 请求 */
function CurlImportModal({ visible, projectId, onCancel, onImport }: CurlImportModalProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 每次打开时重置输入
  useEffect(() => {
    if (visible) {
      setText("");
      setError(null);
    }
  }, [visible]);

  const handleImport = async () => {
    try {
      const parsed = parseImportCommand(text);
      // 按项目级导入 URL 规则改写地址，便于与环境 baseUrl 组合
      if (projectId) {
        const globals = await getProjectGlobals(projectId);
        parsed.url = applyImportUrlRules(parsed.url, globals.importUrlRules);
      }
      onImport(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-[560px]"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("curlImport.title")}</DialogTitle>
        </DialogHeader>

        <div className="curl-import-form">
          <textarea
            className="curl-import-input"
            placeholder={t("curlImport.placeholder")}
            value={text}
            autoFocus
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (text.trim()) handleImport();
              }
            }}
          />
          {error && (
            <p className="curl-import-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!text.trim()} onClick={handleImport}>
            {t("common.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CurlImportModal;
