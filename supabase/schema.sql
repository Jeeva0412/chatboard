create table if not exists public.chat_messages (
	id bigint generated always as identity primary key,
	content text not null check (char_length(content) > 0),
	sender_id text not null,
	created_at timestamptz not null default now()
);

alter table public.chat_messages add column if not exists sender_id text;
update public.chat_messages set sender_id = 'legacy' where sender_id is null;
alter table public.chat_messages alter column sender_id set not null;

alter table public.chat_messages enable row level security;

create index if not exists idx_chat_messages_created_id_desc
on public.chat_messages (created_at desc, id desc);

alter table public.chat_messages add column if not exists is_pinned boolean not null default false;
create index if not exists idx_chat_messages_is_pinned on public.chat_messages (is_pinned) where is_pinned = true;

drop policy if exists "allow anon read messages" on public.chat_messages;
create policy "allow anon read messages"
on public.chat_messages
for select
using (true);

drop policy if exists "allow anon insert messages" on public.chat_messages;
create policy "allow anon insert messages"
on public.chat_messages
for insert
to anon
with check (true);

drop policy if exists "allow anon update messages" on public.chat_messages;
create policy "allow anon update messages"
on public.chat_messages
for update
to anon
using (true)
with check (true);

create or replace function public.enforce_message_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	delete from public.chat_messages
	where id in (
		select id
		from public.chat_messages
		where is_pinned = false
		order by created_at desc, id desc
		offset 40
	);

	return null;
end;
$$;

revoke all on function public.enforce_message_cap() from public;

drop trigger if exists trg_enforce_message_cap on public.chat_messages;
create trigger trg_enforce_message_cap
after insert on public.chat_messages
for each statement
execute function public.enforce_message_cap();

delete from public.chat_messages
where id in (
	select id
	from public.chat_messages
	where is_pinned = false
	order by created_at desc, id desc
	offset 40
);
