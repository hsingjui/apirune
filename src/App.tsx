import { useEffect, useState } from "react";
import { toast } from "sonner";
import CreateProjectModal from "./components/CreateProjectModal";
import CurlImportModal from "./components/CurlImportModal";
import DeleteProjectModal from "./components/DeleteProjectModal";
import Home from "./components/Home";
import ProjectWorkspace from "./components/ProjectWorkspace";
import TitleBar from "./components/TitleBar";
import { usePersistentState } from "./hooks/usePersistentState";
import {
  runCloseTabInterceptor,
  useShortcutAction,
  useShortcutListener,
} from "./hooks/useShortcuts";
import { t } from "./i18n";
import {
  createProject,
  deleteProject,
  ensureScratchProject,
  listProjects,
  reorderProjects,
  updateProject,
} from "./lib/projects";
import { loadSettings } from "./lib/settings";
import type { CreateProjectInput, Project } from "./types/project";
import type { QuickRequest } from "./types/quick";
import type { ParsedCurl } from "./utils/curl";
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
  // 主页搜索选中的快捷请求，交由对应项目的工作区打开后清除
  const [pendingRequest, setPendingRequest] = useState<QuickRequest | null>(null);
  // 主页 cURL 导入 / 快速请求：弹窗状态与带入的初始配置，交由快速请求项目的工作区打开后清除
  const [homeCurlVisible, setHomeCurlVisible] = useState(false);
  const [pendingCurl, setPendingCurl] = useState<ParsedCurl | null>(null);
  const [pendingCurlProjectId, setPendingCurlProjectId] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((error) => console.error("加载项目失败:", error));
  }, []);

  // 设置项「启动时恢复项目」：关闭时启动直接回到主页
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅需启动时执行一次，setState 引用稳定
  useEffect(() => {
    if (!loadSettings().restoreTabs) {
      setOpenIds([]);
      setActiveId(null);
    }
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
      toast.success(t("app.projectCreated", { name: project.name }));
    } catch (error) {
      toast.error(
        t("app.createFailed", { error: error instanceof Error ? error.message : String(error) }),
      );
    }
  };

  const handleEditProject = async (id: string, input: CreateProjectInput) => {
    try {
      const updated = await updateProject(id, input);
      setProjects((prev) => prev.map((project) => (project.id === id ? updated : project)));
      setEditingProject(null);
      setModalVisible(false);
      toast.success(t("app.projectSaved", { name: updated.name }));
    } catch (error) {
      toast.error(
        t("app.saveFailed", { error: error instanceof Error ? error.message : String(error) }),
      );
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
      toast.success(t("app.projectDeleted", { name: target?.name ?? id }));
    } catch (error) {
      toast.error(
        t("app.deleteFailed", { error: error instanceof Error ? error.message : String(error) }),
      );
    }
  };

  const openCreateModal = () => {
    setEditingProject(null);
    setModalVisible(true);
  };

  /** 主页拖拽排序：ids 为排序后的可见项目顺序 */
  const handleReorderProjects = async (ids: string[]) => {
    try {
      await reorderProjects(ids);
      setProjects(await listProjects());
    } catch (error) {
      toast.error(
        t("app.saveFailed", { error: error instanceof Error ? error.message : String(error) }),
      );
    }
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setModalVisible(true);
  };

  const openDeleteModal = (project: Project) => {
    setDeletingProject(project);
    setDeleteVisible(true);
  };

  /** 打开内置快速请求项目，首次使用时创建，并新建一个空快捷请求标签 */
  const handleQuickRequest = async () => {
    try {
      const project = await ensureScratchProject(t("home.scratchProject"));
      setProjects((prev) =>
        prev.some((item) => item.id === project.id) ? prev : [...prev, project],
      );
      setPendingCurl({
        method: "GET",
        url: "",
        params: [],
        headers: [],
        bodyType: "none",
        body: "",
      });
      setPendingCurlProjectId(project.id);
      handleOpenProject(project.id);
    } catch (error) {
      toast.error(
        t("app.createFailed", { error: error instanceof Error ? error.message : String(error) }),
      );
    }
  };

  /** 主页搜索选中快捷请求：打开所属项目并定位到该请求 */
  const handleOpenRequest = (request: QuickRequest) => {
    setPendingRequest(request);
    handleOpenProject(request.projectId);
  };

  /** 主页「导入请求」：直接打开 cURL 导入弹窗，解析后在快速请求项目中打开 */
  const openHomeImport = () => setHomeCurlVisible(true);

  /** 主页 cURL 导入解析成功：打开快速请求项目并带入初始配置 */
  const handleHomeCurlImport = async (parsed: ParsedCurl) => {
    setHomeCurlVisible(false);
    try {
      const project = await ensureScratchProject(t("home.scratchProject"));
      setProjects((prev) =>
        prev.some((item) => item.id === project.id) ? prev : [...prev, project],
      );
      setPendingCurl(parsed);
      setPendingCurlProjectId(project.id);
      handleOpenProject(project.id);
    } catch (error) {
      toast.error(
        t("app.createFailed", { error: error instanceof Error ? error.message : String(error) }),
      );
    }
  };

  // 快捷键：应用前台时监听（见 useShortcutListener），可在设置中配置
  useShortcutListener();
  useShortcutAction(
    "closeTab",
    () => {
      // 工作区有快捷请求标签打开时，优先关闭标签而非项目
      if (runCloseTabInterceptor()) return;
      if (activeProject) handleCloseProject(activeProject.id);
    },
    activeProject !== null,
  );
  const cycleTab = (step: number) => {
    // 主页视为第一个位置，与项目标签一起循环切换
    const ids: (string | null)[] = [null, ...openTabs.map((tab) => tab.id)];
    const current = ids.indexOf(activeProject?.id ?? null);
    setActiveId(ids[(current + step + ids.length) % ids.length]);
  };
  useShortcutAction("nextTab", () => cycleTab(1), openTabs.length > 0);
  useShortcutAction("prevTab", () => cycleTab(-1), openTabs.length > 0);
  useShortcutAction(
    "gotoTab",
    (index) => {
      if (!index) return;
      const target = index === 9 ? openTabs[openTabs.length - 1] : openTabs[index - 1];
      if (target) setActiveId(target.id);
    },
    openTabs.length > 0,
  );

  return (
    <div className="app-shell">
      <TitleBar
        tabs={openTabs}
        activeId={activeProject?.id ?? null}
        onSelectTab={setActiveId}
        onCloseTab={handleCloseProject}
        onRefresh={() => setContentKey((key) => key + 1)}
      />
      <main className={`app-content${activeProject ? " app-content-bare" : ""}`} key={contentKey}>
        {activeProject ? (
          <ProjectWorkspace
            project={activeProject}
            initialRequest={pendingRequest?.projectId === activeProject.id ? pendingRequest : null}
            onInitialRequestConsumed={() => setPendingRequest(null)}
            initialCurl={
              pendingCurl && pendingCurlProjectId === activeProject.id ? pendingCurl : null
            }
            onInitialCurlConsumed={() => {
              setPendingCurl(null);
              setPendingCurlProjectId(null);
            }}
          />
        ) : (
          <Home
            projects={projects}
            onOpenProject={handleOpenProject}
            onCreateProject={openCreateModal}
            onEditProject={openEditModal}
            onDeleteProject={openDeleteModal}
            onReorderProjects={handleReorderProjects}
            onQuickRequest={handleQuickRequest}
            onImportRequest={openHomeImport}
            onOpenRequest={handleOpenRequest}
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
      <CurlImportModal
        visible={homeCurlVisible}
        onCancel={() => setHomeCurlVisible(false)}
        onImport={handleHomeCurlImport}
      />
    </div>
  );
}

export default App;
