create table if not exists organizations (
    id varchar(64) primary key,
    name varchar(255) not null,
    slug varchar(255),
    status varchar(32) not null default 'active',
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now())
);

create unique index if not exists ux_organizations_slug on organizations (slug);

create table if not exists workspaces (
    id varchar(64) primary key,
    organization_id varchar(64),
    name varchar(255) not null,
    slug varchar(255),
    status varchar(32) not null default 'active',
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    constraint fk_workspaces_organization foreign key (organization_id) references organizations (id)
);

create index if not exists ix_workspaces_organization_id on workspaces (organization_id);

create table if not exists users (
    id varchar(64) primary key,
    email varchar(255),
    display_name varchar(255),
    status varchar(32) not null default 'active',
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now())
);

create unique index if not exists ux_users_email on users (email);

create table if not exists roles (
    id varchar(64) primary key,
    code varchar(64) not null,
    name varchar(255) not null,
    description text,
    is_system boolean not null default false,
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now())
);

create unique index if not exists ux_roles_code on roles (code);

create table if not exists memberships (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    user_id varchar(64) not null,
    role_id varchar(64),
    status varchar(32) not null default 'active',
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    constraint fk_memberships_organization foreign key (organization_id) references organizations (id),
    constraint fk_memberships_workspace foreign key (workspace_id) references workspaces (id),
    constraint fk_memberships_user foreign key (user_id) references users (id),
    constraint fk_memberships_role foreign key (role_id) references roles (id)
);

create index if not exists ix_memberships_organization_id on memberships (organization_id);
create index if not exists ix_memberships_workspace_id on memberships (workspace_id);
create index if not exists ix_memberships_user_id on memberships (user_id);
create index if not exists ix_memberships_role_id on memberships (role_id);

create table if not exists billing_accounts (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    status varchar(32) not null default 'draft',
    billing_email varchar(255),
    metadata jsonb not null default '{}'::jsonb,
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    constraint fk_billing_accounts_organization foreign key (organization_id) references organizations (id),
    constraint fk_billing_accounts_workspace foreign key (workspace_id) references workspaces (id)
);

create index if not exists ix_billing_accounts_organization_id on billing_accounts (organization_id);
create index if not exists ix_billing_accounts_workspace_id on billing_accounts (workspace_id);

create table if not exists projects (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    title varchar(255) not null,
    original_text text not null,
    style_preset varchar(128) not null default 'realistic',
    style_prompt text,
    merged_video_url text,
    series_id varchar(64),
    episode_number integer,
    art_direction jsonb,
    model_settings jsonb not null default '{}'::jsonb,
    prompt_config jsonb not null default '{}'::jsonb
);

create index if not exists ix_projects_organization_id on projects (organization_id);
create index if not exists ix_projects_workspace_id on projects (workspace_id);
create index if not exists ix_projects_series_id on projects (series_id);
create index if not exists ix_projects_org_workspace_updated on projects (organization_id, workspace_id, updated_at);

create table if not exists series (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    title varchar(255) not null,
    description text,
    art_direction jsonb,
    model_settings jsonb not null default '{}'::jsonb,
    prompt_config jsonb not null default '{}'::jsonb
);

create index if not exists ix_series_organization_id on series (organization_id);
create index if not exists ix_series_workspace_id on series (workspace_id);
create index if not exists ix_series_org_workspace_updated on series (organization_id, workspace_id, updated_at);

create table if not exists characters (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    owner_type varchar(32) not null,
    owner_id varchar(64) not null,
    name varchar(255) not null,
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
    full_body_updated_at double precision not null default extract(epoch from now()),
    three_view_updated_at double precision not null default 0,
    headshot_updated_at double precision not null default 0,
    base_character_id varchar(64),
    voice_id varchar(128),
    voice_name varchar(255),
    voice_speed double precision not null default 1.0,
    voice_pitch double precision not null default 1.0,
    voice_volume integer not null default 50,
    locked boolean not null default false,
    status varchar(32) not null default 'pending'
);

create index if not exists ix_characters_organization_id on characters (organization_id);
create index if not exists ix_characters_workspace_id on characters (workspace_id);
create index if not exists ix_characters_owner on characters (owner_type, owner_id);

create table if not exists scenes (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    owner_type varchar(32) not null,
    owner_id varchar(64) not null,
    name varchar(255) not null,
    description text not null,
    visual_weight integer not null default 3,
    time_of_day varchar(128),
    lighting_mood text,
    image_url text,
    image_selected_id varchar(64),
    video_prompt text,
    locked boolean not null default false,
    status varchar(32) not null default 'pending'
);

create index if not exists ix_scenes_organization_id on scenes (organization_id);
create index if not exists ix_scenes_workspace_id on scenes (workspace_id);
create index if not exists ix_scenes_owner on scenes (owner_type, owner_id);

create table if not exists props (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    owner_type varchar(32) not null,
    owner_id varchar(64) not null,
    name varchar(255) not null,
    description text not null,
    video_url text,
    audio_url text,
    sfx_url text,
    bgm_url text,
    image_url text,
    image_selected_id varchar(64),
    video_prompt text,
    locked boolean not null default false,
    status varchar(32) not null default 'pending'
);

create index if not exists ix_props_organization_id on props (organization_id);
create index if not exists ix_props_workspace_id on props (workspace_id);
create index if not exists ix_props_owner on props (owner_type, owner_id);

create table if not exists character_asset_units (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    character_id varchar(64) not null,
    unit_type varchar(32) not null,
    selected_image_id varchar(64),
    selected_video_id varchar(64),
    image_prompt text,
    video_prompt text,
    image_updated_at double precision not null default extract(epoch from now()),
    video_updated_at double precision not null default 0,
    constraint fk_character_asset_units_character foreign key (character_id) references characters (id)
);

create index if not exists ix_character_asset_units_organization_id on character_asset_units (organization_id);
create index if not exists ix_character_asset_units_workspace_id on character_asset_units (workspace_id);
create unique index if not exists ux_character_asset_units_character_unit_type on character_asset_units (character_id, unit_type);

create table if not exists image_variants (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    owner_type varchar(32) not null,
    owner_id varchar(64) not null,
    variant_group varchar(64) not null,
    url text not null,
    prompt_used text,
    is_favorited boolean not null default false,
    is_uploaded_source boolean not null default false,
    upload_type varchar(64)
);

create index if not exists ix_image_variants_organization_id on image_variants (organization_id);
create index if not exists ix_image_variants_workspace_id on image_variants (workspace_id);
create index if not exists ix_image_variants_owner on image_variants (owner_type, owner_id, variant_group);

create table if not exists video_variants (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    owner_type varchar(32) not null,
    owner_id varchar(64) not null,
    variant_group varchar(64) not null,
    url text not null,
    prompt_used text,
    audio_url text,
    source_image_id varchar(64),
    is_favorited boolean not null default false
);

create index if not exists ix_video_variants_organization_id on video_variants (organization_id);
create index if not exists ix_video_variants_workspace_id on video_variants (workspace_id);
create index if not exists ix_video_variants_owner on video_variants (owner_type, owner_id, variant_group);

create table if not exists storyboard_frames (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    project_id varchar(64) not null,
    frame_order integer not null,
    scene_id varchar(64) not null,
    character_ids jsonb not null default '[]'::jsonb,
    prop_ids jsonb not null default '[]'::jsonb,
    action_description text not null default '',
    facial_expression text,
    dialogue text,
    speaker varchar(255),
    visual_atmosphere text,
    character_acting text,
    key_action_physics text,
    shot_size varchar(128),
    camera_angle varchar(128) not null default 'Medium Shot',
    camera_movement varchar(128),
    composition text,
    atmosphere text,
    composition_data jsonb,
    image_prompt text,
    image_prompt_cn text,
    image_prompt_en text,
    image_url text,
    image_selected_id varchar(64),
    rendered_image_url text,
    rendered_image_selected_id varchar(64),
    video_prompt text,
    video_url text,
    audio_url text,
    audio_error text,
    sfx_url text,
    selected_video_id varchar(64),
    locked boolean not null default false,
    status varchar(32) not null default 'pending',
    constraint fk_storyboard_frames_project foreign key (project_id) references projects (id)
);

create index if not exists ix_storyboard_frames_organization_id on storyboard_frames (organization_id);
create index if not exists ix_storyboard_frames_workspace_id on storyboard_frames (workspace_id);
create index if not exists ix_storyboard_frames_project_id on storyboard_frames (project_id);
create index if not exists ix_storyboard_frames_project on storyboard_frames (project_id, frame_order);

create table if not exists video_tasks (
    id varchar(64) primary key,
    organization_id varchar(64),
    workspace_id varchar(64),
    created_by varchar(64),
    updated_by varchar(64),
    created_at double precision not null default extract(epoch from now()),
    updated_at double precision not null default extract(epoch from now()),
    project_id varchar(64) not null,
    frame_id varchar(64),
    asset_id varchar(64),
    image_url text not null,
    prompt text not null,
    status varchar(32) not null default 'pending',
    video_url text,
    duration integer not null default 5,
    seed integer,
    resolution varchar(64) not null default '720p',
    generate_audio boolean not null default false,
    audio_url text,
    prompt_extend boolean not null default true,
    negative_prompt text,
    model varchar(128) not null default 'wan2.6-i2v',
    shot_type varchar(64) not null default 'single',
    generation_mode varchar(64) not null default 'i2v',
    reference_video_urls jsonb not null default '[]'::jsonb,
    mode varchar(64),
    sound varchar(16),
    cfg_scale double precision,
    vidu_audio boolean,
    movement_amplitude varchar(64),
    constraint fk_video_tasks_project foreign key (project_id) references projects (id)
);

create index if not exists ix_video_tasks_organization_id on video_tasks (organization_id);
create index if not exists ix_video_tasks_workspace_id on video_tasks (workspace_id);
create index if not exists ix_video_tasks_project_id on video_tasks (project_id);
create index if not exists ix_video_tasks_project on video_tasks (project_id, created_at);
create index if not exists ix_video_tasks_owner_asset on video_tasks (asset_id, frame_id);
