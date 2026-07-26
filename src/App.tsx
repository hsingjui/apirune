import { useEffect, useState } from "react";
import { Message } from "@arco-design/web-react";
import TitleBar from "./components/TitleBar";
import Home from "./components/Home";
import CreateProjectModal from "./components/CreateProjectModal";
import DeleteProjectModal from "./components/DeleteProjectModal";
import ProjectWorkspace from "./components/ProjectWorkspace";
import { usePersistentState } from "./hooks/usePersistentState";
import { createProject, deleteProject, listProjects, updateProject } from "./lib/projects";
import type { CreateProjectInput, Project } from "./types/project";
import "./App.css";

function App() {
  // 递增 key 触发内容区重新挂载，实现无闪烁刷新
  const [contentKey, setContentKey] = useState(0);
  // 项目数据持久化在 SQLite，启动时从后端加载；UI 会话状态仍用 localStorage
  const [projects, setProjects] = useState<Project[]>([]);
  const [openIds, setOpenIds] = usePersistentState<string[]>("apirune:open-tabs", []);
  const [activeId, setActiveId] = usePersistentState<string | null>("apirune:active-tab", null);
  // 创建/编辑共用同一个 Modal：editingProject 为 null 即创建模式
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  // 删除确认弹窗：deletingProject 为 null 即关闭
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  useEffect(() => {
    listProjects().then(setProjects).catch((error) => console.error("加载项目失败:", error));
  }, []);

  // 过滤掉项目已被移除后残留的失效标签
  const openTabs = openIds
    .map((id) => projects.find((project) => project.id === id))
    .filter((project): project is Project => Boolean(project));
  const activeProject = activeId
    ? (openTabs.find((project) => project.id === activeId) ?? null)
    : null;

  const handleOpenProject = (id: string) => {
    if (!openIds.includes(id)) {
      setOpenIds([...openIds, id]);
    }
    setActiveId(id);
  };

  const handleCloseProject = (id: string) => {
    const index = openIds.indexOf(id);
    const nextIds = openIds.filter((openId) => openId !== id);
    setOpenIds(nextIds);
    // 关闭的是当前标签时，优先切到左侧标签，否则右侧，最后回到主页
    if (activeId === id) {
      setActiveId(nextIds[index - 1] ?? nextIds[index] ?? null);
    }
  };

  const handleCreateProject = async (input: CreateProjectInput) => {
    try {
      const project = await createProject(input);
      setProjects((prev) => [...prev, project]);
      setModalVisible(false);
      Message.success(`项目「${project.name}」已创建`);
    } catch (error) {
      Message.error(`创建项目失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleEditProject = async (id: string, input: CreateProjectInput) => {
    try {
      const updated = await updateProject(id, input);
      setProjects((prev) => prev.map((project) => (project.id === id ? updated : project)));
      setEditingProject(null);
      setModalVisible(false);
      Message.success(`项目「${updated.name}」已保存`);
    } catch (error) {
      Message.error(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      const target = projects.find((project) => project.id === id);
      await deleteProject(id);
      setProjects((prev) => prev.filter((project) => project.id !== id));
      setOpenIds((prev) => prev.filter((openId) => openId !== id));
      if (activeId === id) {
        setActiveId(null);
      }
      setDeleteVisible(false);
      Message.success(`项目「${target?.name ?? id}」已删除`);
    } catch (error) {
      Message.error(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const openCreateModal = () => {
    setEditingProject(null);
    setModalVisible(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setModalVisible(true);
  };

  const openDeleteModal = (project: Project) => {
    setDeletingProject(project);
    setDeleteVisible(true);
  };

  return (
    <div className="app-shell">
      <TitleBar
        tabs={openTabs}
        activeId={activeProject?.id ?? null}
        onSelectTab={setActiveId}
        onCloseTab={handleCloseProject}
        onRefresh={() => setContentKey((key) => key + 1)}
      />
      <main className="app-content" key={contentKey}>
        {activeProject ? (
          <ProjectWorkspace project={activeProject} />
        ) : (
          <Home
            projects={projects}
            onOpenProject={handleOpenProject}
            onCreateProject={openCreateModal}
            onEditProject={openEditModal}
            onDeleteProject={openDeleteModal}
          />
        )}
      </main>
      <CreateProjectModal
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onCreate={handleCreateProject}
        editingProject={editingProject}
        onEdit={handleEditProject}
      />
      <DeleteProjectModal
        visible={deleteVisible}
        project={deletingProject}
        onCancel={() => setDeleteVisible(false)}
        onConfirm={handleDeleteProject}
      />
    </div>
  );
}

export default App;
