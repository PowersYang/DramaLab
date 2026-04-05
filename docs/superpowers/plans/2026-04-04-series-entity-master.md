# Series Entity Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将系列项目中的角色真源从 `project` 级实体收敛为“系列角色主档 + 分集引用”，避免同一系列内重复提取和重复创建角色。

**Architecture:** 保留独立项目现有 `project` 级角色模型不变；当 `project.series_id` 存在时，后端切换到系列角色解析模式，把提取结果同步为 `characters(owner_type="series")` 与 `project_character_links`。前端逐步把系列项目的角色展示改为读取 link 视图，分镜和后续链路逐步引用统一的系列角色 ID。

**Tech Stack:** FastAPI、SQLAlchemy 2.x、Pydantic 2、Next.js 14、React 18、Vitest、pytest

---

## File Map

- Create: `backend/src/db/migrations/` 下的新迁移文件，用于新增 `project_character_links` 和角色主档补充字段
- Create: `backend/src/repository/project_character_link_repository.py`
- Create: `backend/src/application/services/series_entity_resolution_service.py`
- Create: `backend/src/application/services/project_series_casting_service.py`
- Create: `backend/tests/test_project_series_casting_service.py`
- Modify: `backend/src/db/models.py`
- Modify: `backend/src/repository/__init__.py`
- Modify: `backend/src/repository/mappers.py`
- Modify: `backend/src/application/services/project_service.py`
- Modify: `backend/src/schemas/models.py`
- Modify: `backend/src/api/project.py`（如返回结构需要扩展）
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/store/projectStore.ts`
- Modify: 系列项目角色展示相关页面/组件

### Task 1: 数据模型与数据库结构

**Files:**
- Modify: `backend/src/db/models.py`
- Create: `backend/src/db/migrations/<timestamp>_project_character_links.py`
- Test: `backend/tests/test_postgres_schema.py`

- [ ] **Step 1: 写失败测试，定义新表和新字段最小预期**

在 `backend/tests/test_postgres_schema.py` 中新增断言，检查：

```python
def test_project_character_links_table_exists(schema_tables: set[str]):
    assert "project_character_links" in schema_tables
```

以及角色补充字段存在：

```python
def test_characters_has_series_master_fields(character_columns: set[str]):
    assert "canonical_name" in character_columns
    assert "aliases_json" in character_columns
    assert "identity_fingerprint" in character_columns
    assert "merge_status" in character_columns
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_postgres_schema.py -v`
Expected: FAIL，提示缺少 `project_character_links` 或角色字段

- [ ] **Step 3: 在模型中新增 link 表和角色补充字段**

在 `backend/src/db/models.py` 中新增 `ProjectCharacterLinkRecord`，并为 `CharacterRecord` 增加：

```python
canonical_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
aliases_json: Mapped[list | None] = mapped_column(JSON_TYPE, nullable=True)
identity_fingerprint: Mapped[str | None] = mapped_column(String(255), nullable=True)
merge_status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
```

新增 link 表时包含多租户、软删除、审计字段，并加唯一索引：

```python
Index("ix_project_character_links_project", "project_id"),
Index("ix_project_character_links_character", "character_id"),
Index("ix_project_character_links_series_status", "series_id", "match_status"),
Index(
    "ux_project_character_links_project_character_active",
    "project_id",
    "character_id",
    unique=True,
)
```

- [ ] **Step 4: 增加迁移文件**

在 `backend/src/db/migrations/` 新增迁移，确保：
- 创建 `project_character_links`
- 为 `characters` 增加新列
- 为 `canonical_name` 建立系列范围内有效唯一约束或索引策略

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && pytest tests/test_postgres_schema.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/src/db/models.py backend/src/db/migrations backend/tests/test_postgres_schema.py
git commit -m "feat: add series character link schema"
```

### Task 2: Repository 与聚合映射

**Files:**
- Create: `backend/src/repository/project_character_link_repository.py`
- Modify: `backend/src/repository/__init__.py`
- Modify: `backend/src/repository/mappers.py`
- Test: `backend/tests/test_repositories.py`

- [ ] **Step 1: 写失败测试，定义系列项目的角色读取视图**

在 `backend/tests/test_repositories.py` 中新增测试，验证当项目属于系列时，可以通过 link 读取角色：

```python
def test_series_project_character_links_round_trip():
    ...
    assert links[0].project_id == project.id
    assert links[0].character_id == character.id
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_repositories.py -v`
Expected: FAIL，提示 repository 不存在或映射缺失

- [ ] **Step 3: 新建 `ProjectCharacterLinkRepository`**

实现最小接口：

```python
class ProjectCharacterLinkRepository:
    def list_by_project(self, project_id: str): ...
    def sync_for_project(self, project_id: str, series_id: str, links: list, session=None): ...
    def soft_delete_missing(...): ...
```

- [ ] **Step 4: 扩展 mapper，使系列项目可 hydrate link 视图**

在 `backend/src/repository/mappers.py` 中为项目聚合增加 link 数据装载，至少支持：
- 根据 `project_id` 拉取 link
- 通过 `character_id` 关联系列角色
- 形成前端可消费的角色视图对象

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && pytest tests/test_repositories.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/src/repository backend/tests/test_repositories.py
git commit -m "feat: add project character link repository"
```

### Task 3: 系列角色匹配与同步服务

**Files:**
- Create: `backend/src/application/services/series_entity_resolution_service.py`
- Create: `backend/src/application/services/project_series_casting_service.py`
- Test: `backend/tests/test_project_series_casting_service.py`

- [ ] **Step 1: 写失败测试，定义系列角色匹配规则**

新增测试覆盖：
- 精确命中 `canonical_name`
- 命中别名自动复用已有系列角色
- 未命中时创建新的系列角色主档并建立 link

示例：

```python
def test_resolve_existing_series_character_by_canonical_name():
    result = service.resolve(...)
    assert result.character_id == existing.id
    assert result.match_status == "auto_matched"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_project_series_casting_service.py -v`
Expected: FAIL，提示 service 不存在

- [ ] **Step 3: 实现 `SeriesEntityResolutionService`**

最小职责：

```python
class SeriesEntityResolutionService:
    def resolve_characters(self, series_id: str, incoming_characters: list[Character]) -> list[ResolvedSeriesCharacter]:
        ...
```

第一版规则：
- 先按 `canonical_name`
- 再按 `aliases_json`
- 再按归一化名称
- 中低置信度标 `pending_review`

- [ ] **Step 4: 实现 `ProjectSeriesCastingService`**

最小职责：

```python
class ProjectSeriesCastingService:
    def sync_project_characters(self, project_id: str, series_id: str, incoming_characters: list[Character]):
        ...
```

行为：
- 调用解析服务
- 为新角色创建 `owner_type="series"` 主档
- 同步 `project_character_links`
- 不创建 `owner_type="project"` 的角色

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && pytest tests/test_project_series_casting_service.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/src/application/services backend/tests/test_project_series_casting_service.py
git commit -m "feat: add series character resolution flow"
```

### Task 4: 切换系列项目的 reparse 主链路

**Files:**
- Modify: `backend/src/application/services/project_service.py`
- Test: `backend/tests/test_project_series_casting_service.py`

- [ ] **Step 1: 写失败测试，定义系列项目 reparse 的分流行为**

新增测试：

```python
def test_reparse_series_project_uses_series_character_casting():
    project = service.reparse_project(series_project.id, text)
    assert all(character.owner_type == "series" for character in project.series_characters)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_project_series_casting_service.py -v`
Expected: FAIL，当前仍走 `project_command_service.sync_entities(...)`

- [ ] **Step 3: 修改 `ProjectService.reparse_project(...)`**

逻辑切分：

```python
if existing.series_id:
    return self.project_series_casting_service.sync_project_characters(...)
return self.project_command_service.sync_entities(...)
```

并保留独立项目原行为不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && pytest tests/test_project_series_casting_service.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/services/project_service.py backend/tests/test_project_series_casting_service.py
git commit -m "feat: route series project reparse to master character flow"
```

### Task 5: 系列项目读路径切换

**Files:**
- Modify: `backend/src/schemas/models.py`
- Modify: `backend/src/api/project.py`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/store/projectStore.ts`
- Modify: 系列项目角色相关组件
- Test: 前端对应 vitest 文件；后端接口测试文件

- [ ] **Step 1: 写失败测试，定义系列项目角色读取结果**

前端或接口测试应验证：
- 系列项目返回的是 link 视图角色列表
- 每个条目携带系列角色主档与本集覆盖信息

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm test -- --runInBand`
Expected: FAIL，当前仍读取 `project.characters`

- [ ] **Step 3: 修改 schema 与 API 返回结构**

新增类似：

```python
class ProjectCharacterLinkView(BaseModel):
    project_id: str
    character_id: str
    source_name: str | None = None
    source_alias: str | None = None
    episode_notes: str | None = None
    match_status: str
    character: Character
```

- [ ] **Step 4: 修改前端 store 与页面读取逻辑**

要求：
- 系列项目页面优先读取 link 视图
- 独立项目继续读取原 `project.characters`
- 不改动无关页面

- [ ] **Step 5: 运行前后端测试确认通过**

Run: `cd backend && pytest -q`
Expected: PASS

Run: `cd frontend && npm test -- --runInBand`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/src/schemas/models.py backend/src/api/project.py frontend/src/lib/api.ts frontend/src/store/projectStore.ts frontend/src/components
git commit -m "feat: read series project characters from links"
```

### Task 6: 历史迁移与治理入口

**Files:**
- Create: `scripts/migrate_series_project_characters.py`
- Create: `backend/tests/test_series_character_migration.py`

- [ ] **Step 1: 写失败测试，定义候选归并输出**

新增测试验证：
- 同系列下同名 project 角色会被聚成候选组
- 迁移脚本不会误动独立项目数据

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_series_character_migration.py -v`
Expected: FAIL，脚本和测试尚不存在

- [ ] **Step 3: 编写迁移脚本**

脚本职责：
- 扫描同系列下的 project 级角色
- 生成候选主角色和待合并列表
- 支持 dry-run
- 默认只输出计划，不直接执行 destructive merge

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && pytest tests/test_series_character_migration.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/migrate_series_project_characters.py backend/tests/test_series_character_migration.py
git commit -m "chore: add migration tooling for series character dedupe"
```

## Self-Review

- Spec coverage:
  - 真源规则：Task 1、Task 3、Task 4
  - 新增 link 层：Task 1、Task 2
  - 提取/重解析流程：Task 3、Task 4
  - 读路径切换：Task 5
  - 历史迁移：Task 6
- Placeholder scan:
  - 当前计划已覆盖文件、测试、运行命令和提交粒度，未保留 `TODO/TBD`
- Type consistency:
  - 统一使用 `project_character_links`、`SeriesEntityResolutionService`、`ProjectSeriesCastingService` 作为后续实现名词
