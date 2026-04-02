# Alembic Versions

这里存放数据库迁移脚本。

当前仓库刚接入 Alembic，后续新增字段、索引、约束时应优先通过这里提交 revision，
而不是继续把所有 schema 演进都堆进 `init_database()` 的启动时补丁逻辑。
