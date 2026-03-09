-- Fase 4D CRM notifications:
-- - bandeja de notificaciones internas para admins
-- - recordatorios de seguimiento de leads y mensajes por canal

create table if not exists crm.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  notification_type text not null check (
    notification_type in ('in_app_message', 'email_outreach', 'lead_follow_up', 'call_reminder', 'system_alert')
  ),
  channel text not null check (
    channel in ('in_app', 'email', 'whatsapp', 'phone')
  ),
  priority text not null default 'normal' check (
    priority in ('low', 'normal', 'high', 'urgent')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'scheduled', 'sent', 'done', 'cancelled', 'failed')
  ),
  title text not null,
  body text,
  recipient_email text,
  recipient_phone text,
  assignee_email text,
  lead_id uuid references crm.leads(id) on delete set null,
  project_property_id uuid references crm.properties(id) on delete set null,
  due_at timestamptz,
  scheduled_for timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_notifications_updated_at on crm.notifications;
create trigger trg_notifications_updated_at
before update on crm.notifications
for each row execute procedure crm.set_updated_at();

create index if not exists idx_notifications_org_status_due
  on crm.notifications (organization_id, status, due_at desc);

create index if not exists idx_notifications_org_type
  on crm.notifications (organization_id, notification_type);

create index if not exists idx_notifications_org_channel
  on crm.notifications (organization_id, channel);

grant select, insert, update, delete on table crm.notifications to authenticated, service_role;

alter table crm.notifications enable row level security;

drop policy if exists notifications_internal_all on crm.notifications;
create policy notifications_internal_all on crm.notifications
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));
