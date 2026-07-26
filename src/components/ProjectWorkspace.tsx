import type { Project } from "../types/project";
import { ProjectIconBadge } from "./ProjectIcon";
import "./ProjectWorkspace.css";

interface ProjectWorkspaceProps {
  project: Project;
}

/** 项目工作区占位，后续在此实现接口调试等能力 */
function ProjectWorkspace({ project }: ProjectWorkspaceProps) {
  return (
    <div className="project-workspace">
      <ProjectIconBadge icon={project.icon} size={32} badgeSize={64} />
      <h2 className="project-workspace-name">{project.name}</h2>
      <p className="project-workspace-hint">项目工作区，功能建设中…</p>
    </div>
  );
}

export default ProjectWorkspace;
