-- Valle Interior · esquema inicial

create table users (
  id            bigserial primary key,
  username      text        not null,
  display_name  text        not null,
  password_hash text        not null,
  role          text        not null default 'reader' check (role in ('reader', 'admin')),
  disabled      boolean     not null default false,
  created_at    timestamptz not null default now()
);
create unique index users_username_lower on users (lower(username));

create table sessions (
  token_hash text primary key,
  user_id    bigint      not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user on sessions (user_id);
create index sessions_expires on sessions (expires_at);

create table settings (
  key   text primary key,
  value jsonb not null
);

-- Biblioteca -----------------------------------------------------------

create table series (
  id             bigserial primary key,
  slug           text        not null unique,
  title          text        not null,
  original_title text        not null default '',
  author         text        not null default '',
  source_lang    text        not null default 'ja',
  synopsis       text        not null default '',
  status         text        not null default 'ongoing' check (status in ('ongoing', 'completed', 'paused')),
  cover          text,
  published      boolean     not null default false,
  position       integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table chapters (
  id         bigserial primary key,
  series_id  bigint        not null references series (id) on delete cascade,
  number     numeric(8, 2) not null,
  title      text          not null default '',
  published  boolean       not null default false,
  created_at timestamptz   not null default now(),
  unique (series_id, number)
);
create index chapters_series on chapters (series_id);

create table pages (
  id         bigserial primary key,
  chapter_id bigint  not null references chapters (id) on delete cascade,
  position   integer not null,
  file       text    not null,
  width      integer,
  height     integer,
  unique (chapter_id, position) deferrable initially deferred
);

create table reading_progress (
  user_id    bigint      not null references users (id) on delete cascade,
  chapter_id bigint      not null references chapters (id) on delete cascade,
  page       integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

-- Proyectos y libro de visitas ----------------------------------------

create table projects (
  id          bigserial primary key,
  slug        text        not null unique,
  name        text        not null,
  description text        not null default '',
  stage       text        not null default 'semilla' check (stage in ('semilla', 'brote', 'crecido')),
  tags        text[]      not null default '{}',
  url         text        not null default '',
  visible     boolean     not null default true,
  position    integer     not null default 0,
  created_at  timestamptz not null default now()
);

create table guestbook (
  id         bigserial primary key,
  user_id    bigint references users (id) on delete set null,
  author     text        not null,
  body       text        not null,
  hidden     boolean     not null default false,
  created_at timestamptz not null default now()
);
create index guestbook_created on guestbook (created_at desc);

-- Grupos de lectura -----------------------------------------------------

create table reading_groups (
  id          bigserial primary key,
  name        text        not null,
  description text        not null default '',
  owner_id    bigint      not null references users (id) on delete cascade,
  series_id   bigint references series (id) on delete set null,
  visibility  text        not null default 'public' check (visibility in ('public', 'private')),
  control     text        not null default 'guide' check (control in ('guide', 'everyone')),
  invite_code text        not null unique,
  created_at  timestamptz not null default now()
);

create table group_members (
  group_id  bigint      not null references reading_groups (id) on delete cascade,
  user_id   bigint      not null references users (id) on delete cascade,
  role      text        not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user on group_members (user_id);

create table group_state (
  group_id   bigint primary key references reading_groups (id) on delete cascade,
  chapter_id bigint references chapters (id) on delete set null,
  page       integer     not null default 0,
  updated_by bigint references users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table group_messages (
  id         bigserial primary key,
  group_id   bigint      not null references reading_groups (id) on delete cascade,
  user_id    bigint references users (id) on delete set null,
  body       text        not null,
  created_at timestamptz not null default now()
);
create index group_messages_group on group_messages (group_id, id desc);

-- Lienzos compartidos ---------------------------------------------------

create table draw_rooms (
  id         text primary key,
  name       text        not null,
  snapshot   text,
  updated_at timestamptz not null default now()
);

insert into draw_rooms (id, name) values ('lienzo-abierto', 'Lienzo abierto');
