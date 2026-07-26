import { useEffect, useState, type ReactNode } from "react";
import { Input, InputNumber, Modal, Radio, Select, Slider, Switch } from "@arco-design/web-react";
import {
  IconClose,
  IconCommand,
  IconInfoCircle,
  IconLanguage,
  IconPublic,
  IconSettings,
  IconSkin,
} from "@arco-design/web-react/icon";
import { getVersion } from "@tauri-apps/api/app";
import { usePersistentState } from "../hooks/usePersistentState";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from "../lib/settings";
import type { AppSettings } from "../types/settings";
import "./SettingsModal.css";

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

type SectionKey = "appearance" | "language" | "general" | "shortcuts" | "proxy" | "about";

const SECTIONS: { key: SectionKey; label: string; icon: ReactNode }[] = [
  { key: "appearance", label: "外观", icon: <IconSkin /> },
  { key: "language", label: "语言", icon: <IconLanguage /> },
  { key: "general", label: "通用", icon: <IconSettings /> },
  { key: "shortcuts", label: "快捷键", icon: <IconCommand /> },
  { key: "proxy", label: "代理", icon: <IconPublic /> },
  { key: "about", label: "关于", icon: <IconInfoCircle /> },
];

const SHORTCUTS: { name: string; keys: string[]; planned?: boolean }[] = [
  { name: "关闭弹窗 / 面板", keys: ["Esc"] },
  { name: "发送请求", keys: ["⌘", "↩"], planned: true },
  { name: "新建项目", keys: ["⌘", "N"], planned: true },
  { name: "关闭当前项目标签", keys: ["⌘", "W"], planned: true },
];

function SettingsModal({ visible, onClose }: SettingsModalProps) {
  const [section, setSection] = useState<SectionKey>("appearance");
  const [stored, setStored] = usePersistentState<AppSettings>(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS);
  const [version, setVersion] = useState("");

  // 与默认值合并，兼容旧版本存储缺失的字段
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...stored };
  const update = (patch: Partial<AppSettings>) => setStored({ ...settings, ...patch });

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  // 界面缩放：组件常驻挂载于 TitleBar，启动即生效
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.style.zoom = settings.uiScale === 100 ? "" : `${settings.uiScale}%`;
  }, [settings.uiScale]);

  const activeSection = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      closable={false}
      autoFocus={false}
      className="settings-modal"
      style={{ width: 760 }}
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          <span className="settings-nav-group">偏好设置</span>
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`settings-nav-item${section === item.key ? " settings-nav-item-active" : ""}`}
              onClick={() => setSection(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <header className="settings-content-header">
            <h2 className="settings-content-title">{activeSection.label}</h2>
            <button type="button" className="settings-close" title="关闭" aria-label="关闭" onClick={onClose}>
              <IconClose />
            </button>
          </header>

          <div className="settings-content-body">
            {section === "appearance" && (
              <>
                <div className="settings-field">
                  <span className="settings-field-label">主题</span>
                  <div className="settings-theme-list" role="radiogroup" aria-label="主题">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={settings.themeMode === "light"}
                      className={`settings-theme-card${settings.themeMode === "light" ? " settings-theme-card-selected" : ""}`}
                      onClick={() => update({ themeMode: "light" })}
                    >
                      <span className="settings-theme-preview settings-theme-preview-light">
                        <span className="settings-theme-preview-side" />
                        <span className="settings-theme-preview-main">
                          <span />
                          <span />
                          <span />
                        </span>
                      </span>
                      <span className="settings-theme-name">浅色</span>
                    </button>
                    <button type="button" role="radio" aria-checked={false} className="settings-theme-card" disabled>
                      <span className="settings-theme-preview settings-theme-preview-dark">
                        <span className="settings-theme-preview-side" />
                        <span className="settings-theme-preview-main">
                          <span />
                          <span />
                          <span />
                        </span>
                      </span>
                      <span className="settings-theme-name">深色</span>
                      <span className="settings-theme-badge">开发中</span>
                    </button>
                  </div>
                </div>

                <div className="settings-field">
                  <span className="settings-field-label">界面缩放</span>
                  <div className="settings-slider-wrap">
                    <Slider
                      value={settings.uiScale}
                      min={80}
                      max={120}
                      step={10}
                      marks={{ 80: "80%", 90: "90%", 100: "100%", 110: "110%", 120: "120%" }}
                      onChange={(value) => update({ uiScale: value as number })}
                    />
                  </div>
                </div>
              </>
            )}

            {section === "language" && (
              <div className="settings-field">
                <span className="settings-field-label">界面语言</span>
                <Select
                  value={settings.language}
                  style={{ width: 240 }}
                  onChange={(value) => update({ language: value as AppSettings["language"] })}
                >
                  <Select.Option value="zh-CN">简体中文</Select.Option>
                  <Select.Option value="en-US" disabled>
                    English（开发中）
                  </Select.Option>
                </Select>
                <span className="settings-hint">当前版本界面仅提供简体中文，英文界面正在开发中。</span>
              </div>
            )}

            {section === "general" && (
              <>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <span className="settings-row-label">启动时恢复项目</span>
                    <span className="settings-row-desc">打开应用时恢复上次打开的项目标签页</span>
                  </div>
                  <Switch checked={settings.restoreTabs} onChange={(value) => update({ restoreTabs: value })} />
                </div>

                <div className="settings-row">
                  <div className="settings-row-text">
                    <span className="settings-row-label">请求超时</span>
                    <span className="settings-row-desc">发送请求的最长等待时间，0 表示不限制</span>
                  </div>
                  <InputNumber
                    value={settings.requestTimeout}
                    min={0}
                    max={600}
                    suffix="秒"
                    style={{ width: 120 }}
                    onChange={(value) => update({ requestTimeout: typeof value === "number" ? value : 0 })}
                  />
                </div>
              </>
            )}

            {section === "shortcuts" && (
              <div className="settings-shortcuts">
                {SHORTCUTS.map((item) => (
                  <div key={item.name} className={`settings-shortcut${item.planned ? " settings-shortcut-planned" : ""}`}>
                    <span className="settings-shortcut-name">
                      {item.name}
                      {item.planned && <span className="settings-shortcut-tag">规划中</span>}
                    </span>
                    <span className="settings-shortcut-keys">
                      {item.keys.map((key) => (
                        <kbd key={key} className="settings-kbd">
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {section === "proxy" && (
              <>
                <div className="settings-field">
                  <span className="settings-field-label">代理模式</span>
                  <Radio.Group
                    direction="vertical"
                    value={settings.proxyMode}
                    onChange={(value) => update({ proxyMode: value as AppSettings["proxyMode"] })}
                  >
                    <Radio value="none">不使用代理</Radio>
                    <Radio value="system">使用系统代理</Radio>
                    <Radio value="custom">自定义代理</Radio>
                  </Radio.Group>
                </div>

                {settings.proxyMode === "custom" && (
                  <>
                    <div className="settings-field">
                      <span className="settings-field-label">服务器地址</span>
                      <Input
                        value={settings.proxyUrl}
                        placeholder="http://127.0.0.1:7890"
                        style={{ width: 320 }}
                        onChange={(value) => update({ proxyUrl: value })}
                      />
                    </div>
                    <div className="settings-field">
                      <span className="settings-field-label">排除列表</span>
                      <Input
                        value={settings.proxyBypass}
                        placeholder="localhost, 127.0.0.1"
                        style={{ width: 320 }}
                        onChange={(value) => update({ proxyBypass: value })}
                      />
                      <span className="settings-hint">这些地址不走代理，多个地址用逗号分隔。</span>
                    </div>
                  </>
                )}

                <span className="settings-hint">代理配置会保存在本地，将在请求发送能力上线后生效。</span>
              </>
            )}

            {section === "about" && (
              <div className="settings-about">
                <span className="settings-about-mark">ApiRune</span>
                <span className="settings-about-slogan">轻量的 API 调试与管理工具</span>
                <div className="settings-about-rows">
                  <div className="settings-about-row">
                    <span>版本</span>
                    <span>{version || "…"}</span>
                  </div>
                  <div className="settings-about-row">
                    <span>运行框架</span>
                    <span>Tauri 2 · React 19</span>
                  </div>
                  <div className="settings-about-row">
                    <span>数据存储</span>
                    <span>本地 SQLite</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default SettingsModal;
