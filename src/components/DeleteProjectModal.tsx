import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "../i18n";
import type { Project } from "../types/project";
import "./DeleteProjectModal.css";

interface DeleteProjectModalProps {
  visible: boolean;
  project: Project | null;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}

function DeleteProjectModal({ visible, project, onCancel, onConfirm }: DeleteProjectModalProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");

  // 每次打开时清空输入，确保需重新确认
  useEffect(() => {
    if (visible) setValue("");
  }, [visible]);

  const trimmed = value.trim();
  const canConfirm = project != null && trimmed === project.name;

  const handleConfirm = () => {
    if (!canConfirm || !project) return;
    onConfirm(project.id);
  };

  const copyName = () => {
    if (!project) return;
    void navigator.clipboard.writeText(project.name).then(
      () => toast.success(t("deleteProject.nameCopied")),
      () => toast.error(t("deleteProject.copyFailed")),
    );
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-[440px]"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("deleteProject.title")}</DialogTitle>
        </DialogHeader>

        <div className="delete-project-form">
          <p className="delete-project-hint">
            {t("deleteProject.hintPrefix")}
            <button
              type="button"
              className="delete-project-name"
              title={t("deleteProject.copyTitle")}
              onClick={copyName}
            >
              {project?.name}
            </button>
            {t("deleteProject.hintSuffix")}
          </p>
          <Input
            placeholder={t("deleteProject.inputPlaceholder")}
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleConfirm();
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" disabled={!canConfirm} onClick={handleConfirm}>
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteProjectModal;
