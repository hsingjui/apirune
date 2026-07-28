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
import { type ParsedCurl, parseImportCommand } from "../utils/curl";
import "./CurlImportModal.css";

interface CurlImportModalProps {
  visible: boolean;
  onCancel: () => void;
  /** 解析成功后回调，由父组件创建快捷请求标签页 */
  onImport: (parsed: ParsedCurl) => void;
}

/** curl 导入弹窗：粘贴 curl / PowerShell 命令，解析为快捷请求（不入库） */
function CurlImportModal({ visible, onCancel, onImport }: CurlImportModalProps) {
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

  const handleImport = () => {
    try {
      onImport(parseImportCommand(text));
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
