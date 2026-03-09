-- User Dashboard configurations for customized KPI views
-- Stores the layout and chart definitions for each user

create table if not exists crm.user_dashboards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  config jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- RLS Policies
alter table crm.user_dashboards enable row level security;

create policy "Users can view their own dashboard configs"
  on crm.user_dashboards for select
  using (auth.uid() = user_id);

create policy "Users can insert their own dashboard configs"
  on crm.user_dashboards for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own dashboard configs"
  on crm.user_dashboards for update
  using (auth.uid() = user_id);

create policy "Users can delete their own dashboard configs"
  on crm.user_dashboards for delete
  using (auth.uid() = user_id);

-- Updated at trigger
create trigger trg_user_dashboards_updated_at
before update on crm.user_dashboards
for each row execute procedure crm.set_updated_at();

-- Grants
grant select, insert, update, delete on table crm.user_dashboards to authenticated, service_role;

-- Index for performance
create index if not exists idx_user_dashboards_user_org on crm.user_dashboards (user_id, organization_id);
