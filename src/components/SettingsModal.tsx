import { getVersion } from "@tauri-apps/api/app";
import { Command, Globe, Info, Languages, Palette, RotateCcw, Settings, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { usePersistentState } from "../hooks/usePersistentState";
import { type Language, setLanguage, useI18n } from "../i18n";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from "../lib/settings";
import {
  comboFromEvent,
  DEFAULT_SHORTCUTS,
  formatCombo,
  hasModifier,
  SHORTCUT_GROUPS,
  SHORTCUT_STORAGE_KEY,
  setShortcutRecording,
} from "../lib/shortcuts";
import {
  applyAppearance,
  FONT_PROBES,
  listFontFamilies,
  MONO_FONTS,
  type SystemFontFamily,
  THEMES,
  UI_FONTS,
} from "../lib/themes";
import type { AppSettings } from "../types/settings";
import type { ShortcutAction, ShortcutConfig } from "../types/shortcuts";
import "./SettingsModal.css";

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

type SectionKey = "appearance" | "language" | "general" | "shortcuts" | "proxy" | "about";

const SECTIONS: { key: SectionKey; labelKey: string; icon: ReactNode }[] = [
  { key: "appearance", labelKey: "settings.appearance", icon: <Palette /> },
  { key: "language", labelKey: "settings.language", icon: <Languages /> },
  { key: "general", labelKey: "settings.general", icon: <Settings /> },
  { key: "shortcuts", labelKey: "settings.shortcuts", icon: <Command /> },
  { key: "proxy", labelKey: "settings.proxy", icon: <Globe /> },
  { key: "about", labelKey: "settings.about", icon: <Info /> },
];

const UI_SCALE_MARKS = [80, 90, 100, 110, 120];

function SettingsModal({ visible, onClose }: SettingsModalProps) {
  const { t } = useI18n();
  // 显式关联 label 与控件，不依赖 Radix 内部渲染结构
  const fid = useId();
  const [section, setSection] = useState<SectionKey>("appearance");
  const [stored, setStored] = usePersistentState<AppSettings>(
    SETTINGS_STORAGE_KEY,
    DEFAULT_SETTINGS,
  );
  const [storedShortcuts, setStoredShortcuts] = usePersistentState<ShortcutConfig>(
    SHORTCUT_STORAGE_KEY,
    DEFAULT_SHORTCUTS,
  );
  // 当前处于录制状态的动作，null 表示未在录制
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [version, setVersion] = useState("");
  // 系统字体列表：打开设置时扫描，按当前语言探测字符缓存，失败仅保留内置预设
  const [fontFamilies, setFontFamilies] = useState<SystemFontFamily[]>([]);
  const loadedProbeRef = useRef<string | null>(null);

  // 与默认值合并，兼容旧版本存储缺失的字段
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...stored };
  const update = (patch: Partial<AppSettings>) => setStored({ ...settings, ...patch });

  const shortcuts: ShortcutConfig = {
    ...DEFAULT_SHORTCUTS,
    ...storedShortcuts,
    bindings: { ...DEFAULT_SHORTCUTS.bindings, ...storedShortcuts.bindings },
  };

  const stopRecording = () => {
    setRecordingAction(null);
    setShortcutRecording(false);
  };

  const startRecording = (action: ShortcutAction) => {
    setRecordingAction(action);
    setShortcutRecording(true);
  };

  /** 录制中的按键：Esc 取消，⌦ 清除，其余尝试写入绑定 */
  const recordShortcut = (action: ShortcutAction, event: ReactKeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setStoredShortcuts({ ...shortcuts, bindings: { ...shortcuts.bindings, [action]: "" } });
      stopRecording();
      return;
    }
    const combo = comboFromEvent(event.nativeEvent);
    if (combo == null) return; // 仅按下修饰键，继续等待
    if (!hasModifier(combo)) {
      toast.warning(t("settings.needModifier"));
      return;
    }
    const conflict = (Object.entries(shortcuts.bindings) as [ShortcutAction, string][]).find(
      ([key, bound]) => key !== action && bound === combo,
    );
    if (conflict) {
      toast.warning(t("settings.conflict", { name: t(`shortcuts.${conflict[0]}`) }));
      return;
    }
    setStoredShortcuts({ ...shortcuts, bindings: { ...shortcuts.bindings, [action]: combo } });
    stopRecording();
  };

  const resetShortcuts = () => {
    setStoredShortcuts({ ...shortcuts, bindings: { ...DEFAULT_SHORTCUTS.bindings } });
    toast.success(t("settings.shortcutsReset"));
  };

  // 弹窗关闭或切换分类时退出录制，避免全局监听一直处于暂停状态
  // biome-ignore lint/correctness/useExhaustiveDependencies: 需由 visible/section 变化触发，stopRecording 不应进入依赖
  useEffect(() => {
    stopRecording();
    return () => setShortcutRecording(false);
  }, [visible, section]);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.1.0"));
  }, []);

  useEffect(() => {
    const probe = FONT_PROBES[settings.language] ?? FONT_PROBES["zh-CN"];
    if (!visible || loadedProbeRef.current === probe) return;
    listFontFamilies(probe)
      .then((list) => {
        loadedProbeRef.current = probe;
        setFontFamilies(list);
      })
      .catch((error) => console.error("获取系统字体失败:", error));
  }, [visible, settings.language]);

  // 界面缩放：组件常驻挂载于 TitleBar，启动即生效
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.style.zoom = settings.uiScale === 100 ? "" : `${settings.uiScale}%`;
  }, [settings.uiScale]);

  // 主题与字体：变更即时应用到文档根节点
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyAppearance 仅取 theme/uiFont/monoFont，依赖已完整
  useEffect(() => {
    applyAppearance(settings);
  }, [settings.theme, settings.uiFont, settings.monoFont]);

  const activeSection = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="settings-modal gap-0 p-0 sm:max-w-[760px]"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t("settings.navAria")}>
            <span className="settings-nav-group">{t("settings.navGroup")}</span>
            {SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`settings-nav-item${section === item.key ? " settings-nav-item-active" : ""}`}
                onClick={() => setSection(item.key)}
              >
                {item.icon}
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            <header className="settings-content-header">
              <h2 className="settings-content-title">{t(activeSection.labelKey)}</h2>
              <button
                type="button"
                className="settings-close"
                title={t("common.close")}
                aria-label={t("common.close")}
                onClick={onClose}
              >
                <X />
              </button>
            </header>

            <div className="settings-content-body">
              {section === "appearance" && (
                <>
                  <div className="settings-field">
                    <span className="settings-field-label">{t("settings.theme")}</span>
                    <div
                      className="settings-theme-list"
                      role="radiogroup"
                      aria-label={t("settings.theme")}
                    >
                      {THEMES.map((theme) => (
                        <button
                          key={theme.id}
                          type="button"
                          role="radio"
                          aria-checked={settings.theme === theme.id}
                          className={`settings-theme-card${settings.theme === theme.id ? " settings-theme-card-selected" : ""}`}
                          onClick={() => update({ theme: theme.id })}
                        >
                          <span
                            className="settings-theme-preview"
                            style={{
                              backgroundColor: theme.preview.canvas,
                              borderColor: theme.preview.line,
                            }}
                          >
                            <span
                              className="settings-theme-preview-side"
                              style={{ backgroundColor: theme.preview.side }}
                            />
                            <span className="settings-theme-preview-main">
                              <span style={{ backgroundColor: theme.preview.accent }} />
                              <span style={{ backgroundColor: theme.preview.line }} />
                              <span style={{ backgroundColor: theme.preview.line }} />
                            </span>
                          </span>
                          <span className="settings-theme-name">{t(`theme.${theme.id}`)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-field">
                    <span className="settings-field-label">{t("settings.uiFont")}</span>
                    <Select
                      value={settings.uiFont}
                      onValueChange={(value) => update({ uiFont: value })}
                    >
                      <SelectTrigger className="w-[240px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>{t("settings.builtin")}</SelectLabel>
                          {UI_FONTS.map((font) => (
                            <SelectItem
                              key={font.id}
                              value={font.id}
                              style={{ fontFamily: font.stack }}
                            >
                              {t(`font.${font.id}`)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        {fontFamilies.some((font) => font.supportsText) && (
                          <SelectGroup>
                            <SelectLabel>{t("settings.systemFonts")}</SelectLabel>
                            {fontFamilies
                              .filter((font) => font.supportsText)
                              .map((font) => (
                                <SelectItem
                                  key={font.name}
                                  value={font.name}
                                  style={{ fontFamily: `"${font.name}"` }}
                                >
                                  {font.name}
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="settings-field">
                    <span className="settings-field-label">{t("settings.monoFont")}</span>
                    <Select
                      value={settings.monoFont}
                      onValueChange={(value) => update({ monoFont: value })}
                    >
                      <SelectTrigger className="w-[240px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>{t("settings.builtin")}</SelectLabel>
                          {MONO_FONTS.map((font) => (
                            <SelectItem
                              key={font.id}
                              value={font.id}
                              style={{ fontFamily: font.stack }}
                            >
                              {font.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        {fontFamilies.some((font) => font.monospaced) && (
                          <SelectGroup>
                            <SelectLabel>{t("settings.systemMonoFonts")}</SelectLabel>
                            {fontFamilies
                              .filter((font) => font.monospaced)
                              .map((font) => (
                                <SelectItem
                                  key={font.name}
                                  value={font.name}
                                  style={{ fontFamily: `"${font.name}"` }}
                                >
                                  {font.name}
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="settings-field">
                    <span className="settings-field-label">{t("settings.uiScale")}</span>
                    <div className="settings-slider-wrap">
                      <Slider
                        value={[settings.uiScale]}
                        min={80}
                        max={120}
                        step={10}
                        onValueChange={([value]) => update({ uiScale: value })}
                      />
                      <div className="settings-slider-marks" aria-hidden="true">
                        {UI_SCALE_MARKS.map((mark) => (
                          <span key={mark}>{mark}%</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {section === "language" && (
                <div className="settings-field">
                  <span className="settings-field-label">{t("settings.uiLanguage")}</span>
                  <Select
                    value={settings.language}
                    onValueChange={(value) => {
                      update({ language: value as AppSettings["language"] });
                      setLanguage(value as Language);
                    }}
                  >
                    <SelectTrigger className="w-[240px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zh-CN">简体中文</SelectItem>
                      <SelectItem value="en-US">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {section === "general" && (
                <>
                  <div className="settings-group">
                    <span className="settings-group-title">{t("settings.startup")}</span>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">{t("settings.restoreTabs")}</span>
                        <span className="settings-row-desc">{t("settings.restoreTabsDesc")}</span>
                      </div>
                      <Switch
                        checked={settings.restoreTabs}
                        onCheckedChange={(value) => update({ restoreTabs: value })}
                      />
                    </div>
                  </div>

                  <div className="settings-group">
                    <span className="settings-group-title">{t("settings.request")}</span>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">{t("settings.timeout")}</span>
                        <span className="settings-row-desc">{t("settings.timeoutDesc")}</span>
                      </div>
                      <div className="settings-number">
                        <Input
                          type="number"
                          min={0}
                          max={3_600_000}
                          placeholder="300000"
                          value={settings.requestTimeoutMs}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            update({
                              requestTimeoutMs: Number.isFinite(value)
                                ? Math.min(3_600_000, Math.max(0, Math.floor(value)))
                                : 0,
                            });
                          }}
                        />
                        <span className="settings-number-suffix">{t("settings.ms")}</span>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">{t("settings.sslVerify")}</span>
                        <span className="settings-row-desc">{t("settings.sslVerifyDesc")}</span>
                      </div>
                      <Switch
                        checked={settings.sslVerify}
                        onCheckedChange={(value) => update({ sslVerify: value })}
                      />
                    </div>
                  </div>

                  <div className="settings-group">
                    <span className="settings-group-title">Headers</span>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">{t("settings.followRedirects")}</span>
                        <span className="settings-row-desc">
                          {t("settings.followRedirectsDesc")}
                        </span>
                      </div>
                      <Switch
                        checked={settings.followRedirects}
                        onCheckedChange={(value) => update({ followRedirects: value })}
                      />
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">{t("settings.noCache")}</span>
                        <span className="settings-row-desc">{t("settings.noCacheDesc")}</span>
                      </div>
                      <Switch
                        checked={settings.noCacheHeader}
                        onCheckedChange={(value) => update({ noCacheHeader: value })}
                      />
                    </div>
                  </div>
                </>
              )}

              {section === "shortcuts" && (
                <div className="settings-shortcuts">
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <span className="settings-row-label">{t("settings.keyboardShortcuts")}</span>
                      <span className="settings-row-desc">
                        {t("settings.keyboardShortcutsDesc")}
                      </span>
                    </div>
                    <div className="settings-shortcuts-actions">
                      <button
                        type="button"
                        className="settings-shortcuts-reset"
                        onClick={resetShortcuts}
                      >
                        <RotateCcw />
                        {t("settings.resetDefaults")}
                      </button>
                      <Switch
                        checked={shortcuts.enabled}
                        onCheckedChange={(value) =>
                          setStoredShortcuts({ ...shortcuts, enabled: value })
                        }
                      />
                    </div>
                  </div>

                  {SHORTCUT_GROUPS.map((group) => (
                    <div key={group.key} className="settings-shortcut-group">
                      <span className="settings-shortcut-group-title">
                        {t(`shortcuts.group.${group.key}`)}
                      </span>
                      {group.items.map((action) => {
                        const combo = shortcuts.bindings[action];
                        const recording = recordingAction === action;
                        return (
                          <div key={action} className="settings-shortcut">
                            <span className="settings-shortcut-name">
                              {t(`shortcuts.${action}`)}
                            </span>
                            <button
                              type="button"
                              className={`settings-shortcut-btn${recording ? " settings-shortcut-btn-recording" : ""}`}
                              disabled={!shortcuts.enabled}
                              onClick={() => !recording && startRecording(action)}
                              onKeyDown={(event) => recording && recordShortcut(action, event)}
                              onBlur={() => recording && stopRecording()}
                            >
                              {recording ? (
                                <span className="settings-shortcut-hint">
                                  {t("settings.recording")}
                                </span>
                              ) : combo ? (
                                formatCombo(combo).map((key, index) => (
                                  <kbd key={`${key}-${index}`} className="settings-kbd">
                                    {key}
                                  </kbd>
                                ))
                              ) : (
                                <span className="settings-shortcut-hint">
                                  {t("settings.clickToSet")}
                                </span>
                              )}
                            </button>
                          </div>
                        );
                      })}
                      {group.key === "tabs" && (
                        <div className="settings-shortcut settings-shortcut-planned">
                          <span className="settings-shortcut-name">
                            {t("settings.gotoTab")}
                            <span className="settings-shortcut-tag">{t("settings.fixedTag")}</span>
                          </span>
                          <span className="settings-shortcut-keys">
                            <kbd className="settings-kbd">⌘</kbd>
                            <kbd className="settings-kbd">1</kbd>
                            <span className="settings-shortcut-sep">{t("settings.to")}</span>
                            <kbd className="settings-kbd">⌘</kbd>
                            <kbd className="settings-kbd">9</kbd>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {section === "proxy" && (
                <>
                  <div className="settings-field">
                    <span className="settings-field-label">{t("settings.proxyMode")}</span>
                    <RadioGroup
                      className="flex items-center gap-6"
                      value={settings.proxyMode}
                      onValueChange={(value) =>
                        update({ proxyMode: value as AppSettings["proxyMode"] })
                      }
                    >
                      <label className="settings-radio" htmlFor={`${fid}-proxy-system`}>
                        <RadioGroupItem id={`${fid}-proxy-system`} value="system" />
                        <span>{t("settings.proxySystem")}</span>
                      </label>
                      <label className="settings-radio" htmlFor={`${fid}-proxy-none`}>
                        <RadioGroupItem id={`${fid}-proxy-none`} value="none" />
                        <span>{t("settings.proxyNone")}</span>
                      </label>
                      <label className="settings-radio" htmlFor={`${fid}-proxy-custom`}>
                        <RadioGroupItem id={`${fid}-proxy-custom`} value="custom" />
                        <span>{t("settings.proxyCustom")}</span>
                      </label>
                    </RadioGroup>
                  </div>

                  {settings.proxyMode === "custom" && (
                    <>
                      <div className="settings-field">
                        <span className="settings-field-label">{t("settings.proxyTypes")}</span>
                        <div className="settings-proxy-types">
                          <label className="settings-checkbox">
                            <input
                              type="checkbox"
                              checked={settings.proxyForHttp}
                              onChange={(event) => update({ proxyForHttp: event.target.checked })}
                            />
                            <span>HTTP</span>
                          </label>
                          <label className="settings-checkbox">
                            <input
                              type="checkbox"
                              checked={settings.proxyForHttps}
                              onChange={(event) => update({ proxyForHttps: event.target.checked })}
                            />
                            <span>HTTPS</span>
                          </label>
                        </div>
                      </div>

                      <div className="settings-field">
                        <span className="settings-field-label">{t("settings.proxyServer")}</span>
                        <div className="settings-proxy-server">
                          <Select
                            value={settings.proxyProtocol}
                            onValueChange={(value) =>
                              update({ proxyProtocol: value as AppSettings["proxyProtocol"] })
                            }
                          >
                            <SelectTrigger className="w-[92px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="http">http</SelectItem>
                              <SelectItem value="https">https</SelectItem>
                            </SelectContent>
                          </Select>
                          <span className="settings-proxy-sep">://</span>
                          <Input
                            value={settings.proxyHost}
                            placeholder="127.0.0.1"
                            className="w-[180px]"
                            onChange={(event) => update({ proxyHost: event.target.value })}
                          />
                          <span className="settings-proxy-sep">:</span>
                          <Input
                            value={settings.proxyPort}
                            placeholder="7890"
                            className="w-[80px]"
                            onChange={(event) =>
                              update({ proxyPort: event.target.value.replace(/[^0-9]/g, "") })
                            }
                          />
                        </div>
                      </div>

                      <div className="settings-field">
                        <div className="settings-proxy-auth">
                          <span className="settings-field-label">{t("settings.proxyAuth")}</span>
                          <Switch
                            checked={settings.proxyAuthEnabled}
                            onCheckedChange={(value) => update({ proxyAuthEnabled: value })}
                          />
                        </div>
                        {settings.proxyAuthEnabled && (
                          <div className="settings-proxy-server">
                            <Input
                              value={settings.proxyUsername}
                              placeholder={t("settings.username")}
                              className="w-[180px]"
                              onChange={(event) => update({ proxyUsername: event.target.value })}
                            />
                            <Input
                              type="password"
                              value={settings.proxyPassword}
                              placeholder={t("settings.password")}
                              className="w-[180px]"
                              onChange={(event) => update({ proxyPassword: event.target.value })}
                            />
                          </div>
                        )}
                      </div>

                      <div className="settings-field">
                        <span className="settings-field-label">{t("settings.bypassList")}</span>
                        <Input
                          value={settings.proxyBypass}
                          placeholder="127.0.0.1, localhost, example.com"
                          className="w-[400px]"
                          onChange={(event) => update({ proxyBypass: event.target.value })}
                        />
                        <span className="settings-hint">{t("settings.bypassHint")}</span>
                      </div>
                    </>
                  )}

                  <span className="settings-hint">{t("settings.proxyHint")}</span>
                </>
              )}

              {section === "about" && (
                <div className="settings-about">
                  <span className="settings-about-mark">ApiRune</span>
                  <span className="settings-about-slogan">{t("settings.aboutSlogan")}</span>
                  <div className="settings-about-rows">
                    <div className="settings-about-row">
                      <span>{t("settings.version")}</span>
                      <span>{version || "…"}</span>
                    </div>
                    <div className="settings-about-row">
                      <span>{t("settings.framework")}</span>
                      <span>Tauri 2 · React 19</span>
                    </div>
                    <div className="settings-about-row">
                      <span>{t("settings.storage")}</span>
                      <span>{t("settings.storageValue")}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsModal;
