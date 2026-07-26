import { Button } from "@arco-design/web-react";
import { IconCode, IconDelete, IconEdit, IconPlus } from "@arco-design/web-react/icon";
import type { Project } from "../types/project";
import { ProjectIconBadge } from "./ProjectIcon";
import "./Home.css";

interface HomeProps {
  projects: Project[];
  onOpenProject: (id: string) => void;
  onCreateProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** 一周内显示相对时间，更早回退到具体日期 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(timestamp);
}

/** 卡片入场交错延迟，项目多时封顶避免末尾卡片等待过久 */
function enterDelay(index: number): string {
  return `${Math.min(index, 10) * 40}ms`;
}

function Home({ projects, onOpenProject, onCreateProject, onEditProject, onDeleteProject }: HomeProps) {
  const latestUpdatedAt = projects.reduce((max, project) => Math.max(max, project.updatedAt), 0);

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-header-text">
          <h1 className="home-title">我的项目</h1>
          <p className="home-subtitle">
            {projects.length > 0
              ? `共 ${projects.length} 个项目 · 最近编辑 ${formatRelativeTime(latestUpdatedAt)}`
              : "从新建一个项目开始吧"}
          </p>
        </div>
        <Button type="primary" size="large" icon={<IconPlus />} onClick={onCreateProject}>
          新建项目
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="home-empty">
          <span className="home-empty-badge">
            <IconCode />
          </span>
          <h2 className="home-empty-title">还没有项目</h2>
          <p className="home-empty-desc">创建第一个项目，开始调试和管理你的 API</p>
          <Button type="primary" size="large" icon={<IconPlus />} onClick={onCreateProject}>
            新建项目
          </Button>
        </div>
      ) : (
        <div className="home-grid">
          {projects.map((project, index) => (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              className="project-card"
              style={{ animationDelay: enterDelay(index) }}
              onClick={() => onOpenProject(project.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenProject(project.id);
                }
              }}
            >
              <div className="project-card-actions">
                <button
                  type="button"
                  className="project-card-action"
                  title="重命名"
                  aria-label={`重命名 ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditProject(project);
                  }}
                >
                  <IconEdit />
                </button>
                <button
                  type="button"
                  className="project-card-action project-card-action-danger"
                  title="删除"
                  aria-label={`删除 ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteProject(project);
                  }}
                >
                  <IconDelete />
                </button>
              </div>
              <ProjectIconBadge icon={project.icon} size={24} badgeSize={48} />
              <span className="project-card-name">{project.name}</span>
              <span className="project-card-date">编辑于 {formatRelativeTime(project.updatedAt)}</span>
            </div>
          ))}

          <button
            type="button"
            className="project-card project-card-create"
            style={{ animationDelay: enterDelay(projects.length) }}
            onClick={onCreateProject}
          >
            <span className="project-card-create-icon">
              <IconPlus />
            </span>
            <span className="project-card-create-text">新建项目</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default Home;
