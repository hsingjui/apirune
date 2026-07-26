import { useState } from "react";
import { Button, Input, Message, Select } from "@arco-design/web-react";
import { IconDelete, IconDown, IconSend } from "@arco-design/web-react/icon";
import { sendHttpRequest } from "../lib/http";
import type { HttpResponseData } from "../types/http";
import type { HttpMethod } from "../types/request";
import "./RequestEditor.css";

/** 请求方法及其标识色（取自 Arco 色板，与项目图标用色一致） */
const METHODS: { value: string; color: string }[] = [
  { value: "GET", color: "#00b42a" },
  { value: "POST", color: "#ff7d00" },
  { value: "PUT", color: "#165dff" },
  { value: "PATCH", color: "#722ed1" },
  { value: "DELETE", color: "#f53f3f" },
  { value: "HEAD", color: "#0fc6c2" },
  { value: "OPTIONS", color: "#86909c" },
];

const EDITOR_TABS = ["Params", "Body", "Headers", "Cookies", "Auth", "设置"] as const;

interface QueryParam {
  key: string;
  value: string;
}

/** 快捷请求编辑器：请求行 + 参数配置页签 + 返回响应区，发送能力后续接入 */
function RequestEditor() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [activeTab, setActiveTab] = useState<(typeof EDITOR_TABS)[number]>("Params");
  const [params, setParams] = useState<QueryParam[]>([]);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<HttpResponseData | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);

  const methodColor = METHODS.find((entry) => entry.value === method)?.color ?? "#86909c";

  /** 编辑第 index 行；编辑末尾占位行时自动追加为新参数 */
  const updateParam = (index: number, field: keyof QueryParam, value: string) => {
    if (index === params.length) {
      setParams([...params, { key: "", value: "", [field]: value }]);
      return;
    }
    setParams(params.map((param, i) => (i === index ? { ...param, [field]: value } : param)));
  };

  const removeParam = (index: number) => {
    setParams(params.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!url.trim()) {
      Message.warning("请先输入请求 URL");
      return;
    }
    setSending(true);
    setResponse(null);
    setResponseError(null);
    try {
      const result = await sendHttpRequest({
        method: method as HttpMethod,
        url: url.trim(),
        params: params
          .filter((param) => param.key)
          .map((param) => ({ ...param, enabled: true })),
      });
      setResponse(result);
    } catch (error) {
      setResponseError(String(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="request-editor">
      {/* 请求行：方法 + URL + 操作按钮 */}
      <div className="request-line">
        <div className="request-url-group">
          <Select
            className="request-method"
            value={method}
            onChange={(value) => setMethod(value as string)}
            triggerProps={{ autoAlignPopupWidth: false }}
            arrowIcon={<IconDown />}
          >
            {METHODS.map((entry) => (
              <Select.Option key={entry.value} value={entry.value}>
                <span className="request-method-text" style={{ color: entry.color }}>
                  {entry.value}
                </span>
              </Select.Option>
            ))}
          </Select>
          <Input
            className="request-url"
            placeholder="输入 http 或 https 起始的完整 URL"
            value={url}
            onChange={setUrl}
            style={{ ["--request-method-color" as string]: methodColor }}
          />
        </div>
        <Button type="primary" icon={<IconSend />} loading={sending} onClick={handleSend}>
          发送
        </Button>
        <Button onClick={() => Message.info("保存功能建设中")}>保存</Button>
      </div>

      {/* 配置页签 */}
      <nav className="request-tabs" role="tablist">
        {EDITOR_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`request-tab${activeTab === tab ? " request-tab-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {tab === "Params" && params.length > 0 && <span className="request-tab-count">{params.length}</span>}
          </button>
        ))}
      </nav>

      {/* 页签内容 */}
      <div className="request-panel">
        {activeTab === "Params" ? (
          <section className="request-params">
            <h4 className="request-params-title">Query 参数</h4>
            <div className="request-params-table">
              <div className="request-params-head">
                <span>参数名</span>
                <span>参数值</span>
                <span aria-hidden="true" />
              </div>
              {[...params, { key: "", value: "" }].map((param, index) => {
                const isPlaceholder = index === params.length;
                return (
                  <div key={index} className="request-params-row">
                    <Input
                      placeholder={isPlaceholder ? "添加参数" : "参数名"}
                      value={param.key}
                      onChange={(value) => updateParam(index, "key", value)}
                    />
                    <Input
                      placeholder="参数值"
                      value={param.value}
                      onChange={(value) => updateParam(index, "value", value)}
                    />
                    {isPlaceholder ? (
                      <span aria-hidden="true" />
                    ) : (
                      <button
                        type="button"
                        className="request-params-remove"
                        title="删除参数"
                        aria-label="删除参数"
                        onClick={() => removeParam(index)}
                      >
                        <IconDelete />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <div className="request-panel-placeholder">{activeTab} 配置建设中</div>
        )}
      </div>

      {/* 返回响应 */}
      <footer className="request-response">
        <div className="request-response-head">
          <h4 className="request-response-title">返回响应</h4>
          {response && (
            <span className="request-response-meta">
              <span
                className={`request-response-status${response.status < 400 ? " is-ok" : " is-fail"}`}
              >
                {response.status} {response.statusText}
              </span>
              <span>{response.durationMs} ms</span>
              <span>{formatSize(response.sizeBytes)}</span>
            </span>
          )}
        </div>
        {responseError ? (
          <pre className="request-response-body request-response-error">{responseError}</pre>
        ) : response ? (
          <pre className="request-response-body">{formatBody(response)}</pre>
        ) : (
          <span className="request-response-hint">
            {sending ? "请求发送中…" : "点击「发送」后，响应结果会展示在这里"}
          </span>
        )}
      </footer>
    </div>
  );
}

/** 响应体展示：JSON 响应做格式化，其余原样输出 */
function formatBody(response: HttpResponseData): string {
  const contentType = response.headers["content-type"] ?? "";
  if (contentType.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      // 非法 JSON 时原样展示
    }
  }
  return response.body;
}

/** 字节数转可读大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default RequestEditor;
