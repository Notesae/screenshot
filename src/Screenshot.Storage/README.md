# 本地恢复存储

`SnapshotStore` 只操作传入的专用恢复目录，不访问屏幕、窗口、剪贴板或网络。构造函数不自动列出或打开已有文档。宿主决定何时自动保存、何时展示列表，以及何时按用户选择恢复。

```csharp
using var store = new SnapshotStore(recoveryDirectory);
SnapshotSaveResult saved = await store.SaveAsync(documentId, revision, document, token);
IReadOnlyList<SnapshotSummary> entries = await store.ListAsync(token);
SnapshotLoadResult restored = await store.LoadAsync(documentId, token);
SnapshotDeleteResult deleted = await store.DeleteAsync(documentId, token);
```

- `documentId` 为 1 至 100 个 ASCII 字母、数字、`-` 或 `_`，首字符为字母或数字，不能是路径。
- `revision` 为非负 Int64。已有相同或更高修订时返回 `Saved:false, Stale:true`，不修改原图、编辑内容、时间或名称。过期结果中的 `Revision` 是当前已提交修订。
- 列表只返回 `DocumentId`、`Revision`、安全名称 `Name` 和 `UpdatedAtUtc`，不读取原图或编辑文字。名称取 `image.name` 的末段，移除控制字符并限 80 字符，空值显示“截图”。
- `LoadAsync` 仅在明确调用时重新嵌入通过长度及 SHA256 校验的原图。找不到记录抛出 `SnapshotStoreException`，错误码为 `not_found`。
- `SnapshotSaveResult` 还提供 `DocumentId`、`Revision`、`CleanupPending`；`SnapshotDeleteResult` 提供 `Deleted`、`CleanupPending`。清理暂缓表示事务已经提交，但原图文件可能被占用或缺少删除权限；后续成功保存/删除会再次尝试，不会把已提交保存误报为未保存。

## 数据与事务

数据库名为 `snapshots.db`，启用 SQLite WAL、`synchronous=FULL` 及外键，schema 版本为 1。`snapshots` 保存文档标识、修订、移除 `image.dataUrl` 的项目 JSON、原图摘要、安全名称与 UTC 时间；`assets` 保存摘要和原图字节长度。支持项目 JSON schema 1/2，包括 `image:null` 的纯文字文档，其余编辑器字段保留原值。

原图保持传入 PNG 的原始字节，按 SHA256 命名为 `assets/<sha256>.png`，跨文档去重。新原图写入同目录唯一临时文件，刷盘后原子重命名；同摘要现有文件只校验，不覆盖。存储层验证 PNG 头、尺寸及项目元数据是否一致，不解压或重编码压缩像素流。

保存使用 `BEGIN IMMEDIATE`，修订比较、资产元数据、项目更新与容量淘汰在同一事务中提交。新原图可以先于事务提交出现在磁盘；故障或取消回滚后，只能将其视为无引用资产回收，不能提前删除旧原图。加载也持短事务，避免另一实例 GC 在“读到旧行”和“读取其原图”之间删除文件。清理重新获取写保留锁后查询最新引用，仅删除不再被引用的 SHA 文件与本服务命名的临时文件，跳过其他文件和链接文件。

SQLite 的异步 ADO 方法仍同步执行，因此本库通过后台任务执行 I/O，同一实例串行使用连接，跨实例通过 SQLite 事务协调。取消在排队、原图分块读写、容量淘汰及提交前检查；提交完成是保存生效的边界，之后不因迟到取消回滚已提交数据。SQLite 写锁等待使用 2 秒超时，取消不承诺打断所有底层同步文件调用。

## 限额与错误

默认保留 20 个文档、256 MiB 的当前引用去重原图。最旧保存时间的文档先淘汰，本次新保存始终保留；单张原图自身大于容量时直接拒绝，不淘汰旧恢复。原图最多 20 MiB、单边 16000、6400 万像素；去掉原图后的文档 JSON 最多 4 MiB。文档数可配置为 1 至 1000。

容量按当前引用的唯一原图计算。为保证回滚安全，提交前不会删除旧图，写入峰值可额外包含一张新图；文件占用、权限或崩溃可暂留孤立文件，以 `CleanupPending` 或后续事务清理。SQLite 文件中的空闲页由后续写入复用，本库不为缩小文件主动执行阻塞式 VACUUM。

`SnapshotStoreException.Code` 包括 `invalid_options`、`invalid_directory`、`invalid_document_id`、`invalid_revision`、`invalid_document`、`document_too_large`、`asset_too_large`、`capacity_exceeded`、`not_found`、`asset_missing`、`snapshot_corrupt`、`database_corrupt`、`unsafe_path`、`schema_unsupported`、`store_busy`、`store_io_error`、`store_failed`。取消保持 `OperationCanceledException`。错误不附加 SQL、底层文件路径、原图或文档文字。

## 后台验证

```powershell
dotnet build tests/Screenshot.Storage.Tests/Screenshot.Storage.Tests.csproj -c Release --artifacts-path artifacts/p0-storage --maxcpucount:1
dotnet artifacts/p0-storage/bin/Screenshot.Storage.Tests/release/Screenshot.Storage.Tests.dll
```

测试仅在独立临时目录使用合成 1 像素 PNG、schema 1/2 JSON 与真实 SQLite；不读取应用默认恢复目录。覆盖不可变原图/去重、拒旧修订、重启、损坏校验、真实触发器故障、跨实例、写锁中取消、文档/资产容量及安全 GC。最终是否通过以实际 runner 输出为准。

## 官方资料

- [Microsoft.Data.Sqlite 事务](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/transactions)
- [异步方法的同步执行限制](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/async)
- [连接线程安全、锁和超时](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/database-errors)
- [SQLite WAL](https://www.sqlite.org/wal.html)

固定包为 `Microsoft.Data.Sqlite` 10.0.13。原图、恢复数据库与验证输出由根项目排除在 Git 外。
