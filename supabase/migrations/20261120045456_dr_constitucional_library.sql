create extension if not exists vector with schema extensions;

create schema dr_constitucional;
revoke all on schema dr_constitucional from public, anon, authenticated;
grant usage on schema dr_constitucional to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dr-constitucional-biblioteca',
  'dr-constitucional-biblioteca',
  false,
  20 * 1024 * 1024,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
);

create policy dr_constitucional_bucket_server_only on storage.objects
as restrictive for all to anon, authenticated
using (bucket_id <> 'dr-constitucional-biblioteca')
with check (bucket_id <> 'dr-constitucional-biblioteca');

create table dr_constitucional.documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null check (length(filename) between 1 and 240),
  object_path text not null unique,
  sha256 text unique check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_upload'
    check (status in ('pending_upload', 'in_progress', 'completed', 'failed')),
  validity_state text not null default 'sin_revisar'
    check (validity_state in ('sin_revisar', 'vigente', 'historica', 'derogada')),
  validity_version text not null default '',
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  check (valid_until is null or (valid_from is not null and valid_until >= valid_from))
);

create table dr_constitucional.chunks (
  document_id uuid not null references dr_constitucional.documents(id) on delete cascade,
  position integer not null check (position >= 0),
  content text not null check (length(btrim(content)) > 0),
  embedding extensions.vector(384) not null,
  primary key (document_id, position)
);

alter table dr_constitucional.documents enable row level security;
alter table dr_constitucional.chunks enable row level security;

revoke all on dr_constitucional.documents, dr_constitucional.chunks from public, anon, authenticated;
grant select, insert, update, delete on dr_constitucional.documents, dr_constitucional.chunks to service_role;
