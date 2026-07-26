import { useEffect, useState } from "react";
import { Input, Message, Modal } from "@arco-design/web-react";
import { useEscClose } from "../hooks/useEscClose";
import type { Project } from "../types/project";
import "./DeleteProjectModal.css";

interface DeleteProjectModalProps {
  visible: boolean;
  project: Project | null;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}

function DeleteProjectModal({ visible, project, onCancel, onConfirm }: DeleteProjectModalProps) {
  const [value, setValue] = useState("");

  useEscClose(visible, onCancel);

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
      () => Message.success("已复制项目名称"),
      () => Message.error("复制失败"),
    );
  };

  return (
    <Modal
      title="删除项目"
      visible={visible}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ status: "danger", disabled: !canConfirm }}
      onOk={handleConfirm}
      onCancel={onCancel}
      autoFocus={false}
      style={{ width: 440 }}
    >
      <div className="delete-project-form">
        <p className="delete-project-hint">
          此操作不可恢复。请输入项目名称
          <b
            className="delete-project-name"
            title="点击复制"
            role="button"
            tabIndex={0}
            onClick={copyName}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                copyName();
              }
            }}
          >
            {project?.name}
          </b>
          以确认删除。
        </p>
        <Input
          placeholder="输入项目名称确认"
          value={value}
          autoFocus
          onChange={setValue}
          onPressEnter={handleConfirm}
        />
      </div>
    </Modal>
  );
}

export default DeleteProjectModal;
