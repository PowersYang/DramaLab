create table if not exists task_concurrency_limits (
    id varchar(64) primary key,
    organization_id varchar(64) not null references organizations(id),
    task_type varchar(64) not null,
    max_concurrency integer not null default 1,
    created_by varchar(64),
    updated_by varchar(64),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists uq_task_concurrency_limits_org_task_type
    on task_concurrency_limits (organization_id, task_type);

create index if not exists ix_task_concurrency_limits_org_task_type
    on task_concurrency_limits (organization_id, task_type);
