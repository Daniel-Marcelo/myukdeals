create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blocked_merchants text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users can manage their own preferences"
  on public.user_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
