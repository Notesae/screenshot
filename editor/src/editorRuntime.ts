// 本地画布模块在明确截图/导入时预取，与选区操作和图片解码并行；启动空会话不加载 Fabric。
export function preloadEditorCanvas() { return import('./EditorCanvas'); }
