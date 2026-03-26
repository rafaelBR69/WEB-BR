alter table crm.notifications
  add column if not exists source_type text not null default 'manual',
  add column if not exists rule_key text,
  add column if not exists rule_hash text,
  add column if not exists entity_type text,
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists manager_user_id uuid references auth.users(id) on delete set null,
  add column if not exists client_id uuid references crm.clients(id) on delete set null,
  add column if not exists deal_id uuid references crm.deals(id) on delete set null,
  add column if not exists reservation_id uuid references crm.client_project_reservations(id) on delete set null,
  add column if not exists read_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists snoozed_until timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

update crm.notifications
set
  source_type = coalesce(nullif(source_type, ''), 'manual'),
  entity_type = case
    when lead_id is not null then 'lead'
    when client_id is not null then 'client'
    when deal_id is not null then 'deal'
    when reservation_id is not null then 'reservation'
    else 'generic'
  end
where source_type is null
   or entity_type is null;

alter table crm.notifications
  drop constraint if exists notifications_source_type_check,
  drop constraint if exists notifications_entity_type_check,
  drop constraint if exists notifications_system_requirements_check,
  drop constraint if exists notifications_entity_link_check;

alter table crm.notifications
  add constraint notifications_source_type_check
    check (source_type in ('manual', 'system')),
  add constraint notifications_entity_type_check
    check (entity_type is null or entity_type in ('lead', 'deal', 'client', 'reservation', 'generic')),
  add constraint notifications_system_requirements_check
    check (
      source_type <> 'system'
      or (
        rule_key is not null
        and entity_type is not null
        and (
          lead_id is not null
          or deal_id is not null
          or client_id is not null
          or reservation_id is not null
        )
      )
    ),
  add constraint notifications_entity_link_check
    check (
      entity_type is null
      or entity_type = 'generic'
      or (entity_type = 'lead' and lead_id is not null)
      or (entity_type = 'deal' and deal_id is not null)
      or (entity_type = 'client' and client_id is not null)
      or (entity_type = 'reservation' and reservation_id is not null)
    );

create index if not exists idx_notifications_org_assigned_status_due
  on crm.notifications (organization_id, assigned_user_id, status, due_at desc);

create index if not exists idx_notifications_org_manager_status_due
  on crm.notifications (organization_id, manager_user_id, status, due_at desc);

create index if not exists idx_notifications_org_source_rule_status
  on crm.notifications (organization_id, source_type, rule_key, status);

create index if not exists idx_notifications_org_lead_status_due
  on crm.notifications (organization_id, lead_id, status, due_at desc);

create index if not exists idx_notifications_org_deal_status_due
  on crm.notifications (organization_id, deal_id, status, due_at desc);

create index if not exists idx_notifications_org_client_status_due
  on crm.notifications (organization_id, client_id, status, due_at desc);

create index if not exists idx_notifications_org_reservation_status_due
  on crm.notifications (organization_id, reservation_id, status, due_at desc);

create unique index if not exists idx_notifications_open_rule_hash_unique
  on crm.notifications (organization_id, rule_hash)
  where rule_hash is not null and status in ('pending', 'scheduled');
