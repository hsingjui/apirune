import { getProjectIcon } from "../constants/projectIcons";

interface ProjectIconProps {
  icon: string;
  size?: number;
}

/** 按 key 渲染项目内置图标 */
function ProjectIcon({ icon, size = 16 }: ProjectIconProps) {
  const entry = getProjectIcon(icon);
  const { Icon } = entry;
  return <Icon size={size} style={{ color: entry.color }} />;
}

interface ProjectIconBadgeProps extends ProjectIconProps {
  badgeSize?: number;
}

/** 带彩色底座的图标，用于卡片、工作区等展示场景 */
export function ProjectIconBadge({ icon, size = 20, badgeSize = 40 }: ProjectIconBadgeProps) {
  const entry = getProjectIcon(icon);
  const { Icon } = entry;
  return (
    <span
      className="project-icon-badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: badgeSize,
        height: badgeSize,
        borderRadius: "var(--border-radius-medium)",
        backgroundColor: `color-mix(in srgb, ${entry.color} 12%, transparent)`,
        flexShrink: 0,
      }}
    >
      <Icon size={size} style={{ color: entry.color }} />
    </span>
  );
}

export default ProjectIcon;
