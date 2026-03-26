create or replace function crm.ensure_lead_links_scope()
returns trigger
language plpgsql
as $$
declare
  linked_org_id uuid;
begin
  if new.agency_id is not null and new.provider_id is not null then
    raise exception 'Lead cannot reference agency and provider at the same time';
  end if;

  if new.origin_type = 'agency' and new.agency_id is null then
    raise exception 'origin_type=agency requires agency_id';
  end if;

  if new.origin_type = 'provider' and new.provider_id is null then
    raise exception 'origin_type=provider requires provider_id';
  end if;

  if new.status = 'converted' and new.agency_id is null and new.converted_client_id is null then
    raise exception 'status=converted requires agency_id or converted_client_id';
  end if;

  if new.agency_id is not null then
    select a.organization_id
      into linked_org_id
    from crm.agencies a
    where a.id = new.agency_id;
    if linked_org_id is null then
      raise exception 'Agency not found: %', new.agency_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and agency';
    end if;
  end if;

  if new.provider_id is not null then
    select p.organization_id
      into linked_org_id
    from crm.providers p
    where p.id = new.provider_id;
    if linked_org_id is null then
      raise exception 'Provider not found: %', new.provider_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and provider';
    end if;
  end if;

  if new.contact_id is not null then
    select c.organization_id
      into linked_org_id
    from crm.contacts c
    where c.id = new.contact_id;
    if linked_org_id is null then
      raise exception 'Contact not found: %', new.contact_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and contact';
    end if;
  end if;

  if new.referred_contact_id is not null then
    select c.organization_id
      into linked_org_id
    from crm.contacts c
    where c.id = new.referred_contact_id;
    if linked_org_id is null then
      raise exception 'Referred contact not found: %', new.referred_contact_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and referred_contact';
    end if;
  end if;

  return new;
end;
$$;
