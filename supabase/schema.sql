create table if not exists public.chat_messages (
	id bigint generated always as identity primary key,
	content text not null check (char_length(content) > 0),
	created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

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

create or replace function public.enforce_message_cap()
returns trigger
language plpgsql
as $$
begin
	delete from public.chat_messages
	where id in (
		select id
		from public.chat_messages
		order by created_at asc, id asc
		offset 40
	);

	return new;
end;
$$;

drop trigger if exists trg_enforce_message_cap on public.chat_messages;
create trigger trg_enforce_message_cap
after insert on public.chat_messages
for each statement
execute function public.enforce_message_cap();
