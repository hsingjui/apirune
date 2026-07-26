import { useEffect, useState } from "react";
import { Input, Modal, Tooltip } from "@arco-design/web-react";
import { IconLeft, IconRight } from "@arco-design/web-react/icon";
import { PROJECT_ICONS } from "../constants/projectIcons";
import { useEscClose } from "../hooks/useEscClose";
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
  const editing = Boolean(editingProject);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(PROJECT_ICONS[0].key);
  const [iconPage, setIconPage] = useState(0);

  useEscClose(visible, onCancel);

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
    <Modal
      title={editing ? "编辑项目" : "新建项目"}
      visible={visible}
      okText={editing ? "保存" : "创建"}
      cancelText="取消"
      okButtonProps={{ disabled: !canSubmit }}
      onOk={handleSubmit}
      onCancel={onCancel}
      autoFocus={false}
      style={{ width: 480 }}
    >
      <div className="create-project-form">
        <div className="create-project-field">
          <label className="create-project-label" htmlFor="create-project-name">
            项目名称
          </label>
          <Input
            id="create-project-name"
            placeholder="给项目起个名字"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            showWordLimit
            autoFocus
            onChange={setName}
            onPressEnter={handleSubmit}
          />
        </div>

        <div className="create-project-field">
          <span className="create-project-label">项目图标</span>
          <div className="create-project-icons-wrap">
            <div className="create-project-icons" role="radiogroup" aria-label="项目图标">
              {pageIcons.map((entry) => {
                const { Icon } = entry;
                const selected = entry.key === icon;
                return (
                  <Tooltip key={entry.key} content={entry.label}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`create-project-icon${selected ? " create-project-icon-selected" : ""}`}
                      onClick={() => setIcon(entry.key)}
                    >
                      <Icon style={{ fontSize: 18, color: entry.color }} />
                    </button>
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
                  aria-label="上一页"
                >
                  <IconLeft />
                </button>
                <span className="create-project-pagination-text">
                  {iconPage + 1} / {totalIconPages}
                </span>
                <button
                  type="button"
                  className="create-project-pagination-btn"
                  disabled={iconPage === totalIconPages - 1}
                  onClick={() => setIconPage((p) => Math.min(totalIconPages - 1, p + 1))}
                  aria-label="下一页"
                >
                  <IconRight />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default CreateProjectModal;
