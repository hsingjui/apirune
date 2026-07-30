import { Plus, SlidersHorizontal, Trash2, Variable, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, useI18n } from "../i18n";
import {
  getProjectGlobals,
  listEnvironments,
  replaceEnvironments,
  saveProjectGlobals,
} from "../lib/environments";
import type {
  Environment,
  EnvVariable,
  GlobalParam,
  GlobalParamIn,
  ProjectGlobals,
} from "../types/environment";
import type { AuthConfig, AuthType } from "../types/http";
import { createId } from "../utils/id";
import "./EnvironmentModal.css";

interface EnvironmentModalProps {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  /** 保存成功后回调，携带最新环境列表，供工作区刷新展示 */
  onSaved?: (environments: Environment[]) => void;
}

/** 左侧导航选中项："global-vars" | "global-params" | 环境 id */
type SelectionKey = string;

const GLOBAL_VARS = "global-vars";
const GLOBAL_PARAMS = "global-params";

/** 环境管理弹窗：全局变量、全局参数与项目环境的集中管理，统一保存 */
function EnvironmentModal({ visible, projectId, onClose, onSaved }: EnvironmentModalProps) {
  const { t } = useI18n();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [globals, setGlobals] = useState<ProjectGlobals>({
    variables: [],
    params: [],
    importUrlRules: [],
  });
  const [selected, setSelected] = useState<SelectionKey>(GLOBAL_VARS);
  const [saving, setSaving] = useState(false);

  // 每次打开时从数据库加载草稿，关闭不保存即丢弃
  // biome-ignore lint/correctness/useExhaustiveDependencies: t 仅用于 catch 一次性 toast，无需因语言变化重跑
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    Promise.all([listEnvironments(projectId), getProjectGlobals(projectId)])
      .then(([envs, loadedGlobals]) => {
        if (cancelled) return;
        setEnvironments(envs);
        setGlobals(loadedGlobals);
        setSelected(envs[0]?.id ?? GLOBAL_VARS);
      })
      .catch((error) => {
        console.error("加载环境失败", error);
        toast.error(t("env.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [visible, projectId]);

  const selectedEnv = environments.find((env) => env.id === selected) ?? null;

  const updateEnv = (id: string, patch: Partial<Environment>) => {
    setEnvironments((envs) => envs.map((env) => (env.id === id ? { ...env, ...patch } : env)));
  };

  const addEnvironment = () => {
    const now = Date.now();
    const env: Environment = {
      id: createId(),
      projectId,
      name: t("env.newEnvName", { n: environments.length + 1 }),
      baseUrl: "",
      variables: [],
      sortOrder: environments.length,
      createdAt: now,
      updatedAt: now,
    };
    setEnvironments((envs) => [...envs, env]);
    setSelected(env.id);
  };

  const removeEnvironment = (id: string) => {
    const next = environments.filter((env) => env.id !== id);
    setEnvironments(next);
    if (selected === id) {
      setSelected(next[0]?.id ?? GLOBAL_VARS);
    }
  };

  const save = async (closeAfter: boolean) => {
    setSaving(true);
    try {
      // 空名称兜底，避免侧栏出现无名环境
      const normalized = environments.map((env) =>
        env.name.trim() ? env : { ...env, name: t("env.unnamed") },
      );
      await replaceEnvironments(projectId, normalized);
      await saveProjectGlobals(projectId, globals);
      setEnvironments(normalized);
      onSaved?.(normalized);
      toast.success(t("env.saved"));
      if (closeAfter) onClose();
    } catch (error) {
      console.error("保存环境失败", error);
      toast.error(t("env.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="env-modal gap-0 p-0 sm:max-w-[860px]"
        showCloseButton={false}
        aria-describedby={undefined}
        // 阻止打开时自动聚焦首个可聚焦元素（关闭按钮），避免其 Tooltip 因 focus 弹出
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("env.title")}</DialogTitle>
        <header className="env-header">
          <h2 className="env-header-title">{t("env.title")}</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="env-close"
                aria-label={t("common.close")}
                onClick={onClose}
              >
                <X />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("common.close")}</TooltipContent>
          </Tooltip>
        </header>

        <div className="env-layout">
          {/* 左侧导航：全局配置 + 环境列表 */}
          <nav className="env-nav" aria-label={t("env.navAria")}>
            <span className="env-nav-group">{t("env.globalGroup")}</span>
            <button
              type="button"
              className={`env-nav-item${selected === GLOBAL_VARS ? " env-nav-item-active" : ""}`}
              onClick={() => setSelected(GLOBAL_VARS)}
            >
              <Variable />
              <span>{t("env.globalVars")}</span>
            </button>
            <button
              type="button"
              className={`env-nav-item${selected === GLOBAL_PARAMS ? " env-nav-item-active" : ""}`}
              onClick={() => setSelected(GLOBAL_PARAMS)}
            >
              <SlidersHorizontal />
              <span>{t("env.globalParams")}</span>
            </button>
            <span className="env-nav-group">{t("env.envGroup")}</span>
            {environments.map((env) => (
              <button
                key={env.id}
                type="button"
                className={`env-nav-item${selected === env.id ? " env-nav-item-active" : ""}`}
                onClick={() => setSelected(env.id)}
              >
                <span className="env-nav-badge" aria-hidden="true">
                  {env.name.trim().charAt(0) || t("env.badgeFallback")}
                </span>
                <span className="env-nav-name">{env.name || t("env.unnamed")}</span>
              </button>
            ))}
            <button type="button" className="env-nav-item env-nav-add" onClick={addEnvironment}>
              <Plus />
              <span>{t("env.newEnv")}</span>
            </button>
          </nav>

          {/* 右侧内容区 */}
          <div className="env-content">
            <div className="env-content-body">
              {selected === GLOBAL_VARS && (
                <>
                  <h3 className="env-section-title">{t("env.globalVars")}</h3>
                  <p className="env-section-hint">{t("env.globalVarsHint")}</p>
                  <VariableTable
                    items={globals.variables}
                    onChange={(variables) => setGlobals((prev) => ({ ...prev, variables }))}
                  />
                </>
              )}

              {selected === GLOBAL_PARAMS && (
                <>
                  <h3 className="env-section-title">{t("env.globalParams")}</h3>
                  <p className="env-section-hint">{t("env.globalParamsHint")}</p>
                  <GlobalParamTable
                    items={globals.params}
                    onChange={(params) => setGlobals((prev) => ({ ...prev, params }))}
                  />
                </>
              )}

              {selectedEnv && (
                <>
                  <div className="env-detail-header">
                    <span className="env-nav-badge env-detail-badge" aria-hidden="true">
                      {selectedEnv.name.trim().charAt(0) || t("env.badgeFallback")}
                    </span>
                    <Input
                      className="env-detail-name"
                      value={selectedEnv.name}
                      placeholder={t("env.envNamePlaceholder")}
                      maxLength={20}
                      onChange={(event) => updateEnv(selectedEnv.id, { name: event.target.value })}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={t("env.deleteEnv")}
                          onClick={() => removeEnvironment(selectedEnv.id)}
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("env.deleteEnv")}</TooltipContent>
                    </Tooltip>
                  </div>

                  <h3 className="env-section-title">{t("env.baseUrl")}</h3>
                  <Input
                    value={selectedEnv.baseUrl}
                    placeholder={t("env.baseUrlPlaceholder")}
                    onChange={(event) => updateEnv(selectedEnv.id, { baseUrl: event.target.value })}
                  />

                  <h3 className="env-section-title">{t("env.auth")}</h3>
                  <p className="env-section-hint">{t("env.authHint")}</p>
                  <AuthEditor
                    value={selectedEnv.auth ?? { authType: "none" }}
                    onChange={(auth) => updateEnv(selectedEnv.id, { auth })}
                  />

                  <h3 className="env-section-title">{t("env.envVars")}</h3>
                  <p className="env-section-hint">{t("env.envVarsHint")}</p>
                  <VariableTable
                    items={selectedEnv.variables}
                    onChange={(variables) => updateEnv(selectedEnv.id, { variables })}
                  />
                </>
              )}

              {!selectedEnv && selected !== GLOBAL_VARS && selected !== GLOBAL_PARAMS && (
                <p className="env-section-hint">{t("env.selectHint")}</p>
              )}
            </div>

            <footer className="env-footer">
              <Button variant="outline" disabled={saving} onClick={() => save(true)}>
                {t("env.saveAndClose")}
              </Button>
              <Button disabled={saving} onClick={() => save(false)}>
                {t("env.save")}
              </Button>
            </footer>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 变量表格：变量名 / 变量值，末尾带自动追加的占位行 */
function VariableTable({
  items,
  onChange,
}: {
  items: EnvVariable[];
  onChange: (items: EnvVariable[]) => void;
}) {
  const updateItem = (index: number, field: keyof EnvVariable, value: string) => {
    if (index === items.length) {
      onChange([...items, { name: "", value: "", [field]: value }]);
      return;
    }
    onChange(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  return (
    <div className="env-table">
      <div className="env-table-head env-table-grid">
        <span>{t("env.varName")}</span>
        <span>{t("env.varValue")}</span>
        <span aria-hidden="true" />
      </div>
      {[...items, { name: "", value: "" }].map((item, index) => {
        const isPlaceholder = index === items.length;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 受控键值行 + 末尾占位行，数据项无稳定 id，以索引定位（与 updateItem(index) 对应）
          <div key={index} className="env-table-row env-table-grid">
            <input
              placeholder={isPlaceholder ? t("env.addVar") : t("env.varName")}
              value={item.name}
              onChange={(event) => updateItem(index, "name", event.target.value)}
            />
            <input
              placeholder={t("env.varValue")}
              value={item.value}
              onChange={(event) => updateItem(index, "value", event.target.value)}
            />
            {isPlaceholder ? (
              <span aria-hidden="true" />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="env-table-remove"
                    aria-label={t("env.deleteVar")}
                    onClick={() => onChange(items.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("common.delete")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 全局参数类型页签 */
const PARAM_TABS: { key: GlobalParamIn; label: string }[] = [
  { key: "header", label: "Header" },
  { key: "cookie", label: "Cookie" },
  { key: "query", label: "Query" },
];

/** 全局参数表格：按 Header / Cookie / Query 页签切换，各自维护参数名 / 参数值 */
function GlobalParamTable({
  items,
  onChange,
}: {
  items: GlobalParam[];
  onChange: (items: GlobalParam[]) => void;
}) {
  const [activeIn, setActiveIn] = useState<GlobalParamIn>("header");
  const current = items.filter((item) => item.in === activeIn);

  // 用当前页签的最新列表替换整体列表中同类型的条目
  const replaceCurrent = (next: GlobalParam[]) => {
    onChange([...items.filter((item) => item.in !== activeIn), ...next]);
  };

  const updateItem = (index: number, patch: Partial<GlobalParam>) => {
    if (index === current.length) {
      replaceCurrent([...current, { in: activeIn, name: "", value: "", ...patch }]);
      return;
    }
    replaceCurrent(current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <>
      <div className="env-param-tabs" role="tablist">
        {PARAM_TABS.map((tab) => {
          const count = items.filter((item) => item.in === tab.key).length;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeIn === tab.key}
              className={`env-param-tab${activeIn === tab.key ? " env-param-tab-active" : ""}`}
              onClick={() => setActiveIn(tab.key)}
            >
              {tab.label}
              {count > 0 && <span className="env-param-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="env-table">
        <div className="env-table-head env-table-grid">
          <span>{t("env.paramName")}</span>
          <span>{t("env.paramValue")}</span>
          <span aria-hidden="true" />
        </div>
        {[...current, { in: activeIn, name: "", value: "" }].map((item, index) => {
          const isPlaceholder = index === current.length;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 受控键值行 + 末尾占位行，数据项无稳定 id，以索引定位
            <div key={index} className="env-table-row env-table-grid">
              <input
                placeholder={isPlaceholder ? t("env.addParam") : t("env.paramName")}
                value={item.name}
                onChange={(event) => updateItem(index, { name: event.target.value })}
              />
              <input
                placeholder={t("env.paramValue")}
                value={item.value}
                onChange={(event) => updateItem(index, { value: event.target.value })}
              />
              {isPlaceholder ? (
                <span aria-hidden="true" />
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="env-table-remove"
                      aria-label={t("env.deleteParam")}
                      onClick={() => replaceCurrent(current.filter((_, i) => i !== index))}
                    >
                      <Trash2 />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("common.delete")}</TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** 鉴权类型选项；后端目前支持 bearer / basic / api-key */
const AUTH_TYPES: { key: AuthType; labelKey: string }[] = [
  { key: "none", labelKey: "env.authNone" },
  { key: "api-key", labelKey: "env.authApiKey" },
  { key: "bearer", labelKey: "env.authBearer" },
  { key: "basic", labelKey: "env.authBasic" },
];

/** 环境鉴权编辑器：类型下拉 + 对应字段，字段值支持 {{变量}} */
function AuthEditor({
  value,
  onChange,
}: {
  value: AuthConfig;
  onChange: (auth: AuthConfig) => void;
}) {
  const patch = (p: Partial<AuthConfig>) => onChange({ ...value, ...p });
  // 显式关联 label 与控件，不依赖 Radix 内部渲染结构
  const fid = useId();
  return (
    <div className="env-auth">
      <label className="env-auth-field" htmlFor={`${fid}-type`}>
        <span>{t("env.authType")}</span>
        <Select
          value={value.authType}
          onValueChange={(authType) => patch({ authType: authType as AuthType })}
        >
          <SelectTrigger id={`${fid}-type`} className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTH_TYPES.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {t(item.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {value.authType === "bearer" && (
        <label className="env-auth-field" htmlFor={`${fid}-token`}>
          <span>Token</span>
          <Input
            id={`${fid}-token`}
            value={value.token ?? ""}
            placeholder={t("env.authValuePlaceholder")}
            onChange={(event) => patch({ token: event.target.value })}
          />
        </label>
      )}
      {value.authType === "basic" && (
        <>
          <label className="env-auth-field" htmlFor={`${fid}-username`}>
            <span>{t("env.authUsername")}</span>
            <Input
              id={`${fid}-username`}
              value={value.username ?? ""}
              onChange={(event) => patch({ username: event.target.value })}
            />
          </label>
          <label className="env-auth-field" htmlFor={`${fid}-password`}>
            <span>{t("env.authPassword")}</span>
            <Input
              id={`${fid}-password`}
              value={value.password ?? ""}
              placeholder={t("env.authValuePlaceholder")}
              onChange={(event) => patch({ password: event.target.value })}
            />
          </label>
        </>
      )}
      {value.authType === "api-key" && (
        <>
          <label className="env-auth-field" htmlFor={`${fid}-key`}>
            <span>Key</span>
            <Input
              id={`${fid}-key`}
              value={value.key ?? ""}
              placeholder="X-API-Key"
              onChange={(event) => patch({ key: event.target.value })}
            />
          </label>
          <label className="env-auth-field" htmlFor={`${fid}-value`}>
            <span>Value</span>
            <Input
              id={`${fid}-value`}
              value={value.value ?? ""}
              placeholder={t("env.authValuePlaceholder")}
              onChange={(event) => patch({ value: event.target.value })}
            />
          </label>
          <label className="env-auth-field" htmlFor={`${fid}-addto`}>
            <span>{t("env.authAddTo")}</span>
            <Select
              value={value.addTo ?? "header"}
              onValueChange={(addTo) => patch({ addTo: addTo as "header" | "query" })}
            >
              <SelectTrigger id={`${fid}-addto`} className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="query">Query</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </>
      )}
    </div>
  );
}

export default EnvironmentModal;
