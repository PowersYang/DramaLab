create table if not exists style_presets (
    id varchar(64) primary key,
    name varchar(255) not null,
    positive_prompt text not null,
    negative_prompt text,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists user_art_styles (
    id varchar(64) primary key,
    user_id varchar(64) not null,
    name varchar(255) not null,
    description text,
    positive_prompt text not null,
    negative_prompt text not null default '',
    thumbnail_url text,
    is_custom boolean not null default true,
    reason text,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
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
    status varchar(32) not null default 'pending',
    is_deleted boolean not null default false,
    deleted_at timestamptz,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists series (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    title varchar(255) not null,
    description text,
    art_direction jsonb,
    model_settings jsonb not null default '{}'::jsonb,
    prompt_config jsonb not null default '{}'::jsonb,
    status varchar(32) not null default 'active',
    is_deleted boolean not null default false,
    deleted_at timestamptz,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists characters (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    owner_type varchar(32) not null,
    owner_id varchar(64) not null,
    name varchar(255) not null,
    canonical_name varchar(255),
    aliases_json jsonb,
    identity_fingerprint varchar(255),
    merge_status varchar(32) not null default 'active',
    description text not null,
    age varchar(128),
    gender varchar(64),
    clothing text,
    visual_weight integer not null default 3,
    full_body_image_url text,
    full_body_prompt text,
    full_body_asset_selected_id varchar(64),
    three_view_image_url text,
    three_view_prompt text,
    three_view_asset_selected_id varchar(64),
    headshot_image_url text,
    headshot_prompt text,
    headshot_asset_selected_id varchar(64),
    video_prompt text,
    image_url text,
    avatar_url text,
    is_consistent boolean not null default true,
    full_body_updated_at timestamptz not null default now(),
    three_view_updated_at timestamptz not null default now(),
    headshot_updated_at timestamptz not null default now(),
    base_character_id varchar(64),
    voice_id varchar(128),
    voice_name varchar(255),
    voice_speed double precision not null default 1.0,
    voice_pitch double precision not null default 1.0,
    voice_volume integer not null default 50,
    locked boolean not null default false,
    status varchar(32) not null default 'pending',
    is_deleted boolean not null default false,
    deleted_at timestamptz,
    deleted_by varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists character_asset_units (
    id varchar(64) primary key,
    character_id varchar(64) not null,
    unit_type varchar(32) not null,
    is_deleted boolean not null default false
);

create table if not exists project_character_links (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    project_id varchar(64) not null,
    series_id varchar(64) not null,
    character_id varchar(64) not null,
    source_name varchar(255),
    source_alias varchar(255),
    episode_notes text,
    override_json jsonb,
    match_confidence double precision,
    match_status varchar(32) not null default 'confirmed',
    is_deleted boolean not null default false,
    deleted_at timestamptz,
    deleted_by varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists video_tasks (
    id varchar(64) primary key,
    reference_video_urls jsonb not null default '[]'::jsonb
);

create index if not exists ix_style_presets_active_sort on style_presets (is_active, sort_order, created_at);
create index if not exists ix_user_art_styles_user_sort on user_art_styles (user_id, sort_order, updated_at);
create index if not exists ix_characters_owner on characters (owner_type, owner_id);
create unique index if not exists ux_characters_series_canonical_name_active on characters (owner_id, canonical_name) where owner_type = 'series' and is_deleted = false and canonical_name is not null;
create unique index if not exists ux_character_asset_units_character_unit_type on character_asset_units (character_id, unit_type) where is_deleted = false;
create index if not exists ix_projects_org_workspace_updated on projects (organization_id, workspace_id, is_deleted, updated_at);
create index if not exists ix_series_org_workspace_updated on series (organization_id, workspace_id, is_deleted, updated_at);
create index if not exists ix_project_character_links_project on project_character_links (project_id);
create index if not exists ix_project_character_links_character on project_character_links (character_id);
create index if not exists ix_project_character_links_series_status on project_character_links (series_id, match_status);
create unique index if not exists ux_project_character_links_project_character_active on project_character_links (project_id, character_id) where is_deleted = false;
