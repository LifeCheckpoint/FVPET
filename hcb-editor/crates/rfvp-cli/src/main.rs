//! rfvp-cli：无头 rfvp 运行器。
//!
//! 从 stdin 读行分隔 JSON 请求（hcb-editor 协议），向 stdout 写行分隔 JSON 事件。
//! 封装 `rfvp::portable::PortableRuntime`：boot 编译后的 HCB、tick VM、dump prim。
//! 文本队列仍由编辑器投影提供（PortableRuntime 只暴露 prim/线程状态）。

use std::collections::HashMap;
use std::io::{self, BufRead, Write};

use rfvp::host_api::{
    AudioParams, AudioStreamDesc, AudioStreamId, ColorRgba, DrawSolidCommand, DrawSpriteCommand,
    EncodedAudioKind, PointerButton, RfvpAudio, RfvpClock, RfvpEvent, RfvpFile, RfvpFileInfo,
    RfvpFileSystem, RfvpHost, RfvpLogLevel, RfvpRenderer, RfvpResult, TextureDesc, TextureId,
    TextureRect,
};
use rfvp::portable::{Nls, PortableRuntime, Variant};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// no-op host 实现：文件/音频/时钟都为空实现，渲染器只捕获 draw_solid 作为 prim。
// ---------------------------------------------------------------------------

struct CliFile {
    _data: Vec<u8>,
}

impl RfvpFile for CliFile {
    fn len(&mut self) -> RfvpResult<u64> {
        Ok(self._data.len() as u64)
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> RfvpResult<usize> {
        let start = offset as usize;
        if start >= self._data.len() {
            return Ok(0);
        }
        let n = buf.len().min(self._data.len() - start);
        buf[..n].copy_from_slice(&self._data[start..start + n]);
        Ok(n)
    }
}

struct CliFs;

impl RfvpFileSystem for CliFs {
    type File = CliFile;

    /// 编辑器预览没有游戏资源目录：任何资源路径都返回空文件（而非 NotFound），
    /// 让 GraphLoad / SoundLoad 等演出资源加载不再中断 VM。
    /// 预览渲染只按 prim 矩形与颜色绘制，资源字节内容不参与绘制。
    fn open(&mut self, path: &str) -> RfvpResult<Self::File> {
        eprintln!("[rfvp-cli] fs.open: {}", path);
        Ok(CliFile { _data: Vec::new() })
    }

    fn metadata(&mut self, path: &str) -> RfvpResult<RfvpFileInfo> {
        eprintln!("[rfvp-cli] fs.metadata: {}", path);
        Ok(RfvpFileInfo::file(0))
    }

    fn enumerate_by_extension(
        &mut self,
        root: &str,
        extension_without_dot: &str,
        _visitor: &mut dyn FnMut(&str, RfvpFileInfo) -> RfvpResult<()>,
    ) -> RfvpResult<()> {
        eprintln!(
            "[rfvp-cli] fs.enumerate: {} *.{}",
            root, extension_without_dot
        );
        Ok(())
    }
}

/// 每帧捕获的实心矩形：x, y, w, h, alpha。
struct CliRenderer {
    solids: Vec<(i32, i32, i32, i32, f32)>,
}

impl CliRenderer {
    fn new() -> Self {
        Self { solids: Vec::new() }
    }
}

impl RfvpRenderer for CliRenderer {
    fn create_texture(
        &mut self,
        _id: TextureId,
        _desc: TextureDesc,
        _pixels: Option<&[u8]>,
    ) -> RfvpResult<()> {
        Ok(())
    }

    fn update_texture(
        &mut self,
        _id: TextureId,
        _rect: TextureRect,
        _pixels: &[u8],
    ) -> RfvpResult<()> {
        Ok(())
    }

    fn destroy_texture(&mut self, _id: TextureId) {}

    fn begin_frame(
        &mut self,
        _width: u32,
        _height: u32,
        _clear: Option<ColorRgba>,
    ) -> RfvpResult<()> {
        self.solids.clear();
        Ok(())
    }

    fn draw_sprite(&mut self, _command: &DrawSpriteCommand) -> RfvpResult<()> {
        Ok(())
    }

    fn draw_solid(&mut self, command: &DrawSolidCommand) -> RfvpResult<()> {
        self.solids.push((
            command.rect.x,
            command.rect.y,
            command.rect.width,
            command.rect.height,
            command.color.a,
        ));
        Ok(())
    }

    fn end_frame(&mut self) -> RfvpResult<()> {
        Ok(())
    }

    fn present(&mut self) -> RfvpResult<()> {
        Ok(())
    }
}

struct CliAudio;

impl RfvpAudio for CliAudio {
    fn load_encoded(
        &mut self,
        _id: AudioStreamId,
        _kind: EncodedAudioKind,
        _bytes: &[u8],
    ) -> RfvpResult<()> {
        Ok(())
    }

    fn create_stream(&mut self, _id: AudioStreamId, _desc: AudioStreamDesc) -> RfvpResult<()> {
        Ok(())
    }

    fn submit_i16(&mut self, _id: AudioStreamId, _samples: &[i16]) -> RfvpResult<()> {
        Ok(())
    }

    fn submit_f32(&mut self, _id: AudioStreamId, _samples: &[f32]) -> RfvpResult<()> {
        Ok(())
    }

    fn play(
        &mut self,
        _id: AudioStreamId,
        _params: AudioParams,
        _fade_in_ms: u32,
    ) -> RfvpResult<()> {
        Ok(())
    }

    fn stop(&mut self, _id: AudioStreamId, _fade_ms: u32) -> RfvpResult<()> {
        Ok(())
    }

    fn pause(&mut self, _id: AudioStreamId) -> RfvpResult<()> {
        Ok(())
    }

    fn resume(&mut self, _id: AudioStreamId) -> RfvpResult<()> {
        Ok(())
    }

    fn set_params(&mut self, _id: AudioStreamId, _params: AudioParams) -> RfvpResult<()> {
        Ok(())
    }

    fn set_master_volume(&mut self, _volume: f32) -> RfvpResult<()> {
        Ok(())
    }

    fn destroy_stream(&mut self, _id: AudioStreamId) {}

    fn tick(&mut self, _delta_us: u64) -> RfvpResult<()> {
        Ok(())
    }
}

struct CliClock {
    ticks: u64,
}

impl RfvpClock for CliClock {
    fn ticks_us(&mut self) -> u64 {
        self.ticks += 16_000;
        self.ticks
    }
}

struct CliHost {
    fs: CliFs,
    renderer: CliRenderer,
    audio: CliAudio,
    clock: CliClock,
}

impl CliHost {
    fn new() -> Self {
        Self {
            fs: CliFs,
            renderer: CliRenderer::new(),
            audio: CliAudio,
            clock: CliClock { ticks: 0 },
        }
    }
}

impl RfvpHost for CliHost {
    type FileSystem = CliFs;
    type Renderer = CliRenderer;
    type Audio = CliAudio;
    type Clock = CliClock;

    fn fs(&mut self) -> &mut Self::FileSystem {
        &mut self.fs
    }

    fn renderer(&mut self) -> &mut Self::Renderer {
        &mut self.renderer
    }

    fn audio(&mut self) -> &mut Self::Audio {
        &mut self.audio
    }

    fn clock(&mut self) -> &mut Self::Clock {
        &mut self.clock
    }

    fn log(&mut self, level: RfvpLogLevel, message: &str) {
        eprintln!("[rfvp:{:?}] {}", level, message);
    }
}

// ---------------------------------------------------------------------------
// 协议
// ---------------------------------------------------------------------------

fn emit(value: &Value) {
    println!("{}", value);
    io::stdout().flush().ok();
}

fn emit_error(message: String) {
    emit(&json!({ "type": "error", "message": message }));
}

fn emit_audio_events(runtime: &mut PortableRuntime) {
    for (channel, action) in runtime.drain_audio_events() {
        emit(&json!({ "type": "audio", "channel": channel, "action": action }));
    }
}

fn emit_prims(host: &mut CliHost, runtime: &mut PortableRuntime) {
    let _ = runtime.render_frame(host, 0);
    let prims: Vec<Value> = host
        .renderer
        .solids
        .iter()
        .enumerate()
        .map(|(i, (x, y, w, h, a))| {
            json!({
                "id": i,
                "graphId": 0,
                "x": x,
                "y": y,
                "z": i,
                "alpha": a,
                "scale": 1,
                "rotate": 0,
                "blend": 0,
                "w": w,
                "h": h,
            })
        })
        .collect();
    emit(&json!({ "type": "prims", "prims": prims }));
}

fn nls_from_str(s: Option<&str>) -> Nls {
    match s {
        Some("gbk") => Nls::Gbk,
        Some("utf8") => Nls::Utf8,
        _ => Nls::ShiftJis,
    }
}

fn variant_to_json(value: &Variant) -> Value {
    match value {
        Variant::Nil => Value::Null,
        Variant::True => json!(true),
        Variant::Int(i) => json!(i),
        Variant::Float(f) => json!(f),
        Variant::String(s) | Variant::ConstString(s, _) => json!(s),
        _ => Value::Null,
    }
}

fn json_to_variant(value: &Value) -> Variant {
    match value {
        Value::Null => Variant::Nil,
        Value::Bool(b) => {
            if *b {
                Variant::True
            } else {
                Variant::Nil
            }
        }
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Variant::Int(i as i32)
            } else if let Some(f) = n.as_f64() {
                Variant::Float(f as f32)
            } else {
                Variant::Nil
            }
        }
        Value::String(s) => Variant::String(s.clone()),
        _ => Variant::Nil,
    }
}

fn main() {
    let stdin = io::stdin();
    let mut host = CliHost::new();
    let mut runtime: Option<PortableRuntime> = None;
    let mut labels: HashMap<String, u32> = HashMap::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                emit_error(format!("bad json: {}", e));
                continue;
            }
        };
        let op = req
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        match op.as_str() {
            "handshake" => {
                emit(&json!({ "type": "ready", "protocolVersion": 2 }));
            }
            "load" => {
                let path = req.get("hcbPath").and_then(Value::as_str).unwrap_or("");
                let nls = nls_from_str(req.get("nls").and_then(Value::as_str));
                match std::fs::read(path) {
                    Ok(bytes) => match PortableRuntime::boot_from_hcb_bytes(bytes, nls) {
                        Ok(mut rt) => {
                            // 导出 HCB 保留底座 sysdesc launcher 以兼容原引擎；嵌入式预览必须
                            // 显式跳到本次编译剧情函数，不能执行标题 / Logo 启动流程。
                            if let Some(script_entry) =
                                req.get("scriptEntry").and_then(Value::as_u64)
                            {
                                rt.jump_to(script_entry as u32);
                            }
                            let title = rt.title().to_string();
                            let (w, h) = rt.screen_size();
                            labels.clear();
                            if let Some(labels_obj) = req.get("labels").and_then(Value::as_object) {
                                for (name, addr) in labels_obj {
                                    if let Some(a) = addr.as_u64() {
                                        labels.insert(name.clone(), a as u32);
                                    }
                                }
                            }
                            runtime = Some(rt);
                            emit(&json!({
                                "type": "ready",
                                "protocolVersion": 2,
                                "title": title,
                                "screenSize": [w, h],
                            }));
                        }
                        Err(e) => emit_error(format!("boot failed: {:?}", e)),
                    },
                    Err(e) => emit_error(format!("read failed: {}", e)),
                }
            }
            "jump" => {
                let Some(rt) = runtime.as_mut() else {
                    emit_error("not loaded".to_string());
                    continue;
                };
                let label = req.get("label").and_then(Value::as_str).unwrap_or("");
                match labels.get(label) {
                    Some(addr) => {
                        rt.jump_to(*addr);
                        match rt.tick(&mut host, 16) {
                            Ok(_) => {
                                emit_prims(&mut host, rt);
                                emit_audio_events(rt);
                            }
                            Err(e) => emit_error(format!("tick failed: {:?}", e)),
                        }
                    }
                    None => emit_error(format!("unknown label: {}", label)),
                }
            }
            "get_g" => {
                let Some(rt) = runtime.as_ref() else {
                    emit_error("not loaded".to_string());
                    continue;
                };
                let index = req.get("index").and_then(Value::as_u64).unwrap_or(0) as u16;
                let value = variant_to_json(&rt.get_global(index));
                emit(&json!({ "type": "g", "index": index, "value": value }));
            }
            "set_g" => {
                let Some(rt) = runtime.as_mut() else {
                    emit_error("not loaded".to_string());
                    continue;
                };
                let index = req.get("index").and_then(Value::as_u64).unwrap_or(0) as u16;
                let value = json_to_variant(req.get("value").unwrap_or(&Value::Null));
                rt.set_global(index, value);
                let value = variant_to_json(&rt.get_global(index));
                emit(&json!({ "type": "g", "index": index, "value": value }));
            }
            "advance" | "step" => {
                let Some(rt) = runtime.as_mut() else {
                    emit_error("not loaded".to_string());
                    continue;
                };
                if op == "advance" {
                    rt.handle_event(RfvpEvent::PointerUp {
                        button: PointerButton::Left,
                        x: 0,
                        y: 0,
                    });
                }
                match rt.tick(&mut host, 16) {
                    Ok(report) => {
                        emit_prims(&mut host, rt);
                        emit_audio_events(rt);
                        if report.main_thread_exited {
                            emit(&json!({ "type": "done" }));
                        }
                    }
                    Err(e) => emit_error(format!("tick failed: {:?}", e)),
                }
            }
            "skip" => {
                let Some(rt) = runtime.as_mut() else {
                    emit_error("not loaded".to_string());
                    continue;
                };
                let mut done = false;
                for _ in 0..100_000 {
                    rt.handle_event(RfvpEvent::PointerUp {
                        button: PointerButton::Left,
                        x: 0,
                        y: 0,
                    });
                    match rt.tick(&mut host, 16) {
                        Ok(report) => {
                            if report.main_thread_exited {
                                done = true;
                                break;
                            }
                        }
                        Err(e) => {
                            emit_error(format!("tick failed: {:?}", e));
                            break;
                        }
                    }
                }
                emit_prims(&mut host, rt);
                emit_audio_events(rt);
                if done {
                    emit(&json!({ "type": "done" }));
                }
            }
            "dump_prims" => {
                if let Some(rt) = runtime.as_mut() {
                    emit_prims(&mut host, rt);
                } else {
                    emit_error("not loaded".to_string());
                }
            }
            "shutdown" => {
                emit(&json!({ "type": "done" }));
                break;
            }
            other => emit_error(format!("unknown op: {}", other)),
        }
    }
}
