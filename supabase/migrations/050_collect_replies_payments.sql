-- ============================================================
-- 050: Kayyro Collect, phase 2 - customer replies and the payment page
--
--   * Replies on WhatsApp and email are logged; the app's AI sorts each one
--     into an intent and collect_apply_intent() acts on it. Below 0.7
--     confidence (or anything unclear) it goes to "Needs you" instead.
--   * Every invoice has a private payment page (/pay/{token}) with "Pay now"
--     and "I already paid" (proof upload, private storage per business).
--     A pending claim pauses reminders until the owner confirms or rejects it.
--   * collect_record_gateway_payment() records a payment from a payment
--     gateway (Tap, Telr, Razorpay, Stripe Connect...) once, and marks the
--     invoice paid.
--   * On a promised day one reminder goes out that morning; a promise whose
--     day has passed unpaid is marked broken and chasing resumes.
--   * Reminders not sent within a day of being planned expire.
-- Requires 049. Safe to run twice.
-- ============================================================

-- ---------- 1) Columns ----------
alter table public.collection_messages add column if not exists kind text not null default 'reminder';
alter table public.collection_messages add column if not exists from_address text;
alter table public.collection_messages add column if not exists reply_to_id uuid references public.collection_messages(id) on delete set null;
alter table public.collection_messages add column if not exists intent text;
alter table public.collection_messages add column if not exists intent_confidence numeric(4,3);
alter table public.collection_messages add column if not exists intent_summary text;
alter table public.collection_messages add column if not exists intent_promise_date date;
-- inbound only: pending (waiting for the AI), applied, needs_you
alter table public.collection_messages add column if not exists intent_status text;

alter table public.collection_messages drop constraint if exists collection_messages_phase2_check;
alter table public.collection_messages add constraint collection_messages_phase2_check check (
  kind in ('reminder', 'reply')
  and (intent is null or intent in ('already_paid', 'promise_to_pay', 'dispute', 'request_invoice_copy',
                                    'request_extension', 'wrong_contact', 'other'))
  and (intent_confidence is null or intent_confidence between 0 and 1)
  and (intent_status is null or intent_status in ('pending', 'applied', 'needs_you'))
);

-- One reminder per invoice per channel per day; answers to a customer's reply are not counted
-- (same name as in 049, so re-running 049 keeps this version)
drop index if exists public.collection_messages_one_per_day;
create unique index collection_messages_one_per_day
  on public.collection_messages (invoice_id, channel, sent_on)
  where direction = 'out' and sent_on is not null and kind = 'reminder';
-- The same incoming message (webhook retries) is stored once
create unique index if not exists collection_messages_inbound_key
  on public.collection_messages (provider, provider_message_id)
  where direction = 'in' and provider_message_id is not null;
create index if not exists collection_messages_intent_idx
  on public.collection_messages (intent_status) where direction = 'in' and intent_status = 'pending';

alter table public.collect_tasks add column if not exists message_id uuid references public.collection_messages(id) on delete set null;
alter table public.collect_tasks add column if not exists claim_id uuid;

alter table public.collect_settings add column if not exists ai_replies boolean not null default true;

-- Where 360dialog delivers the business's incoming WhatsApp messages: /api/collect/inbound/whatsapp?k={webhook_key}
alter table public.collect_channel_accounts add column if not exists webhook_key text not null
  default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
create unique index if not exists collect_channel_accounts_webhook_key on public.collect_channel_accounts (webhook_key);

-- The invoice's private payment page link
alter table public.invoices add column if not exists collect_pay_token text not null
  default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
create unique index if not exists invoices_collect_pay_token_key on public.invoices (collect_pay_token);

create or replace function public.protect_invoice_pay_token()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') and new.collect_pay_token is distinct from old.collect_pay_token then
    raise exception 'The invoice''s payment link cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_invoice_pay_token() from public, anon, authenticated;
drop trigger if exists zx_protect_invoice_pay_token on public.invoices;
create trigger zx_protect_invoice_pay_token
  before update of collect_pay_token on public.invoices
  for each row execute function public.protect_invoice_pay_token();

-- ---------- 2) "I already paid" and gateway payments ----------
create table if not exists public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  source text not null,
  note text,
  -- collect-proofs/{organization_id}/{invoice_id}/{file}
  file_path text,
  file_type text,
  file_size integer,
  message_id uuid references public.collection_messages(id) on delete set null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
alter table public.payment_claims drop constraint if exists payment_claims_values_check;
alter table public.payment_claims add constraint payment_claims_values_check check (
  source in ('payment_page', 'reply')
  and status in ('pending', 'confirmed', 'rejected')
  and (note is null or length(note) <= 500)
  and (file_type is null or file_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))
  and (file_size is null or file_size between 1 and 5242880)
  and (file_path is null or split_part(file_path, '/', 1) = organization_id::text)
);
create index if not exists payment_claims_invoice_idx on public.payment_claims (invoice_id, status);

create table if not exists public.payment_gateway_events (
  provider text not null,
  reference text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount numeric(14,3) not null,
  currency text not null,
  created_at timestamptz not null default now(),
  primary key (provider, reference)
);

alter table public.payment_claims enable row level security;
alter table public.payment_gateway_events enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['payment_claims', 'payment_gateway_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id = public.current_org_id())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', 'zz_mfa_required', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      'zz_mfa_required', t
    );
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Private proof-of-payment files: the server writes them, the business's own users can read them
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('collect-proofs', 'collect-proofs', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "collect_proofs_select_own_org" on storage.objects;
create policy "collect_proofs_select_own_org" on storage.objects
  for select to authenticated
  using (bucket_id = 'collect-proofs' and (storage.foldername(name))[1] = public.current_org_id()::text);

-- ---------- 3) Which rule applies to a message ----------
-- A pending "I already paid" claim pauses chasing until the owner decides
create or replace function public.collect_hard_block_reason(p_invoice uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  v_opted timestamptz;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then return 'missing'; end if;
  if i.status = 'cancelled' then return 'cancelled'; end if;
  if i.status = 'paid' then return 'paid'; end if;
  if public.collect_invoice_balance(i.id) <= 0.0005 then return 'paid'; end if;
  select collect_opted_out_at into v_opted from public.customers where id = i.customer_id;
  if not found then return 'missing'; end if;
  if v_opted is not null then return 'opted_out'; end if;
  if exists (select 1 from public.disputes d where d.invoice_id = i.id and d.status = 'open') then
    return 'disputed';
  end if;
  if exists (select 1 from public.payment_claims pc where pc.invoice_id = i.id and pc.status = 'pending') then
    return 'paid_claim';
  end if;
  return null;
end;
$$;

-- Answers to a customer (proof request, "noted", invoice copy): never for a closed invoice or an opted-out customer
create or replace function public.collect_reply_block_reason(p_invoice uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  v_opted timestamptz;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then return 'missing'; end if;
  if i.status = 'cancelled' then return 'cancelled'; end if;
  if i.status = 'paid' or public.collect_invoice_balance(i.id) <= 0.0005 then return 'paid'; end if;
  select collect_opted_out_at into v_opted from public.customers where id = i.customer_id;
  if v_opted is not null then return 'opted_out'; end if;
  return null;
end;
$$;

create or replace function public.collect_message_block_for(p_id uuid, p_now timestamptz default now())
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
begin
  select * into m from public.collection_messages where id = p_id;
  if not found then return 'missing'; end if;
  if m.kind = 'reply' then return public.collect_reply_block_reason(m.invoice_id); end if;
  if m.manual then return public.collect_hard_block_reason(m.invoice_id); end if;
  return public.collect_block_reason(m.invoice_id, p_now);
end;
$$;

-- Keep the 049 signature working, with the new rules
create or replace function public.collect_message_block(p_manual boolean, p_invoice uuid, p_now timestamptz default now())
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_manual then public.collect_hard_block_reason(p_invoice)
              else public.collect_block_reason(p_invoice, p_now) end;
$$;

-- ---------- 4) The planner ----------
create or replace function public.collect_plan(p_org uuid default null, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s record;
  clk record;
  inv record;
  st public.reminder_steps%rowtype;
  c public.customers%rowtype;
  v_limit integer;
  v_used integer;
  v_wa_auto boolean;
  v_lang text;
  v_ch text;
  v_status text;
  v_step_id uuid;
  v_step_key text;
  v_planned integer := 0;
  v_rows integer;
begin
  for s in
    select cs.*, o.plan
    from public.collect_settings cs
    join public.organizations o on o.id = cs.organization_id
    where cs.enabled and (p_org is null or cs.organization_id = p_org)
  loop
    select * into clk from public.collect_clock(s.organization_id, p_now);

    -- Anything already queued that must not go out any more is cancelled
    update public.collection_messages m
      set status = 'cancelled', error = public.collect_message_block_for(m.id, p_now), updated_at = now()
      where m.organization_id = s.organization_id
        and m.direction = 'out'
        and m.status in ('pending', 'awaiting_approval', 'ready')
        and public.collect_message_block_for(m.id, p_now) is not null;
    -- A scheduled reminder that didn't go out within a day is out of date
    update public.collection_messages m
      set status = 'cancelled', error = 'expired', updated_at = now()
      where m.organization_id = s.organization_id
        and m.direction = 'out' and m.kind = 'reminder' and not m.manual
        and m.status in ('pending', 'awaiting_approval', 'ready')
        and m.local_date < clk.local_date - 1;
    -- A promised day that passed unpaid: the promise is broken and chasing resumes
    update public.payment_promises p
      set status = 'broken'
      where p.organization_id = s.organization_id
        and p.status = 'open'
        and p.promised_date < clk.local_date
        and public.collect_invoice_balance(p.invoice_id) > 0.0005;

    if not public.collect_plan_allows(s.organization_id) then continue; end if;
    -- Nothing is planned on the business's weekend
    if not clk.working_day then continue; end if;

    v_limit := public.plan_limit(s.plan, 'collect_invoices');
    select count(distinct m.invoice_id) into v_used
      from public.collection_messages m
      where m.organization_id = s.organization_id and m.direction = 'out' and not m.manual and m.kind = 'reminder'
        and m.status not in ('cancelled', 'skipped')
        and m.local_date >= date_trunc('month', clk.local_date)::date;
    v_wa_auto := exists (
      select 1 from public.collect_channel_accounts a where a.organization_id = s.organization_id and a.active
    );

    for inv in
      select i.id, i.customer_id, i.due_date
      from public.invoices i
      where i.organization_id = s.organization_id
        and i.status in ('issued', 'partially_paid')
        and i.due_date is not null
      order by i.due_date
    loop
      if public.collect_block_reason(inv.id, p_now) is not null then continue; end if;
      select * into c from public.customers where id = inv.customer_id;

      if exists (
        select 1 from public.payment_promises p
        where p.invoice_id = inv.id and p.status = 'open' and p.promised_date = clk.local_date
      ) then
        -- The promised day: one friendly reminder that morning, instead of the schedule
        if exists (
          select 1 from public.collection_messages m
          where m.invoice_id = inv.id and m.direction = 'out' and m.step_key = 'promise_day' and m.local_date = clk.local_date
        ) then
          continue;
        end if;
        v_step_id := null;
        v_step_key := 'promise_day';
      else
        -- The latest step that has come due (missed older steps are not sent in a burst)
        select * into st from public.reminder_steps r
          where r.organization_id = s.organization_id and r.active
            and inv.due_date + r.offset_days <= clk.local_date
          order by r.offset_days desc
          limit 1;
        if not found then continue; end if;

        if st.action = 'call_task' then
          insert into public.collect_tasks (organization_id, invoice_id, customer_id, step_id, kind, title, due_date)
          values (s.organization_id, inv.id, inv.customer_id, st.id, 'call', 'Call ' || c.name, clk.local_date)
          on conflict do nothing;
          continue;
        end if;

        if exists (
          select 1 from public.collection_messages m
          where m.invoice_id = inv.id and m.step_id = st.id and m.direction = 'out'
        ) then
          continue;
        end if;
        v_step_id := st.id;
        v_step_key := st.step_key;
      end if;

      -- Monthly allowance: a new invoice can't be chased once the limit is reached
      if v_limit is not null and not exists (
        select 1 from public.collection_messages m
        where m.invoice_id = inv.id and m.direction = 'out' and not m.manual and m.kind = 'reminder'
          and m.status not in ('cancelled', 'skipped')
          and m.local_date >= date_trunc('month', clk.local_date)::date
      ) then
        if v_used >= v_limit then
          if not exists (
            select 1 from public.collect_tasks t
            where t.organization_id = s.organization_id and t.kind = 'limit' and t.status = 'open'
              and t.created_at >= date_trunc('month', clk.local_ts)
          ) then
            insert into public.collect_tasks (organization_id, kind, title, due_date)
            values (s.organization_id, 'limit',
              'Monthly limit reached: ' || v_limit || ' invoices chased. Upgrade to Business for unlimited chasing.',
              clk.local_date);
          end if;
          continue;
        end if;
        v_used := v_used + 1;
      end if;

      v_lang := case
        when s.language in ('en', 'ar') then s.language
        when c.preferred_language in ('en', 'ar') then c.preferred_language
        else 'en'
      end;

      foreach v_ch in array array['email', 'whatsapp'] loop
        if v_ch = 'email' and not (s.channel_email and c.preferred_channel in ('email', 'both')
           and coalesce(btrim(c.email), '') like '%_@_%') then
          continue;
        end if;
        if v_ch = 'whatsapp' and not (s.channel_whatsapp and c.preferred_channel in ('whatsapp', 'both')
           and length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 8) then
          continue;
        end if;
        -- Automatic only with approval off; WhatsApp also needs a connected sender and the customer's opt-in
        v_status := case
          when s.approval_mode = 'auto'
               and (v_ch = 'email' or (v_wa_auto and c.whatsapp_opt_in_at is not null)) then 'auto'
          else 'approve'
        end;
        insert into public.collection_messages (
          organization_id, invoice_id, customer_id, step_id, step_key, direction, channel, status,
          auto_send, local_date, language, to_address
        ) values (
          s.organization_id, inv.id, inv.customer_id, v_step_id, v_step_key, 'out', v_ch,
          -- the app writes the wording (status 'pending' until then)
          'pending', v_status = 'auto', clk.local_date, v_lang,
          case when v_ch = 'email' then btrim(c.email) else c.phone end
        )
        on conflict do nothing;
        get diagnostics v_rows = row_count;
        v_planned := v_planned + v_rows;
      end loop;
    end loop;
  end loop;
  return v_planned;
end;
$$;

-- ---------- 5) Replies ----------
-- Queue an answer to a customer's message, on the channel they wrote on (worded by the app)
create or replace function public.collect_queue_reply(p_in uuid, p_step text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
  c public.customers%rowtype;
  s public.collect_settings%rowtype;
  clk record;
  v_to text;
  v_auto boolean;
  v_id uuid;
begin
  select * into m from public.collection_messages where id = p_in and direction = 'in';
  if not found or m.invoice_id is null or m.customer_id is null then return null; end if;
  if public.collect_reply_block_reason(m.invoice_id) is not null then return null; end if;
  select * into c from public.customers where id = m.customer_id;
  select * into s from public.collect_settings where organization_id = m.organization_id;
  if m.channel = 'email' then
    v_to := coalesce(nullif(btrim(coalesce(m.from_address, '')), ''), nullif(btrim(coalesce(c.email, '')), ''));
    if v_to is null or v_to not like '%_@_%' then return null; end if;
  else
    v_to := coalesce(nullif(btrim(coalesce(m.from_address, '')), ''), c.phone);
    if length(regexp_replace(coalesce(v_to, ''), '\D', '', 'g')) < 8 then return null; end if;
  end if;
  -- Same rule as reminders: automatic only with approval off (WhatsApp: a connected number and the customer's opt-in)
  v_auto := coalesce(s.approval_mode, 'approve') = 'auto'
    and (m.channel = 'email'
         or (c.whatsapp_opt_in_at is not null
             and exists (select 1 from public.collect_channel_accounts a where a.organization_id = m.organization_id and a.active)));
  select * into clk from public.collect_clock(m.organization_id);
  insert into public.collection_messages (
    organization_id, invoice_id, customer_id, step_key, direction, channel, status, kind,
    auto_send, local_date, language, to_address, reply_to_id
  ) values (
    m.organization_id, m.invoice_id, m.customer_id, p_step, 'out', m.channel, 'pending', 'reply',
    v_auto, clk.local_date, m.language, v_to, m.id
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Store an incoming message (server: WhatsApp / email webhooks). Finds the customer and the invoice.
create or replace function public.collect_record_inbound(
  p_org uuid, p_channel text, p_from text, p_subject text, p_body text,
  p_provider text, p_provider_message_id text, p_reply_to uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_customer uuid;
  v_invoice uuid;
  v_digits text;
  v_lang text;
  v_status text := 'pending';
  clk record;
  c public.customers%rowtype;
begin
  if p_channel not in ('email', 'whatsapp') then raise exception 'Unknown channel' using errcode = '22023'; end if;
  if coalesce(btrim(p_body), '') = '' then return null; end if;
  if p_provider_message_id is not null then
    select id into v_id from public.collection_messages
      where direction = 'in' and provider = p_provider and provider_message_id = p_provider_message_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- The reminder they answered (email reply address), when known
  if p_reply_to is not null then
    select invoice_id, customer_id into v_invoice, v_customer from public.collection_messages
      where id = p_reply_to and organization_id = p_org and direction = 'out';
  end if;
  if v_customer is null then
    if p_channel = 'whatsapp' then
      v_digits := regexp_replace(coalesce(p_from, ''), '\D', '', 'g');
      if length(v_digits) >= 8 then
        select id into v_customer from public.customers
          where organization_id = p_org
            and length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 8
            and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9)
          order by created_at
          limit 1;
      end if;
    else
      select id into v_customer from public.customers
        where organization_id = p_org and lower(btrim(coalesce(email, ''))) = lower(btrim(coalesce(p_from, '')))
        order by created_at
        limit 1;
    end if;
  end if;
  if v_customer is not null and v_invoice is null then
    -- The invoice we last reminded them about, otherwise their oldest open invoice
    select m.invoice_id into v_invoice from public.collection_messages m
      join public.invoices i on i.id = m.invoice_id
      where m.customer_id = v_customer and m.direction = 'out' and m.status = 'sent'
        and m.sent_at > now() - interval '60 days' and i.status in ('issued', 'partially_paid')
      order by m.sent_at desc
      limit 1;
    if v_invoice is null then
      select id into v_invoice from public.invoices
        where customer_id = v_customer and status in ('issued', 'partially_paid')
        order by coalesce(due_date, invoice_date), invoice_date
        limit 1;
    end if;
  end if;

  select * into c from public.customers where id = v_customer;
  v_lang := case
    when p_body ~ '[؀-ۿ]' then 'ar'
    when c.preferred_language in ('en', 'ar') then c.preferred_language
    else 'en'
  end;
  select * into clk from public.collect_clock(p_org);
  insert into public.collection_messages (
    organization_id, invoice_id, customer_id, direction, channel, status, kind, local_date, language,
    from_address, subject, body, provider, provider_message_id, reply_to_id, intent_status, sent_at
  ) values (
    p_org, v_invoice, v_customer, 'in', p_channel, 'received', 'reply', clk.local_date, v_lang,
    left(btrim(p_from), 200), left(p_subject, 200), left(btrim(p_body), 4000), p_provider, p_provider_message_id,
    p_reply_to, v_status, now()
  )
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.collection_messages
      where direction = 'in' and provider = p_provider and provider_message_id = p_provider_message_id;
  end if;
  return v_id;
end;
$$;

-- The owner pastes a reply that came to their own phone or inbox
create or replace function public.collect_log_reply(p_invoice uuid, p_channel text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  c public.customers%rowtype;
  v_id uuid;
  v_lang text;
  clk record;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found or i.organization_id is distinct from public.current_org_id() then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if public.is_read_only() then
    raise exception 'Accountant access is read-only.' using errcode = '42501';
  end if;
  if p_channel not in ('email', 'whatsapp') then raise exception 'Unknown channel' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    raise exception 'Paste the customer''s reply (up to 4,000 characters).' using errcode = '22023';
  end if;
  select * into c from public.customers where id = i.customer_id;
  v_lang := case
    when p_body ~ '[؀-ۿ]' then 'ar'
    when c.preferred_language in ('en', 'ar') then c.preferred_language
    else 'en'
  end;
  select * into clk from public.collect_clock(i.organization_id);
  insert into public.collection_messages (
    organization_id, invoice_id, customer_id, direction, channel, status, kind, local_date, language,
    from_address, body, provider, intent_status, sent_at, approved_by
  ) values (
    i.organization_id, i.id, i.customer_id, 'in', p_channel, 'received', 'reply', clk.local_date, v_lang,
    case when p_channel = 'email' then c.email else c.phone end, btrim(p_body), 'manual', 'pending', now(), auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Act on the AI's reading of a reply. Anything unclear goes to "Needs you".
create or replace function public.collect_apply_intent(
  p_id uuid, p_intent text, p_confidence numeric, p_promise_date date, p_summary text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
  i public.invoices%rowtype;
  c public.customers%rowtype;
  clk record;
  v_intent text;
  v_conf numeric;
  v_summary text;
  v_kind text;
  v_label text;
  v_claim uuid;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found or m.direction <> 'in' then raise exception 'Reply not found' using errcode = 'P0002'; end if;
  if m.intent_status in ('applied', 'needs_you') then return m.intent_status; end if;

  v_intent := case when p_intent in ('already_paid', 'promise_to_pay', 'dispute', 'request_invoice_copy',
                                     'request_extension', 'wrong_contact', 'other') then p_intent else 'other' end;
  v_conf := least(greatest(coalesce(p_confidence, 0), 0), 1);
  v_summary := nullif(left(btrim(coalesce(p_summary, '')), 300), '');
  select * into clk from public.collect_clock(m.organization_id);
  update public.collection_messages
    set intent = v_intent, intent_confidence = v_conf, intent_summary = v_summary,
        intent_promise_date = p_promise_date, updated_at = now()
    where id = m.id;

  select * into c from public.customers where id = m.customer_id;
  v_label := case v_intent
    when 'already_paid' then 'says it is already paid'
    when 'promise_to_pay' then 'promises to pay'
    when 'dispute' then 'disputes the invoice'
    when 'request_invoice_copy' then 'asks for a copy of the invoice'
    when 'request_extension' then 'asks for more time'
    when 'wrong_contact' then 'says this is the wrong contact'
    else 'replied'
  end;

  if m.invoice_id is null or m.customer_id is null
     or v_conf < 0.7
     or v_intent in ('other', 'request_extension', 'wrong_contact')
     or (v_intent = 'promise_to_pay'
         and (p_promise_date is null or p_promise_date < clk.local_date or p_promise_date > clk.local_date + 90)) then
    v_kind := case
      when m.invoice_id is null then 'other'
      when v_intent = 'request_extension' then 'extension'
      when v_intent = 'wrong_contact' then 'wrong_contact'
      when v_intent = 'promise_to_pay' then 'promise'
      when v_intent = 'already_paid' then 'paid_claim'
      when v_intent = 'dispute' then 'dispute'
      else 'other'
    end;
    insert into public.collect_tasks (organization_id, invoice_id, customer_id, kind, title, note, due_date, message_id)
    values (
      m.organization_id, m.invoice_id, m.customer_id, v_kind,
      coalesce(c.name, m.from_address, 'Unknown sender') || ' ' || v_label,
      coalesce(v_summary, left(m.body, 300)), clk.local_date, m.id
    );
    update public.collection_messages set intent_status = 'needs_you' where id = m.id;
    return 'needs_you';
  end if;

  select * into i from public.invoices where id = m.invoice_id;

  if v_intent = 'already_paid' then
    if not exists (select 1 from public.payment_claims pc where pc.invoice_id = i.id and pc.status = 'pending') then
      insert into public.payment_claims (organization_id, invoice_id, customer_id, source, note, message_id)
      values (i.organization_id, i.id, i.customer_id, 'reply', left(coalesce(v_summary, m.body), 500), m.id)
      returning id into v_claim;
      insert into public.collect_tasks (organization_id, invoice_id, customer_id, kind, title, note, due_date, message_id, claim_id)
      values (i.organization_id, i.id, i.customer_id, 'paid_claim',
              coalesce(c.name, 'Customer') || ' says ' || i.invoice_number || ' is paid',
              coalesce(v_summary, left(m.body, 300)), clk.local_date, m.id, v_claim);
    end if;
    update public.collection_messages set status = 'cancelled', error = 'paid_claim', updated_at = now()
      where invoice_id = i.id and direction = 'out' and kind = 'reminder' and status in ('pending', 'awaiting_approval', 'ready');
    perform public.collect_queue_reply(m.id, 'ask_proof');
  elsif v_intent = 'promise_to_pay' then
    update public.payment_promises set status = 'cancelled' where invoice_id = i.id and status = 'open';
    insert into public.payment_promises (organization_id, invoice_id, customer_id, promised_date, source, note)
    values (i.organization_id, i.id, i.customer_id, p_promise_date, 'reply', v_summary);
    update public.collection_messages set status = 'cancelled', error = 'promised', updated_at = now()
      where invoice_id = i.id and direction = 'out' and kind = 'reminder' and status in ('pending', 'awaiting_approval', 'ready');
    perform public.collect_queue_reply(m.id, 'promise_ack');
  elsif v_intent = 'dispute' then
    insert into public.disputes (organization_id, invoice_id, customer_id, reason, source)
    values (i.organization_id, i.id, i.customer_id, left(coalesce(v_summary, btrim(m.body)), 500), 'reply');
    insert into public.collect_tasks (organization_id, invoice_id, customer_id, kind, title, note, due_date, message_id)
    values (i.organization_id, i.id, i.customer_id, 'dispute', 'Dispute on ' || i.invoice_number,
            coalesce(v_summary, left(m.body, 300)), clk.local_date, m.id);
    update public.collection_messages set status = 'cancelled', error = 'disputed', updated_at = now()
      where invoice_id = i.id and direction = 'out' and status in ('pending', 'awaiting_approval', 'ready');
  elsif v_intent = 'request_invoice_copy' then
    perform public.collect_queue_reply(m.id, 'invoice_copy');
  end if;

  update public.collection_messages set intent_status = 'applied' where id = m.id;
  return v_intent;
end;
$$;

-- ---------- 6) The payment page ----------
-- "I already paid" from /pay/{token} (server; the file is already in private storage)
create or replace function public.collect_submit_paid_claim(
  p_token text, p_note text, p_file_path text, p_file_type text, p_file_size integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  c public.customers%rowtype;
  v_id uuid;
begin
  select * into i from public.invoices where collect_pay_token = p_token;
  if not found then return null; end if;
  if i.status in ('paid', 'cancelled') or public.collect_invoice_balance(i.id) <= 0.0005 then
    raise exception 'This invoice is already settled.' using errcode = '22023';
  end if;
  if (select count(*) from public.payment_claims pc where pc.invoice_id = i.id and pc.created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many submissions for this invoice today.' using errcode = '22023';
  end if;
  if p_file_path is not null and split_part(p_file_path, '/', 1) <> i.organization_id::text then
    raise exception 'Invalid file' using errcode = '22023';
  end if;
  select * into c from public.customers where id = i.customer_id;
  insert into public.payment_claims (organization_id, invoice_id, customer_id, source, note, file_path, file_type, file_size)
  values (i.organization_id, i.id, i.customer_id, 'payment_page', nullif(left(btrim(coalesce(p_note, '')), 500), ''),
          p_file_path, p_file_type, p_file_size)
  returning id into v_id;
  insert into public.collect_tasks (organization_id, invoice_id, customer_id, kind, title, note, due_date, claim_id)
  values (i.organization_id, i.id, i.customer_id, 'paid_claim',
          coalesce(c.name, 'Customer') || ' says ' || i.invoice_number || ' is paid',
          nullif(left(btrim(coalesce(p_note, '')), 300), ''), (select local_date from public.collect_clock(i.organization_id)), v_id);
  update public.collection_messages set status = 'cancelled', error = 'paid_claim', updated_at = now()
    where invoice_id = i.id and direction = 'out' and kind = 'reminder' and status in ('pending', 'awaiting_approval', 'ready');
  return v_id;
end;
$$;

-- The owner decides on a claim. Confirmed records the payment (default: what is still owed).
create or replace function public.collect_resolve_claim(p_claim uuid, p_status text, p_amount numeric default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pc public.payment_claims%rowtype;
  i public.invoices%rowtype;
  v_amount numeric;
begin
  select * into pc from public.payment_claims where id = p_claim for update;
  if not found then raise exception 'Claim not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(pc.organization_id);
  if pc.status <> 'pending' then raise exception 'This claim was already handled.' using errcode = '22023'; end if;
  if p_status not in ('confirmed', 'rejected') then raise exception 'Unknown decision' using errcode = '22023'; end if;
  if p_status = 'confirmed' then
    select * into i from public.invoices where id = pc.invoice_id;
    v_amount := round(coalesce(p_amount, public.collect_invoice_balance(i.id)), 2);
    if v_amount > 0 then
      perform public.record_payment(jsonb_build_object(
        'customer_id', i.customer_id, 'invoice_id', i.id, 'amount', v_amount,
        'payment_mode', 'bank_transfer', 'notes', 'Confirmed from the customer''s proof of payment'
      ));
    end if;
  end if;
  update public.payment_claims set status = p_status, resolved_at = now(), resolved_by = auth.uid() where id = pc.id;
  update public.collect_tasks set status = 'done', resolved_at = now(), resolved_by = auth.uid()
    where status = 'open' and (claim_id = pc.id or (kind = 'paid_claim' and invoice_id = pc.invoice_id));
  return p_status;
end;
$$;

-- A payment gateway confirmed a payment (webhook, server only). Recorded once per gateway reference.
create or replace function public.collect_record_gateway_payment(
  p_provider text, p_reference text, p_invoice uuid, p_amount numeric, p_currency text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  v_rows integer;
  v_paid numeric;
begin
  if coalesce(btrim(p_provider), '') = '' or coalesce(btrim(p_reference), '') = '' then
    raise exception 'Missing payment reference' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount' using errcode = '22023'; end if;
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  if upper(coalesce(p_currency, '')) <> upper(coalesce(i.currency, 'AED')) then
    raise exception 'Currency does not match the invoice' using errcode = '22023';
  end if;
  insert into public.payment_gateway_events (provider, reference, organization_id, invoice_id, amount, currency)
  values (p_provider, p_reference, i.organization_id, i.id, p_amount, upper(p_currency))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return 'duplicate'; end if;
  if i.status = 'cancelled' then raise exception 'Invoice is cancelled' using errcode = '22023'; end if;

  insert into public.payments (organization_id, customer_id, invoice_id, amount, payment_date, payment_mode, notes)
  values (i.organization_id, i.customer_id, i.id, round(p_amount, 2),
          (select local_date from public.collect_clock(i.organization_id)), 'card',
          left('Paid online · ' || p_provider || ' ' || p_reference, 300));
  v_paid := round(coalesce(i.amount_paid, 0) + p_amount, 2);
  update public.invoices
    set amount_paid = least(v_paid, i.grand_total),
        status = case when v_paid >= i.grand_total then 'paid' else 'partially_paid' end
    where id = i.id;
  update public.payment_claims set status = 'confirmed', resolved_at = now() where invoice_id = i.id and status = 'pending';
  return 'recorded';
end;
$$;

-- ---------- 7) Sending, approval and closing use the new rules ----------
create or replace function public.collect_claim(p_id uuid, p_now timestamptz default now())
returns setof public.collection_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
  clk record;
  v_reason text;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found or m.direction <> 'out' or m.status <> 'ready' then
    return;
  end if;
  v_reason := public.collect_message_block_for(m.id, p_now);
  if v_reason is not null then
    update public.collection_messages set status = 'cancelled', error = v_reason, updated_at = now() where id = p_id;
    return;
  end if;
  select * into clk from public.collect_clock(m.organization_id, p_now);
  if not clk.in_window then
    return;
  end if;
  begin
    update public.collection_messages
      set status = 'sending', claim_token = gen_random_uuid(), claimed_at = p_now, sent_on = clk.local_date, updated_at = now()
      where id = p_id and status = 'ready'
      returning * into m;
  exception when unique_violation then
    -- Already messaged on this channel today: try again tomorrow
    return;
  end;
  return next m;
end;
$$;

create or replace function public.collect_approve(p_id uuid, p_subject text default null, p_body text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
  v_reason text;
  v_wa_auto boolean;
  v_opted boolean;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(m.organization_id);
  if m.status <> 'awaiting_approval' then
    raise exception 'This message is no longer waiting for approval.' using errcode = '22023';
  end if;
  v_reason := public.collect_message_block_for(m.id);
  if v_reason is not null then
    update public.collection_messages set status = 'cancelled', error = v_reason, updated_at = now() where id = p_id;
    return 'cancelled';
  end if;
  if m.channel = 'whatsapp' then
    v_wa_auto := exists (select 1 from public.collect_channel_accounts a where a.organization_id = m.organization_id and a.active);
    select whatsapp_opt_in_at is not null into v_opted from public.customers where id = m.customer_id;
    if not (v_wa_auto and v_opted) then
      -- Sent from the owner's own WhatsApp: use collect_mark_sent_by_hand after tapping Send
      raise exception 'Send this one from your WhatsApp with the Send button.' using errcode = '22023';
    end if;
  end if;
  update public.collection_messages
    set status = 'ready',
        subject = coalesce(nullif(btrim(p_subject), ''), subject),
        body = coalesce(nullif(btrim(p_body), ''), body),
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    where id = p_id;
  return 'ready';
end;
$$;

create or replace function public.collect_mark_sent_by_hand(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
  v_reason text;
  v_today date;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(m.organization_id);
  if m.status not in ('awaiting_approval', 'ready', 'failed') then
    raise exception 'This message can''t be sent again.' using errcode = '22023';
  end if;
  v_reason := public.collect_message_block_for(m.id);
  if v_reason is not null then
    update public.collection_messages set status = 'cancelled', error = v_reason, updated_at = now() where id = p_id;
    return 'cancelled';
  end if;
  select local_date into v_today from public.collect_clock(m.organization_id);
  begin
    update public.collection_messages
      set status = 'sent', sent_on = v_today, sent_at = now(), provider = 'one_tap',
          approved_by = auth.uid(), approved_at = now(), error = null, updated_at = now()
      where id = p_id;
  exception when unique_violation then
    -- only reminders are limited to one a day (answers to a reply are not)
    raise exception 'This invoice already had a % message today.', m.channel using errcode = '23505';
  end;
  return 'sent';
end;
$$;

create or replace function public.collect_stop_on_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice uuid;
begin
  if tg_table_name = 'invoices' then
    v_invoice := new.id;
  else
    v_invoice := new.invoice_id;
  end if;
  if v_invoice is null then return null; end if;
  if public.collect_invoice_balance(v_invoice) <= 0.0005
     or exists (select 1 from public.invoices i where i.id = v_invoice and i.status in ('paid', 'cancelled')) then
    update public.collection_messages set status = 'cancelled', error = 'closed', updated_at = now()
      where invoice_id = v_invoice and direction = 'out' and status in ('pending', 'awaiting_approval', 'ready');
    update public.collect_tasks set status = 'done', resolved_at = now()
      where invoice_id = v_invoice and status = 'open' and kind in ('call', 'paid_claim', 'promise');
    update public.payment_promises set status = 'kept' where invoice_id = v_invoice and status = 'open';
    update public.payment_claims set status = 'confirmed', resolved_at = now() where invoice_id = v_invoice and status = 'pending';
  end if;
  return null;
end;
$$;


-- ---------- 8) Grants ----------
do $$
declare
  f text;
begin
  -- Server only (webhooks, the AI step, the payment page, payment gateways)
  foreach f in array array[
    'collect_record_inbound(uuid, text, text, text, text, text, text, uuid)',
    'collect_apply_intent(uuid, text, numeric, date, text)',
    'collect_queue_reply(uuid, text)',
    'collect_submit_paid_claim(text, text, text, text, integer)',
    'collect_record_gateway_payment(text, text, uuid, numeric, text)',
    'collect_message_block_for(uuid, timestamptz)',
    'collect_reply_block_reason(uuid)',
    'collect_plan(uuid, timestamptz)',
    'collect_claim(uuid, timestamptz)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Signed-in users (each function checks the business and the role)
  foreach f in array array[
    'collect_log_reply(uuid, text, text)',
    'collect_resolve_claim(uuid, text, numeric)',
    'collect_approve(uuid, text, text)',
    'collect_mark_sent_by_hand(uuid)',
    'collect_hard_block_reason(uuid)',
    'collect_message_block(boolean, uuid, timestamptz)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on function public.collect_stop_on_close() from public, anon, authenticated;

-- ---------- schema version ----------
create or replace function public.kayyro_schema_version()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 50 $$;
revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
