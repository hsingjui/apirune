//! 枚举系统已安装字体家族，供设置页字体选择使用。

use std::collections::BTreeMap;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    pub name: String,
    /// 该家族是否包含等宽字面，用于代码字体过滤
    pub monospaced: bool,
    /// 是否覆盖探测字符（即支持当前界面语言的文字），用于界面字体过滤
    pub supports_text: bool,
}

#[derive(Default)]
struct FamilyFlags {
    monospaced: bool,
    supports_text: bool,
}

/// 面数据中是否含探测串所有字符的字形
fn face_covers(db: &fontdb::Database, id: fontdb::ID, probe: &str) -> bool {
    db.with_face_data(id, |data, index| {
        ttf_parser::Face::parse(data, index)
            .map(|face| probe.chars().all(|ch| face.glyph_index(ch).is_some()))
            .unwrap_or(false)
    })
    .unwrap_or(false)
}

/// 扫描系统字体目录，返回筛选后的字体家族列表。
/// `probe` 为当前界面语言的探测字符（如中文用「永」）；
/// 仅保留对本应用有意义的家族：覆盖探测字符（界面字体）或等宽（代码字体）。
/// 扫描与字形解析开销较大，放到阻塞线程池执行，避免同步命令阻塞主线程卡住 UI。
#[tauri::command]
pub async fn list_font_families(probe: String) -> Vec<FontFamily> {
    tauri::async_runtime::spawn_blocking(move || scan_font_families(&probe))
        .await
        .unwrap_or_default()
}

fn scan_font_families(probe: &str) -> Vec<FontFamily> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    // 以家族名去重；任一字面命中即标记该家族
    let mut families: BTreeMap<String, FamilyFlags> = BTreeMap::new();
    for face in db.faces() {
        let Some((name, _)) = face.families.first() else {
            continue;
        };
        // 跳过 macOS 的隐藏系统字体（如 ".SF NS"）与 Emoji 字体
        if name.starts_with('.') || name.contains("Emoji") {
            continue;
        }
        let flags = families.entry(name.clone()).or_default();
        flags.monospaced |= face.monospaced;
        if !flags.supports_text && !probe.is_empty() {
            flags.supports_text = face_covers(&db, face.id, probe);
        }
    }

    let mut list: Vec<FontFamily> = families
        .into_iter()
        .filter(|(_, flags)| flags.supports_text || flags.monospaced)
        .map(|(name, flags)| FontFamily {
            name,
            monospaced: flags.monospaced,
            supports_text: flags.supports_text,
        })
        .collect();
    list.sort_by_key(|font| font.name.to_lowercase());
    list
}
