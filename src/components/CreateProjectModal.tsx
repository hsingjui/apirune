import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROJECT_ICONS } from "../constants/projectIcons";
import { useI18n } from "../i18n";
import type { CreateProjectInput, Project } from "../types/project";
import "./CreateProjectModal.css";

interface CreateProjectModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreate: (input: CreateProjectInput) => void;
  /** 进入编辑模式时传入的项目；创建模式传 null/undefined */
  editingProject?: Project | null;
  onEdit?: (id: string, input: CreateProjectInput) => void;
}

const MAX_NAME_LENGTH = 20;
const ICON_PAGE_SIZE = 16;

function CreateProjectModal({
  visible,
  onCancel,
  onCreate,
  editingProject,
  onEdit,
}: CreateProjectModalProps) {
  const { t } = useI18n();
  const editing = Boolean(editingProject);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(PROJECT_ICONS[0].key);
  const [iconPage, setIconPage] = useState(0);

  // 每次打开时重置表单：编辑模式回填当前项目，创建模式清空
  useEffect(() => {
    if (!visible) return;
    if (editingProject) {
      setName(editingProject.name);
      setIcon(editingProject.icon);
      setIconPage(0);
    } else {
      setName("");
      const randomIndex = Math.floor(Math.random() * PROJECT_ICONS.length);
      setIcon(PROJECT_ICONS[randomIndex].key);
      setIconPage(Math.floor(randomIndex / ICON_PAGE_SIZE));
    }
  }, [visible, editingProject]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const input: CreateProjectInput = { name: trimmedName, icon };
    if (editingProject && onEdit) {
      onEdit(editingProject.id, input);
    } else {
      onCreate(input);
    }
  };

  const totalIconPages = Math.ceil(PROJECT_ICONS.length / ICON_PAGE_SIZE);
  const pageStart = iconPage * ICON_PAGE_SIZE;
  const pageIcons = PROJECT_ICONS.slice(pageStart, pageStart + ICON_PAGE_SIZE);

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-[480px]"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? t("createProject.editTitle") : t("createProject.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="create-project-form">
          <div className="create-project-field">
            <label className="create-project-label" htmlFor="create-project-name">
              {t("createProject.nameLabel")}
            </label>
            <div className="create-project-input-wrap">
              <Input
                id="create-project-name"
                placeholder={t("createProject.namePlaceholder")}
                value={name}
                maxLength={MAX_NAME_LENGTH}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSubmit();
                }}
              />
              <span className="create-project-count" aria-hidden="true">
                {name.length}/{MAX_NAME_LENGTH}
              </span>
            </div>
          </div>

          <div className="create-project-field">
            <span className="create-project-label">{t("createProject.iconLabel")}</span>
            <div className="create-project-icons-wrap">
              <div
                className="create-project-icons"
                role="radiogroup"
                aria-label={t("createProject.iconLabel")}
              >
                {pageIcons.map((entry) => {
                  const { Icon } = entry;
                  const selected = entry.key === icon;
                  return (
                    <Tooltip key={entry.key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`create-project-icon${selected ? " create-project-icon-selected" : ""}`}
                          onClick={() => setIcon(entry.key)}
                        >
                          <Icon style={{ fontSize: 18, color: entry.color }} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t(`icon.${entry.key}`)}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <div className="create-project-pagination">
                <div className="create-project-pagination-controls">
                  <button
                    type="button"
                    className="create-project-pagination-btn"
                    disabled={iconPage === 0}
                    onClick={() => setIconPage((p) => Math.max(0, p - 1))}
                    aria-label={t("createProject.prevPage")}
                  >
                    <ChevronLeft />
                  </button>
                  <span className="create-project-pagination-text">
                    {iconPage + 1} / {totalIconPages}
                  </span>
                  <button
                    type="button"
                    className="create-project-pagination-btn"
                    disabled={iconPage === totalIconPages - 1}
                    onClick={() => setIconPage((p) => Math.min(totalIconPages - 1, p + 1))}
                    aria-label={t("createProject.nextPage")}
                  >
                    <ChevronRight />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {editing ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateProjectModal;
