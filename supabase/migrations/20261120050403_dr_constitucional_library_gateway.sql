alter table dr_constitucional.documents add column index_started_at timestamptz;

create or replace function public.dr_library_gateway(operation text, payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  doc_id uuid;
  result jsonb;
begin
  if payload ? 'id' then
    doc_id := (payload->>'id')::uuid;
  end if;

  case operation
    when 'create' then
      insert into dr_constitucional.documents(id, filename, object_path)
      values (doc_id, payload->>'name', payload->>'path');
      return '{}'::jsonb;
    when 'get' then
      select to_jsonb(d) into result
      from dr_constitucional.documents d where d.id = doc_id;
    when 'list' then
      select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb) into result
      from dr_constitucional.documents d where d.status <> 'pending_upload';
    when 'begin' then
      update dr_constitucional.documents
      set status = 'in_progress', index_started_at = now()
      where id = doc_id and (status in ('pending_upload', 'failed')
        or (status = 'in_progress' and index_started_at < now() - interval '5 minutes'))
      returning to_jsonb(documents) into result;
    when 'fail' then
      update dr_constitucional.documents set status = 'failed'
      where id = doc_id and status = 'in_progress';
      return '{}'::jsonb;
    when 'complete' then
      perform 1 from dr_constitucional.documents where id = doc_id and status = 'in_progress' for update;
      if not found then return null; end if;
      if jsonb_array_length(payload->'chunks') = 0 then
        raise exception 'Empty document';
      end if;
      insert into dr_constitucional.chunks(document_id, position, content, embedding)
      select doc_id, (ordinal - 1)::integer, chunk->>'text', (chunk->>'vector')::extensions.vector
      from jsonb_array_elements(payload->'chunks') with ordinality as items(chunk, ordinal);
      update dr_constitucional.documents set status = 'completed'
      where id = doc_id returning to_jsonb(documents) into result;
    when 'validity' then
      update dr_constitucional.documents
        set validity_state = payload->>'state',
            validity_version = coalesce(payload->>'version', ''),
            valid_from = nullif(payload->>'from', '')::date,
            valid_until = nullif(payload->>'until', '')::date
      where id = doc_id and status = 'completed'
      returning to_jsonb(documents) into result;
    when 'search' then
      select coalesce(jsonb_agg(to_jsonb(matches) order by matches.distance), '[]'::jsonb) into result
      from (
        select d.filename as name, c.content as text,
          c.embedding operator(extensions.<=>) (payload->>'vector')::extensions.vector as distance
        from dr_constitucional.chunks c
        join dr_constitucional.documents d on d.id = c.document_id
        where d.status = 'completed' and (
          nullif(payload->>'asOf', '') is null or (
            d.validity_state <> 'sin_revisar'
            and d.valid_from <= (payload->>'asOf')::date
            and (d.valid_until >= (payload->>'asOf')::date
                 or (d.valid_until is null and d.validity_state = 'vigente'))
          )
        )
        order by distance limit 8
      ) matches;
    else
      raise exception 'Invalid operation';
  end case;
  return result;
end;
$$;

revoke all on function public.dr_library_gateway(text, jsonb) from public, anon, authenticated;
grant execute on function public.dr_library_gateway(text, jsonb) to service_role;
