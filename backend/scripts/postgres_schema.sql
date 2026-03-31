create table if not exists style_presets (
    id varchar(64) primary key,
    name varchar(255) not null,
    positive_prompt text not null,
    negative_prompt text,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists model_provider_configs (
    id varchar(64) primary key,
    provider_key varchar(64) not null,
    settings_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists model_catalog_entries (
    id varchar(64) primary key,
    provider_key varchar(64) not null,
    model_key varchar(128) not null,
    default_settings_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists projects (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    title varchar(255) not null,
    original_text text not null,
    style_preset varchar(128) not null default 'realistic',
    style_prompt text,
    merged_video_url text,
    series_id varchar(64),
    episode_number integer,
    art_direction jsonb,
    model_settings jsonb not null default '{}'::jsonb,
    prompt_config jsonb not null default '{}'::jsonb,
    timeline_json jsonb,
    is_deleted boolean not null default false,
    deleted_at timestamptz,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists character_asset_units (
    id varchar(64) primary key,
    character_id varchar(64) not null,
    unit_type varchar(32) not null,
    is_deleted boolean not null default false
);

create table if not exists video_tasks (
    id varchar(64) primary key,
    reference_video_urls jsonb not null default '[]'::jsonb
);

create index if not exists ix_style_presets_active_sort on style_presets (is_active, sort_order, created_at);
create unique index if not exists ux_character_asset_units_character_unit_type on character_asset_units (character_id, unit_type) where is_deleted = false;
create index if not exists ix_projects_org_workspace_updated on projects (organization_id, workspace_id, is_deleted, updated_at);
